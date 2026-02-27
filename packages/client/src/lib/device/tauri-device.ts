/**
 * Tauri device capabilities integration
 * Handles screenshot, camera, and location access via Tauri commands
 */

import type {
  ScreenshotResult,
  CameraResult,
  LocationResult,
  DeviceCapabilityCheck,
} from '@e/shared';

// Type definitions for Tauri window object
interface TauriWindow {
  __TAURI__: {
    core: {
      invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
    };
  };
}

/**
 * Check if running in Tauri desktop app
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

/**
 * Get the Tauri invoke function
 */
function getTauriInvoke() {
  if (!isTauri()) {
    throw new Error('Tauri is not available');
  }
  return (window as unknown as TauriWindow).__TAURI__.core.invoke;
}

/**
 * Capture a screenshot using Tauri
 */
export async function captureScreenshot(
  displayIndex?: number,
  savePath?: string,
): Promise<ScreenshotResult> {
  const invoke = getTauriInvoke();

  try {
    const result = await invoke<{
      success: boolean;
      data?: string;
      mime_type?: string;
      file_path?: string;
      error?: string;
    }>('capture_screenshot', {
      displayIndex,
      savePath,
    });

    if (!result.success) {
      throw new Error(result.error || 'Screenshot capture failed');
    }

    // Convert Rust result format to TypeScript format
    return {
      path: result.file_path || '',
      data: result.data || '',
      mimeType: result.mime_type || 'image/png',
      width: 0, // Not available from Rust side without parsing image
      height: 0,
      size: result.data ? Math.floor((result.data.length * 3) / 4) : 0, // Approximate base64 size
      capturedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(
      `Screenshot capture failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Get location information using Tauri
 */
export async function getLocation(): Promise<LocationResult> {
  const invoke = getTauriInvoke();

  try {
    const result = await invoke<{
      success: boolean;
      latitude?: number;
      longitude?: number;
      timezone?: string;
      error?: string;
    }>('get_location');

    if (!result.success) {
      throw new Error(result.error || 'Location fetch failed');
    }

    return {
      latitude: result.latitude || 0,
      longitude: result.longitude || 0,
      accuracy: 1000, // IP-based location is approximate (1km accuracy)
      timestamp: Date.now(),
      timezone: result.timezone,
    };
  } catch (error) {
    throw new Error(
      `Location fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Capture from camera using Tauri
 */
export async function captureCamera(savePath?: string): Promise<CameraResult> {
  const invoke = getTauriInvoke();

  try {
    const result = await invoke<{
      success: boolean;
      data?: string;
      mime_type?: string;
      file_path?: string;
      error?: string;
    }>('capture_camera', {
      savePath,
    });

    if (!result.success) {
      throw new Error(result.error || 'Camera capture failed');
    }

    return {
      path: result.file_path,
      data: result.data,
      mimeType: result.mime_type,
      capturedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(
      `Camera capture failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * List available displays for screenshot
 */
export async function listDisplays(): Promise<string[]> {
  const invoke = getTauriInvoke();

  try {
    const displays = await invoke<string[]>('list_displays');
    return displays;
  } catch (error) {
    throw new Error(
      `Failed to list displays: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Check which device capabilities are available
 */
export function getAvailableCapabilities(): DeviceCapabilityCheck {
  const tauriAvailable = isTauri();

  return {
    screenshot: tauriAvailable,
    camera: tauriAvailable,
    location: tauriAvailable,
    error: tauriAvailable ? undefined : 'Desktop app required for device capabilities',
  };
}

/**
 * Process a device action from a tool result
 * Tool results with __device_action indicate they need device capability execution
 */
export async function processDeviceAction(toolResult: string): Promise<{
  shouldProcess: boolean;
  result?: {
    type: 'screenshot' | 'camera' | 'location' | 'displays';
    data: any;
  };
  error?: string;
}> {
  try {
    // Check if the tool result contains a device action
    const parsed = JSON.parse(toolResult);

    if (!parsed.__device_action) {
      return { shouldProcess: false };
    }

    if (!isTauri()) {
      return {
        shouldProcess: true,
        error: 'Device capabilities are only available in the desktop app',
      };
    }

    const action = parsed.__device_action;

    switch (action) {
      case 'capture_screenshot': {
        const displayIndex = parsed.display_index ?? 0;
        const savePath = parsed.save_path;
        const screenshot = await captureScreenshot(displayIndex, savePath);
        return {
          shouldProcess: true,
          result: {
            type: 'screenshot',
            data: screenshot,
          },
        };
      }

      case 'get_location': {
        const location = await getLocation();
        return {
          shouldProcess: true,
          result: {
            type: 'location',
            data: location,
          },
        };
      }

      case 'capture_camera': {
        const savePath = parsed.save_path;
        const camera = await captureCamera(savePath);
        return {
          shouldProcess: true,
          result: {
            type: 'camera',
            data: camera,
          },
        };
      }

      case 'list_displays': {
        const displays = await listDisplays();
        return {
          shouldProcess: true,
          result: {
            type: 'displays',
            data: displays,
          },
        };
      }

      default:
        return {
          shouldProcess: true,
          error: `Unknown device action: ${action}`,
        };
    }
  } catch (error) {
    // Not a device action or JSON parse failed
    return { shouldProcess: false };
  }
}
