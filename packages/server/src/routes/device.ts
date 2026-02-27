import { Hono } from 'hono';
import { readFile, writeFile, mkdir, readdir, stat, unlink } from 'fs/promises';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { getDb } from '../db/database';
import type {
  ScreenshotRequest,
  ScreenshotResult,
  CameraRequest,
  CameraResult,
  LocationRequest,
  LocationResult,
  DeviceCapabilityCheck,
} from '@e/shared';

const app = new Hono();

/**
 * Get device capabilities from settings
 */
function getDeviceCapabilitiesFromSettings() {
  const db = getDb();
  const row = db.query("SELECT value FROM settings WHERE key = 'settings'").get() as any;

  if (!row) {
    return {
      screenshot: false,
      camera: false,
      location: false,
      captureStorageDir: '.e/device-captures',
      captureStorageLimitMb: 100,
    };
  }

  const settings = JSON.parse(row.value);
  const capabilities = settings.deviceCapabilities || {};
  return {
    screenshot: capabilities.screenshotEnabled || false,
    camera: capabilities.cameraEnabled || false,
    location: capabilities.locationEnabled || false,
    captureStorageDir: capabilities.captureStorageDir || '.e/device-captures',
    captureStorageLimitMb: capabilities.captureStorageLimitMb || 100,
  };
}

/**
 * Get current device capabilities status
 */
app.get('/capabilities', async (c) => {
  const capabilities = getDeviceCapabilitiesFromSettings();

  const check: DeviceCapabilityCheck = {
    screenshot: capabilities.screenshot,
    camera: capabilities.camera,
    location: capabilities.location,
  };

  return c.json({ ok: true, data: check });
});

/**
 * Capture a screenshot
 * This endpoint will be called by the agent tool and coordinates with Tauri
 */
