# Device Node Actions — Implementation Summary

## Overview

The device node actions system provides agents with opt-in access to device-level capabilities for visual debugging, document scanning, and context-aware development. All capabilities respect OS permission models and are disabled by default.

## Features Implemented

### 1. Screenshot Capture

- **Tool**: `CaptureScreenshot`
- **Description**: Captures screenshots of the entire screen or specific displays
- **Approval Required**: No (permission controlled by settings)
- **Tauri Command**: `capture_screenshot`
- **Storage**: `.e/device-captures/screenshots/`

**Usage**:

```typescript
// Agent can request a screenshot
{
  "tool": "CaptureScreenshot",
  "input": {
    "target": "screen",
    "format": "png",
    "includeCursor": false
  }
}
```

### 2. Display Listing

- **Tool**: `ListDisplays`
- **Description**: Lists available displays for screenshot capture
- **Approval Required**: No
- **Tauri Command**: `list_displays`

### 3. Camera Capture

- **Tool**: `CaptureCamera`
- **Description**: Captures from camera for barcode/QR scanning or document photography
- **Approval Required**: No (permission controlled by settings)
- **Tauri Command**: `capture_camera`
- **Storage**: `.e/device-captures/camera/`
- **Modes**:
  - `photo`: Still image capture
  - `barcode`: QR/barcode scanning

**Usage**:

```typescript
// Barcode scanning
{
  "tool": "CaptureCamera",
  "input": {
    "mode": "barcode",
    "facingMode": "environment"
  }
}

// Photo capture
{
  "tool": "CaptureCamera",
  "input": {
    "mode": "photo",
    "format": "jpeg",
    "quality": 90
  }
}
```

### 4. Location Access

- **Tool**: `GetLocation`
- **Description**: Provides approximate location for timezone-aware scheduling
- **Approval Required**: No (permission controlled by settings)
- **Tauri Command**: `get_location`
- **Method**: IP-based geolocation (privacy-friendly, no GPS)

**Usage**:

```typescript
{
  "tool": "GetLocation",
  "input": {
    "highAccuracy": false
  }
}
```

## Settings & Permissions

### Device Capabilities Settings

Located in **Settings > Device Capabilities**:

1. **Screenshot Capture** (default: disabled)
   - Allow agents to capture screenshots
   - Stored locally, never sent externally

2. **Camera Access** (default: disabled)
   - Allow barcode/QR scanning
   - Requires browser/OS camera permissions

3. **Location Access** (default: disabled)
   - IP-based geolocation only
   - Used for timezone detection

### Storage Settings

- **Storage Directory**: `.e/device-captures` (configurable)
- **Storage Limit**: 100 MB default (configurable 10-500 MB)
- **Auto-cleanup**: Oldest files deleted when limit reached

## Architecture

### Backend (Rust/Tauri)

**Files**:

- `src-tauri/src/device.rs`: Tauri commands for native device access
- `src-tauri/src/main.rs`: Command registration

**Commands**:

- `capture_screenshot(display_index?, save_path?)`: Captures screenshot
- `list_displays()`: Lists available displays
- `capture_camera(save_path?)`: Camera capture (placeholder)
- `get_location()`: IP-based geolocation

**Dependencies** (Cargo.toml):

- `screenshots = "0.8"`: Cross-platform screenshot capture
- `image = "0.25"`: Image processing
- `base64 = "0.22"`: Image encoding
- `reqwest = "0.12"`: HTTP for location API

### Server (TypeScript/Hono)

**Files**:

- `packages/server/src/routes/device.ts`: Device API routes
- `packages/server/src/services/tool-executor.ts`: Tool executors

**Routes**:

- `GET /api/device/capabilities`: Get capability status
- `POST /api/device/screenshot`: Screenshot capture
- `POST /api/device/camera`: Camera capture
- `POST /api/device/location`: Location request
- `GET /api/device/captures`: List captured media
- `DELETE /api/device/capture`: Delete captured file
- `GET /api/device/storage`: Storage usage info

### Shared Types

**File**: `packages/shared/src/device.ts`

**Types**:

- `ScreenshotRequest`: Screenshot capture parameters
- `ScreenshotResult`: Screenshot capture result
- `CameraRequest`: Camera capture parameters
- `CameraResult`: Camera capture result
- `LocationRequest`: Location request parameters
- `LocationResult`: Location data
- `DeviceCapabilityCheck`: Capability status

**File**: `packages/shared/src/settings.ts`

**Type**: `DeviceCapabilities`

```typescript
interface DeviceCapabilities {
  screenshotEnabled: boolean;
  cameraEnabled: boolean;
  locationEnabled: boolean;
  captureStorageDir: string;
  captureStorageLimitMb: number;
}
```

### Client (Svelte)

**Files**:

- `packages/client/src/lib/components/settings/DeviceSettings.svelte`: Settings UI
- `packages/client/src/lib/stores/settings.svelte.ts`: Settings store with deviceCapabilities

**UI Features**:

- Toggle switches for each capability
- Visual status badges (Enabled/Disabled)
- Storage usage bar
- Storage limit slider
- Clear captured media button
- Informational notes about permissions

## Security & Privacy

### Permission Model

1. **Opt-in by Default**: All capabilities disabled by default
2. **OS Permission Checks**: Screenshot and camera respect system permissions
3. **Local Storage Only**: Captured media stored locally in workspace
4. **No External Transmission**: Media never sent externally without explicit consent
5. **Storage Limits**: Automatic cleanup prevents unbounded storage usage

### TCC Permissions (macOS)

