import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import * as path from 'path';
import * as fs from 'fs';
import { getDb } from '../db/database';

const app = new Hono();

// Helper to check if device capabilities are enabled
function checkDeviceCapabilities(capabilityName: 'screenshot' | 'camera' | 'location') {
  const db = getDb();

  // Check if device capabilities are globally enabled
  const globalEnabled = db
    .query('SELECT value FROM settings WHERE key = ?')
    .get('deviceCapabilities') as any;
  if (!globalEnabled) {
    return { enabled: false, reason: 'Device capabilities not configured' };
  }

  const capabilities = JSON.parse(globalEnabled.value);

  const capabilityKey = `${capabilityName}Enabled`;
  if (!capabilities[capabilityKey]) {
    return { enabled: false, reason: `${capabilityName} access is disabled in settings` };
  }

  return { enabled: true };
}

// Helper to get capture storage directory
function getCaptureStorageDir(workspacePath: string): string {
  const db = getDb();
  const row = db.query('SELECT value FROM settings WHERE key = ?').get('deviceCapabilities') as any;

  if (!row) {
    return path.join(workspacePath, '.e/device-captures');
  }

  const capabilities = JSON.parse(row.value);
  const relativeDir = capabilities.captureStorageDir || '.e/device-captures';

  return path.join(workspacePath, relativeDir);
}

// Check if Tauri environment is available (desktop app)
function isTauriAvailable(): boolean {
  // Check if we're running in Tauri environment
  // This is a simple heuristic - in production you'd have a more robust check
  return !!process.env.TAURI_APP;
}

// Capture screenshot
app.post('/screenshot', async (c) => {
  const permCheck = checkDeviceCapabilities('screenshot');
  if (!permCheck.enabled) {
    return c.json({ ok: false, error: permCheck.reason }, 403);
  }

  const body = await c.req.json();
  const { workspacePath = '.', displayIndex, saveToFile = true } = body;

  try {
    // Get storage directory
    const storageDir = getCaptureStorageDir(workspacePath);
    fs.mkdirSync(storageDir, { recursive: true });

    const filename = `screenshot-${nanoid()}.png`;
    const savePath = saveToFile ? path.join(storageDir, filename) : undefined;

    // In Tauri desktop app, we'd call the native command
    // For now, we'll use a server-side implementation
    if (isTauriAvailable() && (global as any).__TAURI__) {
      // Call Tauri command (would be available in desktop app context)
      const result = await (global as any).__TAURI__.invoke('capture_screenshot', {
        displayIndex,
        savePath,
      });

      return c.json({
        ok: true,
        data: {
          path: result.file_path,
          base64: result.data,
          mimeType: result.mime_type,
        },
      });
    }

    // Fallback: return instructions for browser-based screenshot
    return c.json(
      {
        ok: false,
        error: 'Screenshot capture requires Tauri desktop app or browser-based implementation',
        hint: "Use browser's screenshot API or run in Tauri desktop mode",
      },
      501,
    );
  } catch (error: any) {
    return c.json({ ok: false, error: error.message }, 500);
  }
});

// Get location (approximate, IP-based for privacy)
app.get('/location', async (c) => {
  const permCheck = checkDeviceCapabilities('location');
  if (!permCheck.enabled) {
    return c.json({ ok: false, error: permCheck.reason }, 403);
  }

  try {
    if (isTauriAvailable() && (global as any).__TAURI__) {
      const result = await (global as any).__TAURI__.invoke('get_location');
      return c.json({
        ok: true,
        data: {
          latitude: result.latitude,
          longitude: result.longitude,
          timezone: result.timezone,
        },
      });
    }

    // Fallback: IP-based geolocation
    const response = await fetch('https://ipapi.co/json/');
    const data = await response.json();

    if (data.error) {
      return c.json({ ok: false, error: data.reason || 'Location lookup failed' }, 500);
    }

    return c.json({
      ok: true,
      data: {
        latitude: data.latitude,
        longitude: data.longitude,
        timezone: data.timezone,
        city: data.city,
        country: data.country_name,
      },
    });
  } catch (error: any) {
    return c.json({ ok: false, error: error.message }, 500);
  }
});

// Capture from camera
app.post('/camera', async (c) => {
  const permCheck = checkDeviceCapabilities('camera');
  if (!permCheck.enabled) {
    return c.json({ ok: false, error: permCheck.reason }, 403);
  }

  const body = await c.req.json();
  const { workspacePath = '.', saveToFile = true } = body;

  try {
    if (isTauriAvailable() && (global as any).__TAURI__) {
      const storageDir = getCaptureStorageDir(workspacePath);
      fs.mkdirSync(storageDir, { recursive: true });

      const filename = `camera-${nanoid()}.jpg`;
      const savePath = saveToFile ? path.join(storageDir, filename) : undefined;

      const result = await (global as any).__TAURI__.invoke('capture_camera', {
        savePath,
      });

      return c.json({
        ok: true,
        data: {
          path: result.file_path,
          base64: result.data,
          mimeType: result.mime_type,
        },
      });
    }

    // Camera requires browser MediaDevices API or Tauri
    return c.json(
      {
        ok: false,
        error: 'Camera capture requires browser MediaDevices API or Tauri desktop app',
        hint: 'Use browser camera access or run in Tauri desktop mode',
      },
      501,
    );
  } catch (error: any) {
    return c.json({ ok: false, error: error.message }, 500);
  }
});

// List available displays for screenshot
app.get('/displays', async (c) => {
  const permCheck = checkDeviceCapabilities('screenshot');
  if (!permCheck.enabled) {
    return c.json({ ok: false, error: permCheck.reason }, 403);
  }

  try {
    if (isTauriAvailable() && (global as any).__TAURI__) {
      const displays = await (global as any).__TAURI__.invoke('list_displays');
      return c.json({ ok: true, data: displays });
    }

    return c.json(
      {
        ok: false,
        error: 'Display enumeration requires Tauri desktop app',
      },
      501,
    );
  } catch (error: any) {
    return c.json({ ok: false, error: error.message }, 500);
  }
});

// Get device capabilities status
app.get('/status', (c) => {
  const db = getDb();
  const row = db.query('SELECT value FROM settings WHERE key = ?').get('deviceCapabilities') as any;

  if (!row) {
    return c.json({
      ok: true,
      data: {
        screenshotEnabled: false,
        cameraEnabled: false,
        locationEnabled: false,
        tauriAvailable: isTauriAvailable(),
      },
    });
  }

  const capabilities = JSON.parse(row.value);

  return c.json({
    ok: true,
    data: {
      ...capabilities,
      tauriAvailable: isTauriAvailable(),
    },
  });
});

export { app as deviceCapabilitiesRoutes };
