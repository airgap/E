use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use screenshots::Screen;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::command;

#[derive(Debug, Serialize, Deserialize)]
pub struct ScreenshotResult {
    pub success: bool,
    pub data: Option<String>, // Base64-encoded PNG
    pub mime_type: Option<String>,
    pub file_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LocationResult {
    pub success: bool,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub timezone: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CameraResult {
    pub success: bool,
    pub data: Option<String>, // Base64-encoded image
    pub mime_type: Option<String>,
    pub file_path: Option<String>,
    pub error: Option<String>,
}

/// Capture a screenshot of the entire screen or a specific display
#[command]
pub async fn capture_screenshot(
    display_index: Option<usize>,
    save_path: Option<String>,
) -> Result<ScreenshotResult, String> {
    // Get available screens
    let screens = Screen::all().map_err(|e| format!("Failed to get screens: {}", e))?;

    if screens.is_empty() {
        return Ok(ScreenshotResult {
            success: false,
            data: None,
            mime_type: None,
            file_path: None,
            error: Some("No screens available".to_string()),
        });
    }

    // Select the screen to capture
    let screen = if let Some(idx) = display_index {
        if idx >= screens.len() {
            return Ok(ScreenshotResult {
                success: false,
                data: None,
                mime_type: None,
                file_path: None,
                error: Some(format!("Display index {} out of range", idx)),
            });
        }
        &screens[idx]
    } else {
        &screens[0] // Default to primary screen
    };

    // Capture the screenshot
    let image = screen
        .capture()
        .map_err(|e| format!("Failed to capture screenshot: {}", e))?;

    // Convert to PNG bytes
    let mut png_bytes = Vec::new();
    image
        .buffer()
        .write_to(&mut std::io::Cursor::new(&mut png_bytes), image::ImageFormat::Png)
        .map_err(|e| format!("Failed to encode PNG: {}", e))?;

    // Optionally save to file
    let file_path = if let Some(path) = save_path {
        let path_buf = PathBuf::from(&path);
        // Ensure parent directory exists
        if let Some(parent) = path_buf.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
        }
        image
            .save(&path_buf)
            .map_err(|e| format!("Failed to save screenshot: {}", e))?;
        Some(path)
    } else {
        None
    };

    // Encode to base64
    let base64_data = BASE64.encode(&png_bytes);

    Ok(ScreenshotResult {
        success: true,
        data: Some(base64_data),
        mime_type: Some("image/png".to_string()),
        file_path,
        error: None,
    })
}

/// Get approximate location using IP geolocation (privacy-friendly, no GPS)
#[command]
pub async fn get_location() -> Result<LocationResult, String> {
    // Use IP-based geolocation via ipapi.co (free tier, no API key needed)
    let response = reqwest::get("https://ipapi.co/json/")
        .await
        .map_err(|e| format!("Failed to fetch location: {}", e))?;

    #[derive(Deserialize)]
    struct IpApiResponse {
        latitude: Option<f64>,
        longitude: Option<f64>,
        timezone: Option<String>,
        error: Option<bool>,
        reason: Option<String>,
    }

    let data: IpApiResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse location response: {}", e))?;

    if data.error.unwrap_or(false) {
        return Ok(LocationResult {
            success: false,
            latitude: None,
            longitude: None,
            timezone: None,
            error: Some(data.reason.unwrap_or_else(|| "Unknown error".to_string())),
        });
    }

    Ok(LocationResult {
        success: true,
        latitude: data.latitude,
        longitude: data.longitude,
        timezone: data.timezone,
        error: None,
    })
}

/// Capture from camera (placeholder - requires platform-specific implementation)
/// On macOS, this requires TCC permissions for camera access
#[command]
pub async fn capture_camera(save_path: Option<String>) -> Result<CameraResult, String> {
    // Note: Camera access requires platform-specific implementation and permissions
    // This is a placeholder that returns an informative error

    #[cfg(target_os = "macos")]
    {
        return Ok(CameraResult {
            success: false,
            data: None,
            mime_type: None,
            file_path: save_path,
            error: Some(
                "Camera access requires macOS TCC permissions and platform-specific implementation. \
                 Please use a dedicated camera API or external tool for now."
                    .to_string(),
            ),
        });
    }

    #[cfg(not(target_os = "macos"))]
    {
        return Ok(CameraResult {
            success: false,
            data: None,
            mime_type: None,
            file_path: save_path,
            error: Some(
                "Camera access is not yet implemented on this platform. \
                 Please use a dedicated camera tool or external application."
                    .to_string(),
            ),
        });
    }
}

/// List available displays for screenshot capture
#[command]
pub async fn list_displays() -> Result<Vec<String>, String> {
    let screens = Screen::all().map_err(|e| format!("Failed to get screens: {}", e))?;

    Ok(screens
        .iter()
        .enumerate()
        .map(|(i, screen)| format!("Display {}: {}x{}", i, screen.display_info.width, screen.display_info.height))
        .collect())
}