- **Screen Recording**: Required for screenshot capture
- **Camera**: Required for camera access
- System will prompt user for permissions on first use

### Privacy-Friendly Location

- Uses IP-based geolocation (ipapi.co)
- No GPS or precise location
- Only for timezone detection
- Approximate location only

## Tool Definitions

### CaptureScreenshot

```json
{
  "name": "CaptureScreenshot",
  "category": "device",
  "description": "Capture screenshots for visual debugging",
  "requiresApproval": false,
  "source": "builtin",
  "inputSchema": {
    "type": "object",
    "properties": {
      "target": {
        "type": "string",
        "description": "Target to capture: 'screen' for full screen, or window title/ID",
        "default": "screen"
      },
      "includeCursor": {
        "type": "boolean",
        "description": "Include cursor in screenshot",
        "default": false
      },
      "format": {
        "type": "string",
        "enum": ["png", "jpeg"],
        "default": "png"
      },
      "quality": {
        "type": "number",
        "description": "JPEG quality 1-100",
        "default": 90
      }
    }
  }
}
```

### ListDisplays

```json
{
  "name": "ListDisplays",
  "category": "device",
  "description": "List available displays for screenshot capture",
  "requiresApproval": false,
  "source": "builtin"
}
```

### CaptureCamera

```json
{
  "name": "CaptureCamera",
  "category": "device",
  "description": "Capture from camera for barcode/document scanning",
  "requiresApproval": false,
  "source": "builtin",
  "inputSchema": {
    "type": "object",
    "properties": {
      "mode": {
        "type": "string",
        "enum": ["photo", "barcode"],
        "description": "Camera mode: 'photo' for still image, 'barcode' for QR/barcode scanning"
      },
      "facingMode": {
        "type": "string",
        "enum": ["user", "environment"],
        "description": "Preferred camera",
        "default": "user"
      },
      "format": {
        "type": "string",
        "enum": ["png", "jpeg"],
        "default": "jpeg"
      },
      "quality": {
        "type": "number",
        "description": "JPEG quality 1-100",
        "default": 90
      }
    },
    "required": ["mode"]
  }
}
```

### GetLocation

```json
{
  "name": "GetLocation",
  "category": "device",
  "description": "Get approximate location for timezone-aware scheduling",
  "requiresApproval": false,
  "source": "builtin",
  "inputSchema": {
    "type": "object",
    "properties": {
      "highAccuracy": {
        "type": "boolean",
        "description": "Request high accuracy (may take longer)",
        "default": false
      },
      "maximumAge": {
        "type": "number",
        "description": "Maximum age of cached location in milliseconds",
        "default": 60000
      },
      "timeout": {
        "type": "number",
        "description": "Timeout in milliseconds",
        "default": 10000
      }
    }
  }
}
```

## Usage Examples

### Visual Debugging

An agent debugging a UI issue can capture screenshots:

```
User: The button on the settings page looks misaligned.
Agent: Let me take a screenshot to see the issue.
[Uses CaptureScreenshot tool]
Agent: I can see the button is 5px off. I'll fix the CSS.
```

### Barcode Scanning

An agent helping with inventory management:

```
User: Add this product to the inventory.
Agent: Please scan the barcode.
[Uses CaptureCamera with mode: "barcode"]
Agent: Found barcode: 123456789012. Adding product...
```

### Timezone-Aware Scheduling

An agent scheduling a meeting:

```
User: Schedule a meeting at 9 AM my time.
Agent: Let me check your timezone.
[Uses GetLocation tool]
Agent: You're in America/New_York (UTC-5). Scheduling for 09:00 EST.
```

## Testing

### Manual Testing

1. **Enable Device Capabilities**
   - Open Settings > Device Capabilities
   - Enable screenshot capture
   - Check that badge shows "Enabled"

2. **Test Screenshot**
   - Ask agent: "Take a screenshot"
   - Verify screenshot is saved in `.e/device-captures/screenshots/`
   - Check storage usage updates

3. **Test Storage Limits**
   - Set storage limit to 10 MB
   - Capture multiple screenshots
   - Verify oldest files are deleted when limit reached

### Automated Testing

Run type checking:

```bash
bun run check
```

Build Tauri app:

```bash
bun run tauri:build
```

## Future Enhancements

### Potential Additions

1. **Video Recording**: Record screen for debugging animations
2. **Audio Recording**: Capture audio for voice commands
3. **Webcam Streaming**: Real-time camera feed for collaboration
4. **Precise Location**: GPS-based location (with explicit consent)
5. **Clipboard Access**: Read/write clipboard for copy/paste operations
6. **System Info**: OS version, hardware specs for debugging

### Platform-Specific

1. **macOS**: Better TCC permission handling
2. **Windows**: Windows Hello integration
3. **Linux**: Wayland protocol support

## Troubleshooting

### Screenshot Not Working

**Issue**: Permission denied for screenshot
**Solution**: Grant Screen Recording permission in System Settings (macOS)

### Camera Not Accessible

**Issue**: Camera not found or permission denied
**Solution**:

1. Check browser camera permissions
2. On macOS, grant Camera permission in System Settings

### Location Not Accurate

**Issue**: Location is approximate
**Solution**: This is expected. Location uses IP geolocation for privacy. For precise location, use GPS-enabled device with explicit permission.

### Storage Full

**Issue**: Cannot capture new media
**Solution**:

1. Increase storage limit in Settings
2. Clear captured media manually
3. Check `.e/device-captures/` directory

## Conclusion

The device node actions system provides powerful capabilities for agents while maintaining strict privacy and security controls. All features are opt-in, locally stored, and respect OS permissions.
