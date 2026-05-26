// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::time::Duration;
use tauri::Manager;
use tauri::WebviewUrl;
use tauri::WebviewWindowBuilder;
use tauri_plugin_shell::ShellExt;

/// On Linux, use GTK's Client-Side Decoration API — the same mechanism Chrome
/// uses for its combined titlebar/tabstrip. `set_titlebar()` tells the WM to
/// treat the header widget's empty space as a native drag region. No
/// begin_move_drag, no event interception, no IPC — the WM handles it.
#[cfg(target_os = "linux")]
fn setup_linux_titlebar(window: &tauri::WebviewWindow) {
    use gtk::prelude::*;

    let gtk_win = window.gtk_window().expect("gtk_window");

    // Set a GtkHeaderBar as the titlebar so the WM knows this window uses
    // client-side decorations. The header is transparent and overlaps the
    // webview's TopBar. The WM treats empty space in the header as a native
    // drag region — buttons in the webview still receive clicks normally
    // because the header is input-transparent (pass-through).
    let header = gtk::HeaderBar::new();
    header.set_show_close_button(false);
    header.set_decoration_layout(Some(""));
    header.set_size_request(-1, 0);

    // Make it fully transparent via CSS
    let css = gtk::CssProvider::new();
    css.load_from_data(b"headerbar { background: transparent; border: none; box-shadow: none; padding: 0; margin: 0; min-height: 0; }");
    let screen = gtk::prelude::GtkWindowExt::screen(&gtk_win).expect("screen");
    gtk::StyleContext::add_provider_for_screen(
        &screen,
        &css,
        gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
    );

    gtk_win.set_titlebar(Some(&header));
}

#[cfg(not(target_os = "linux"))]
fn setup_linux_titlebar(_window: &tauri::WebviewWindow) {}

mod device;

#[tauri::command]
fn get_window_pos(window: tauri::Window) -> Result<(f64, f64, f64), String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    Ok((pos.x as f64 / scale, pos.y as f64 / scale, scale))
}

