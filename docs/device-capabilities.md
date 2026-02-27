# Device Node Actions

Device Node Actions provide agents with optional device-level capabilities for screenshot capture, camera access, and location awareness. These features are inspired by OpenClaw's device node system and are designed with privacy and security in mind.

## Features

### Screenshot Capture

- Capture full screen or specific windows for visual debugging
- Automatically save screenshots to workspace directory
- Include screenshots as image attachments in conversations
- Platform-specific implementation:
  - **macOS**: Uses `screencapture` command
  - **Linux**: Falls back to gnome-screenshot, scrot, or ImageMagick
  - **Windows**: Placeholder (to be implemented)
  - **Browser**: Falls back to page screenshots

### Camera Access

- Capture photos from device camera
- Scan barcodes and QR codes (planned)
- Document scanning and photography
- Requires OS camera permissions (TCC on macOS)
- Captured images are automatically included in conversations

### Location Awareness

- Get approximate location for timezone-aware scheduling
- Privacy-friendly IP-based geolocation (no GPS)
- City-level accuracy (~50km)
- Useful for localized suggestions and context-aware development
- Optional browser Geolocation API for higher accuracy (with permission)

## Architecture

### Client-Server Communication

Device capabilities use a hybrid client-server architecture:

1. **Agent Tool Call**: Agent requests device action via tool
2. **Server Validation**: Server checks permissions and validates request
3. **Client Execution**: Client (browser or Tauri) performs actual device access
4. **Result Upload**: Client sends captured data back to server
5. **Attachment**: Data is added as conversation attachment

### Tauri Commands

Native device access is provided via Tauri commands:

```rust
// Screenshot capture
capture_screenshot(display_index, save_path) -> ScreenshotResult

// Camera access
capture_camera(save_path) -> CameraResult

// Location (IP-based)
get_location() -> LocationResult

// List available displays
list_displays() -> Vec<String>
```

### API Endpoints

#### Device Routes (`/api/device/*`)

- `GET /capabilities` - Check which capabilities are enabled
- `POST /screenshot` - Request screenshot capture
- `POST /camera` - Request camera capture
- `POST /location` - Get device location
- `GET /captures` - List captured media files
- `DELETE /capture` - Delete a captured file
- `GET /storage` - Get storage usage statistics

### Agent Tools

#### Screenshot Tool

```typescript
{
  name: 'Screenshot',
  description: 'Capture screenshots for visual debugging',
  input_schema: {
    display_index: number,      // Optional: which display to capture
    save_to_workspace: boolean  // Save to workspace directory
  }
}
```

#### Camera Tool

```typescript
{
  name: 'CaptureCamera',
  description: 'Capture from camera for barcode/document scanning',
  input_schema: {
    save_to_workspace: boolean  // Save to workspace directory
  }
}
```

#### Location Tool

```typescript
{
  name: 'GetLocation',
  description: 'Get approximate location for timezone-aware scheduling',
  input_schema: {}  // No parameters required
}
```

## Configuration

### Settings UI

Device capabilities can be configured in Settings > Device:

- **Screenshot Enabled**: Toggle screenshot capture
- **Camera Enabled**: Toggle camera access
- **Location Enabled**: Toggle location awareness
- **Storage Directory**: Where captured media is saved (default: `.e/device-captures`)
- **Storage Limit**: Maximum storage for captured media in MB (default: 100 MB)

### Storage Management

- Captured media is stored in workspace directory under `.e/device-captures/`
- Separate subdirectories for screenshots and camera captures
- Storage usage tracked and displayed in settings
- Manual cleanup option to clear all captured files
- Oldest files automatically deleted when limit is reached

## Security & Privacy

### Permission Model

1. **Opt-In**: All device capabilities are disabled by default
2. **OS Permissions**: Respects operating system permission model (TCC on macOS)
3. **Explicit Grant**: User must enable each capability in settings
4. **Per-Use Validation**: Permissions checked before each device access
5. **Graceful Failure**: Clear error messages if permissions denied

### Data Privacy

- **Local Storage**: All captured media stored locally in workspace
- **No External Upload**: Media never sent to external services without explicit consent
- **Conversation Attachment**: Media included as attachments, visible to user
- **User Control**: Full control over deletion and storage limits
- **IP Geolocation**: Location uses privacy-friendly IP lookup, not GPS

### Audit Trail

- All device access attempts logged
- Captured media timestamped and tracked
- Storage usage monitored
- User can review capture history in settings

## Implementation Details

### File Structure

```
packages/
├── shared/src/
│   ├── settings.ts          # DeviceCapabilities type
│   ├── device.ts            # Device request/result types
│   └── tools.ts             # Device tool category
├── server/src/
│   ├── routes/device.ts     # Device API endpoints
│   └── services/
│       └── tool-executor.ts # Device tool implementations
├── client/src/
│   └── lib/components/settings/
│       └── DeviceSettings.svelte  # Device settings UI
└── src-tauri/src/
    ├── main.rs              # Tauri command registration
    └── device.rs            # Native device implementations
```

### Settings Schema

```typescript
interface DeviceCapabilities {
  screenshotEnabled: boolean;
  cameraEnabled: boolean;
  locationEnabled: boolean;
  captureStorageDir: string;
  captureStorageLimitMb: number;
}
```

### Capture Results

Screenshots and camera captures return:

```typescript
interface ScreenshotResult {
  path: string; // File path
  data: string; // Base64-encoded image
  mimeType: string; // image/png or image/jpeg
  width: number; // Image width in pixels
  height: number; // Image height in pixels
  size: number; // File size in bytes
  capturedAt: string; // ISO timestamp
}
```

Location results include:

```typescript
interface LocationResult {
  latitude: number;
  longitude: number;
  accuracy: number; // Meters
  timezone: string; // IANA timezone
  locality: string; // City, Region, Country
  timestamp: number; // Unix timestamp
}
```

## Platform Support

### Desktop (Tauri)

- ✅ Screenshot capture (macOS, Linux)
- ⚠️ Screenshot capture (Windows - planned)
- ⚠️ Camera access (planned)
- ✅ Location (IP-based)
- ✅ List displays

### Browser

- ⚠️ Screenshot capture (limited to page screenshots)
- ✅ Camera access (via MediaDevices API)
- ✅ Location (via Geolocation API with permission)

## Usage Examples

### Agent Usage

Agents can use device capabilities when enabled:

```
User: "Take a screenshot of my desktop and analyze the UI layout"

Agent: [Uses Screenshot tool]
<screenshot captured and attached>
Agent: "I can see your desktop has a 3-column layout with..."
```

```
User: "What time zone should I use for this cron job?"

Agent: [Uses GetLocation tool]
Agent: "Based on your location in New York, I recommend using America/New_York timezone (UTC-5). Here's the cron syntax..."
```

### Developer Usage

Testing the APIs directly:

```bash
# Check capabilities
curl http://localhost:3002/api/device/capabilities

# Get storage usage
curl http://localhost:3002/api/device/storage

# List captures
curl http://localhost:3002/api/device/captures
```

## Future Enhancements

1. **Barcode Scanning**: QR code and barcode recognition from camera
2. **OCR**: Text extraction from screenshots and camera captures
3. **Screen Recording**: Video capture for demonstrations
4. **Microphone**: Audio recording for voice notes
5. **Clipboard**: Read/write clipboard for data sharing
6. **File Picker**: Native file selection dialogs
7. **Notifications**: Send system notifications from agents

## References

- OpenClaw device node system (inspiration)
- Tauri API documentation
- W3C Geolocation API
- W3C MediaDevices API
