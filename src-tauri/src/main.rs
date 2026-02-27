// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri::WebviewWindowBuilder;
use tauri::WebviewUrl;
use tauri_plugin_shell::ShellExt;
use std::time::Duration;
use std::path::PathBuf;
use std::fs;

mod device;

fn main() {
    // Find a free port BEFORE spawning anything.
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .expect("failed to find a free port");
    let sidecar_port = listener.local_addr().unwrap().port();
    drop(listener); // Release port so the sidecar can bind it

    println!("[e] selected port {} for sidecar", sidecar_port);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            device::capture_screenshot,
            device::get_location,
            device::capture_camera,
            device::list_displays,
        ])
        .setup(move |app| {
            // Create the window pointing to the built frontend initially.
            // Once the sidecar is healthy, we navigate to the sidecar URL instead.
            // This makes ALL API requests same-origin — no CORS needed.
            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
            .title("E")
            .inner_size(1200.0, 800.0)
            .min_inner_size(800.0, 600.0)
            .decorations(false)
            .build()?;

            let shell = app.shell();

            // CARGO_MANIFEST_DIR is src-tauri/ at compile time.
            // Client build lives at ../packages/client/build relative to that.
            let manifest_dir = env!("CARGO_MANIFEST_DIR");
            let client_dist = format!("{}/../packages/client/build", manifest_dir);

            // Spawn the sidecar with the pre-selected port
            let (mut rx, child) = shell
                .sidecar("e-server")
                .expect("failed to create e-server sidecar")
                .env("PORT", sidecar_port.to_string())
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

            // Poll health; when ready, navigate the webview to the sidecar URL.
            // This makes the page same-origin with the API — no CORS needed.
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let client = reqwest::Client::new();
                let health_url = format!("http://localhost:{}/health", sidecar_port);

                for _ in 0..60 {
                    tokio::time::sleep(Duration::from_millis(250)).await;
                    if let Ok(resp) = client.get(&health_url).send().await {
                        if resp.status().is_success() {
                            println!("[e] server ready on port {}", sidecar_port);
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.eval(&format!(
                                    "window.location.href = 'http://localhost:{}/';",
                                    sidecar_port
                                ));
                            }
                            return;
                        }
                    }
                }
                eprintln!("[e] server failed to start within 15 seconds");
            });

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