#[tauri::command]
fn set_window_pos(window: tauri::Window, x: f64, y: f64) -> Result<(), String> {
    window
        .set_position(tauri::LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

fn main() {
    // E_REMOTE=host:port — connect to a remote E server instead of spawning a local sidecar.
    // Useful for running the Tauri shell locally while the server runs on a cloud desktop.
    let remote = std::env::var("E_REMOTE").ok();

    if let Some(ref addr) = remote {
        println!("[e] remote mode: connecting to {}", addr);
    }

    // Find a free port BEFORE spawning anything (only needed in local mode).
    let sidecar_port = if remote.is_none() {
        let listener =
            std::net::TcpListener::bind("127.0.0.1:0").expect("failed to find a free port");
        let port = listener.local_addr().unwrap().port();
        drop(listener); // Release port so the sidecar can bind it
        println!("[e] selected port {} for sidecar", port);
        Some(port)
    } else {
        None
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            device::capture_screenshot,
            device::get_location,
            device::capture_camera,
            device::list_displays,
            get_window_pos,
            set_window_pos,
        ])
        .setup(move |app| {
            // Inject the sidecar port via an initialization script so it's set
            // BEFORE any app JS runs AND re-injected on every reload. The old
            // approach (window.eval() after health-check) only worked on the
            // first page load — a Ctrl+R wiped `__TAURI_SIDECAR_PORT__` and
            // waitForServer() would wait forever.
            let init_port_script = if let Some(p) = sidecar_port {
                format!("window.__TAURI_SIDECAR_PORT__ = {};", p)
            } else if let Some(ref addr) = remote {
                format!("window.__TAURI_SIDECAR_ORIGIN__ = '{}';", addr)
            } else {
                String::new()
            };

            let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("E")
                .inner_size(1200.0, 800.0)
                .min_inner_size(800.0, 600.0)
                .decorations(false)
                // Don't intercept OS-level drag events — they were swallowing
                // in-window HTML5 dragover/drop in WebKitGTK, so tab reorder +
                // split-on-drop never fired. With this disabled, the webview
                // dispatches HTML5 drag events natively as expected.
                .disable_drag_drop_handler();
            if !init_port_script.is_empty() {
                builder = builder.initialization_script(&init_port_script);
            }
            let main_window = builder.build()?;

            setup_linux_titlebar(&main_window);

            if let Some(ref remote_addr) = remote {
                // ── Remote mode: skip sidecar, connect to remote server ──
                app.manage(SidecarState {
                    child: std::sync::Mutex::new(None),
                });

                let remote_addr = remote_addr.clone();
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let client = reqwest::Client::new();
                    let health_url = format!("http://{}/health", remote_addr);

                    // Poll until the remote server is reachable
                    for _ in 0..120 {
                        tokio::time::sleep(Duration::from_millis(500)).await;
                        if let Ok(resp) = client.get(&health_url).send().await {
                            if resp.status().is_success() {
                                println!("[e] remote server ready at {}", remote_addr);
                                if let Some(window) = app_handle.get_webview_window("main") {
                                    let _ = window.eval(&format!(
                                        "window.__TAURI_SIDECAR_ORIGIN__ = '{}';",
                                        remote_addr
                                    ));
                                }
                                return;
                            }
                        }
                    }
                    eprintln!("[e] remote server at {} not reachable after 60 seconds", remote_addr);
                });
            } else {
                // ── Local mode: spawn sidecar ──
                let port = sidecar_port.unwrap();
                let shell = app.shell();

                // CARGO_MANIFEST_DIR is src-tauri/ at compile time.
                // Client build lives at ../packages/client/build relative to that.
                let manifest_dir = env!("CARGO_MANIFEST_DIR");
                let client_dist = format!("{}/../packages/client/build", manifest_dir);

                // Spawn the sidecar with the pre-selected port
                let (mut rx, child) = shell
                    .sidecar("e-server")
                    .expect("failed to create e-server sidecar")
                    .env("PORT", port.to_string())
                    .env("CLIENT_DIST", &client_dist)
                    .spawn()
                    .expect("failed to spawn e-server sidecar");

                // Store child process for cleanup on exit
                app.manage(SidecarState {
                    child: std::sync::Mutex::new(Some(child)),
                });

                // Log sidecar stdout/stderr
                tauri::async_runtime::spawn(async move {
                    use tauri_plugin_shell::process::CommandEvent;
                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stdout(line) => {
                                println!("[e-server] {}", String::from_utf8_lossy(&line));
                            }
                            CommandEvent::Stderr(line) => {
                                eprintln!("[e-server] {}", String::from_utf8_lossy(&line));
                            }
                            CommandEvent::Terminated(status) => {
                                eprintln!("[e-server] terminated: {:?}", status);
                                break;
                            }
                            CommandEvent::Error(err) => {
                                eprintln!("[e-server] error: {}", err);
                                break;
                            }
                            _ => {}
                        }
                    }
                });

                // Poll health; when ready, inject the port into the webview.
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let client = reqwest::Client::new();
                    let health_url = format!("http://localhost:{}/health", port);

                    for _ in 0..60 {
                        tokio::time::sleep(Duration::from_millis(250)).await;
                        if let Ok(resp) = client.get(&health_url).send().await {
                            if resp.status().is_success() {
                                println!("[e] server ready on port {}", port);
                                if let Some(window) = app_handle.get_webview_window("main") {
                                    // Inject the sidecar port so the client can
                                    // reach the API without navigating away from
                                    // the Tauri origin (preserves IPC + drag region).
                                    let _ = window.eval(&format!(
                                        "window.__TAURI_SIDECAR_PORT__ = {};",
                                        port
                                    ));
                                }
                                return;
                            }
                        }
                    }
                    eprintln!("[e] server failed to start within 15 seconds");
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<SidecarState>() {
                    if let Ok(mut guard) = state.child.lock() {
                        if let Some(child) = guard.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running E");
}

struct SidecarState {
    child: std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
}