app.post('/screenshot', async (c) => {
  const capabilities = getDeviceCapabilitiesFromSettings();

  if (!capabilities.screenshot) {
    return c.json(
      {
        ok: false,
        error: 'Screenshot capability is disabled. Enable it in Settings > Device Capabilities.',
      },
      403,
    );
  }

  try {
    const body = (await c.req.json()) as ScreenshotRequest;
    const workspacePath = c.req.header('X-Workspace-Path') || process.cwd();
    const captureDir = join(workspacePath, '.e', 'device-captures', 'screenshots');

    // Ensure capture directory exists
    await mkdir(captureDir, { recursive: true });

    // Generate unique filename
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const format = body.format || 'png';
    const filename = `screenshot-${timestamp}.${format}`;
    const filepath = join(captureDir, filename);

    // For browser mode, we expect the client to send base64 data
    // For Tauri mode, we'll invoke a Tauri command (handled separately)
    // For now, this is a placeholder that will be enhanced with actual screenshot logic

    // Placeholder: In a real implementation, this would:
    // 1. Call OS-specific screenshot API (via Tauri command or child process)
    // 2. Save the image to filepath
    // 3. Return the image data

    // Check if we're running in Tauri mode
    const isTauri = c.req.header('X-Tauri-Mode') === 'true';

    if (isTauri) {
      // Tauri will handle the screenshot capture and save
      // This endpoint just validates permissions
      return c.json({
        ok: true,
        data: {
          path: filepath,
          message: 'Screenshot request validated. Tauri will handle capture.',
        },
      });
    }

    // For web mode, expect base64 data from client
    const base64Data = c.req.header('X-Screenshot-Data');
    if (!base64Data) {
      return c.json({ ok: false, error: 'Screenshot data required for web mode' }, 400);
    }

    // Save the screenshot
    const imageBuffer = Buffer.from(base64Data, 'base64');
    await writeFile(filepath, imageBuffer);

    const stats = await stat(filepath);
    const result: ScreenshotResult = {
      path: filepath,
      data: base64Data,
      mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
      width: 0, // Would be extracted from image metadata in real implementation
      height: 0,
      size: stats.size,
      capturedAt: new Date().toISOString(),
    };

    return c.json({ ok: true, data: result });
  } catch (err) {
    console.error('[device] Screenshot failed:', err);
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

/**
 * Access camera for photo or barcode scanning
 */
app.post('/camera', async (c) => {
  const capabilities = getDeviceCapabilitiesFromSettings();

  if (!capabilities.camera) {
    return c.json(
      {
        ok: false,
        error: 'Camera capability is disabled. Enable it in Settings > Device Capabilities.',
      },
      403,
    );
  }

  try {
    const body = (await c.req.json()) as CameraRequest;
    const workspacePath = c.req.header('X-Workspace-Path') || process.cwd();
    const captureDir = join(workspacePath, '.e', 'device-captures', 'camera');

    await mkdir(captureDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const mode = body.mode || 'photo';

    if (mode === 'barcode') {
      // For barcode mode, we don't save an image, just return the decoded text
      // The client/Tauri will handle barcode scanning
      const isTauri = c.req.header('X-Tauri-Mode') === 'true';

      if (isTauri) {
        return c.json({
          ok: true,
          data: {
            message: 'Barcode scan request validated. Tauri will handle scanning.',
          },
        });
      }

      // For web mode, expect barcode data from client
      const barcodeText = c.req.header('X-Barcode-Text');
      const barcodeFormat = c.req.header('X-Barcode-Format');

      if (!barcodeText) {
        return c.json({ ok: false, error: 'Barcode text required' }, 400);
      }

      const result: CameraResult = {
        barcodeText,
        barcodeFormat,
        capturedAt: new Date().toISOString(),
      };

      return c.json({ ok: true, data: result });
    }

    // Photo mode
    const format = body.format || 'jpeg';
    const filename = `photo-${timestamp}.${format}`;
    const filepath = join(captureDir, filename);

    const isTauri = c.req.header('X-Tauri-Mode') === 'true';

    if (isTauri) {
      return c.json({
        ok: true,
        data: {
          path: filepath,
          message: 'Camera request validated. Tauri will handle capture.',
        },
      });
    }

    // For web mode, expect base64 data from client
    const base64Data = c.req.header('X-Camera-Data');
    if (!base64Data) {
      return c.json({ ok: false, error: 'Camera data required for web mode' }, 400);
    }

    const imageBuffer = Buffer.from(base64Data, 'base64');
    await writeFile(filepath, imageBuffer);

    const stats = await stat(filepath);
    const result: CameraResult = {
      path: filepath,
      data: base64Data,
      mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
      capturedAt: new Date().toISOString(),
    };

    return c.json({ ok: true, data: result });
  } catch (err) {
    console.error('[device] Camera capture failed:', err);
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

/**
 * Get device location
 */
app.post('/location', async (c) => {
  const capabilities = getDeviceCapabilitiesFromSettings();

  if (!capabilities.location) {
    return c.json(
      {
        ok: false,
        error: 'Location capability is disabled. Enable it in Settings > Device Capabilities.',
      },
      403,
    );
  }

  try {
    const body = (await c.req.json()) as LocationRequest;

    // Location data comes from the client (browser Geolocation API or Tauri)
    // This endpoint validates permissions and optionally enriches the data

    const latitude = parseFloat(c.req.header('X-Location-Latitude') || '0');
    const longitude = parseFloat(c.req.header('X-Location-Longitude') || '0');
    const accuracy = parseFloat(c.req.header('X-Location-Accuracy') || '0');

    if (latitude === 0 && longitude === 0) {
      return c.json({ ok: false, error: 'Location data required' }, 400);
    }

    // Get timezone from coordinates (simplified - would use a proper library in production)
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const result: LocationResult = {
      latitude,
      longitude,
      accuracy,
      timestamp: Date.now(),
      timezone,
      // Optional fields would be populated if available
      altitude: parseFloat(c.req.header('X-Location-Altitude') || '0') || undefined,
      altitudeAccuracy:
        parseFloat(c.req.header('X-Location-Altitude-Accuracy') || '0') || undefined,
      heading: parseFloat(c.req.header('X-Location-Heading') || '0') || undefined,
      speed: parseFloat(c.req.header('X-Location-Speed') || '0') || undefined,
    };

    return c.json({ ok: true, data: result });
  } catch (err) {
    console.error('[device] Location failed:', err);
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

/**
 * List captured media files
 */
app.get('/captures', async (c) => {
  const workspacePath = c.req.query('workspace') || process.cwd();
  const type = c.req.query('type') || 'all'; // 'screenshot', 'camera', or 'all'
  const captureBaseDir = join(workspacePath, '.e', 'device-captures');

  try {
    const captures: Array<{
      type: 'screenshot' | 'camera';
      filename: string;
      path: string;
      size: number;
      created: string;
    }> = [];

    if (type === 'screenshot' || type === 'all') {
      const screenshotDir = join(captureBaseDir, 'screenshots');
      try {
        const files = await readdir(screenshotDir);
        for (const file of files) {
          const filepath = join(screenshotDir, file);
          const stats = await stat(filepath);
          if (stats.isFile()) {
            captures.push({
              type: 'screenshot',
              filename: file,
              path: filepath,
              size: stats.size,
              created: stats.birthtime.toISOString(),
            });
          }
        }
      } catch {
        // Directory doesn't exist yet
      }
    }

    if (type === 'camera' || type === 'all') {
      const cameraDir = join(captureBaseDir, 'camera');
      try {
        const files = await readdir(cameraDir);
        for (const file of files) {
          const filepath = join(cameraDir, file);
          const stats = await stat(filepath);
          if (stats.isFile()) {
            captures.push({
              type: 'camera',
              filename: file,
              path: filepath,
              size: stats.size,
              created: stats.birthtime.toISOString(),
            });
          }
        }
      } catch {
        // Directory doesn't exist yet
      }
    }

    // Sort by creation time, newest first
    captures.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());

    return c.json({ ok: true, data: captures });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

/**
 * Delete a captured media file
 */
app.delete('/capture', async (c) => {
  const filepath = c.req.query('path');
  if (!filepath) {
    return c.json({ ok: false, error: 'path required' }, 400);
  }

  // Ensure the path is within a device-captures directory for safety
  if (!filepath.includes('.e/device-captures')) {
    return c.json({ ok: false, error: 'Invalid capture path' }, 403);
  }

  try {
    await unlink(filepath);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

/**
 * Check storage usage for captured media
 */
app.get('/storage', async (c) => {
  const workspacePath = c.req.query('workspace') || process.cwd();
  const captureBaseDir = join(workspacePath, '.e', 'device-captures');

  try {
    let totalSize = 0;
    let fileCount = 0;

    async function calculateDirSize(dir: string) {
      try {
        const files = await readdir(dir);
        for (const file of files) {
          const filepath = join(dir, file);
          const stats = await stat(filepath);
          if (stats.isFile()) {
            totalSize += stats.size;
            fileCount++;
          } else if (stats.isDirectory()) {
            await calculateDirSize(filepath);
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }

    await calculateDirSize(captureBaseDir);

    return c.json({
      ok: true,
      data: {
        totalSizeBytes: totalSize,
        totalSizeMb: Math.round((totalSize / (1024 * 1024)) * 100) / 100,
        fileCount,
      },
    });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

export { app as deviceRoutes };
