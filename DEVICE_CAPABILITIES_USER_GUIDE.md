# Device Capabilities User Guide

## Quick Start

### 1. Enable Device Capabilities

1. Open **Settings** (⚙️ icon or `Ctrl+,`)
2. Navigate to **Device Capabilities** section
3. Toggle on the capabilities you want to enable:
   - 📸 **Screenshot Capture** - For visual debugging and documentation
   - 📷 **Camera Access** - For barcode scanning and document photography (limited support)
   - 📍 **Location Awareness** - For timezone detection and context

### 2. Grant OS Permissions (if needed)

#### macOS

When you first use screenshot capture, macOS will prompt you:

- **Screen Recording**: Required for screenshots
  - Go to System Preferences > Security & Privacy > Privacy > Screen Recording
  - Enable the checkbox for the E app

#### Linux

Ensure you have screenshot tools installed:

```bash
# Install gnome-screenshot (recommended)
sudo apt install gnome-screenshot

# Or install scrot as fallback
sudo apt install scrot
```

### 3. Use Device Capabilities

Once enabled, the agent can use device capabilities automatically when appropriate.

## Use Cases

### Visual Debugging

```
You: "The login page looks weird in dark mode. Can you check it?"

Agent: "Let me take a screenshot to see what's happening."
[Agent uses CaptureScreenshot tool]
Agent: "I can see the issue - the text color isn't adjusting properly..."
```

### Timezone-Aware Scheduling

```
You: "Schedule a team meeting for 2 PM today"

Agent: "Let me check your timezone first."
[Agent uses GetLocation tool]
Agent: "You're in America/New_York (EST). I'll schedule the meeting for 2 PM EST..."
```

### QR Code Scanning (Future)

```
You: "What's in this QR code?"

Agent: "Let me scan that for you."
[Agent uses CaptureCamera tool]
Agent: "The QR code contains a link to..."
```

## Privacy & Security

### What's Stored

- Screenshots are saved to `.e/device-captures/screenshots/`
- Camera photos are saved to `.e/device-captures/camera/`
- Location data is ephemeral (not stored, only used for timezone)

### What's NOT Stored

- GPS coordinates (only IP-based location is used)
- Camera feed video (only snapshots)
- External services (everything is local)

### How to Review Captures

1. Open Settings > Device Capabilities
2. Scroll to "Recent Captures" section
3. View list of all captured media with timestamps

### How to Clear Captures

1. Open Settings > Device Capabilities
2. Scroll to "Storage Management"
3. Click "Clear All Captures"

## Storage Management

### Default Storage Limit

- **100 MB** by default
- Configurable from 10 MB to 1000 MB

### Automatic Cleanup

When storage limit is reached:

1. Oldest captures are automatically deleted
2. You'll see a warning when storage is >80% full

### Manual Cleanup

- Delete individual captures from the "Recent Captures" list
- Or use "Clear All Captures" to delete everything

## Troubleshooting

### "Screenshot capability is disabled"

**Fix**: Enable it in Settings > Device Capabilities

### "Permission denied" (macOS)

**Fix**: Grant Screen Recording permission in System Preferences

### Screenshot appears black (macOS)

**Fix**: The app doesn't have Screen Recording permission. Check System Preferences.

### "No screenshot tool available" (Linux)

**Fix**: Install `gnome-screenshot` or `scrot`:

```bash
sudo apt install gnome-screenshot
```

### Storage not updating

**Fix**: Refresh the Settings panel or restart the app

## Advanced Configuration

### Change Storage Directory

1. Open Settings > Device Capabilities
2. Find "Storage Directory" field
3. Enter a custom path (relative to workspace)
4. Default: `.e/device-captures`

### Change Storage Limit

1. Open Settings > Device Capabilities
2. Find "Storage Limit" slider
3. Adjust from 10 MB to 1000 MB
4. Default: 100 MB

## Platform Support

| Capability | Desktop (macOS) | Desktop (Linux) | Desktop (Windows) | Browser    |
| ---------- | --------------- | --------------- | ----------------- | ---------- |
| Screenshot | ✅ Full         | ✅ Full         | ⚠️ Limited        | ⚠️ Limited |
| Camera     | ⚠️ Limited      | ⚠️ Limited      | ⚠️ Limited        | ⚠️ Limited |
| Location   | ✅ Full         | ✅ Full         | ✅ Full           | ✅ Full    |

**Legend**:

- ✅ Full: Fully implemented and tested
- ⚠️ Limited: Placeholder or requires additional setup
- ❌ Not supported: Not available on this platform

## Examples

### Example 1: Debug UI Issue

```
User: "The header nav is broken on mobile view"

Agent: [Uses CaptureScreenshot]
Agent: "I can see the issue. The flex layout is wrapping incorrectly.
The problem is in navigation.css line 45 - the flex-wrap should be
nowrap instead of wrap..."
```

### Example 2: Timezone Context

```
User: "What time should I join the standup?"

Agent: [Uses GetLocation to detect timezone]
Agent: "Based on your timezone (America/Los_Angeles, PST),
the standup is at 9:00 AM your time."
```

### Example 3: Visual Documentation

```
User: "Create documentation for the new dashboard"

Agent: [Uses CaptureScreenshot to capture the dashboard]
Agent: "Here's the documentation with screenshots:
# Dashboard Overview
[Screenshot of main dashboard]
The dashboard provides...
"
```

## Tips for Best Results

1. **Enable only what you need**: Each capability has privacy implications. Only enable what you'll use.

2. **Review captures regularly**: Check the "Recent Captures" section to see what's been saved.

3. **Set appropriate storage limits**: Higher limits allow more history but use more disk space.

4. **Grant OS permissions when prompted**: Screenshot and camera features won't work without OS permissions.

5. **Use in desktop app**: Device capabilities work best in the Tauri desktop app. Browser mode has limitations.

## FAQ

**Q: Does the camera stay on all the time?**
A: No, camera access is only active when the agent explicitly requests it, and only if you've enabled camera capability in settings.

**Q: Can the agent access my camera without asking?**
A: No, the agent must explicitly invoke the CaptureCamera tool, and your OS will prompt you for permission on first use.

**Q: Where are screenshots saved?**
A: Screenshots are saved to `.e/device-captures/screenshots/` inside your workspace directory.

**Q: Can I disable capabilities at any time?**
A: Yes, toggle them off in Settings > Device Capabilities. Already-captured media will remain until you delete it.

**Q: Does location tracking use GPS?**
A: No, location awareness uses IP-based geolocation for approximate city-level location. No GPS tracking.

**Q: Are captures sent to Anthropic or other services?**
A: No, all captures are stored locally. They're only included in the conversation context, not uploaded separately.

**Q: Can I use device capabilities in the web browser?**
A: Limited support. Screenshot requires browser extensions, camera uses browser MediaDevices API with permission prompts.

**Q: How do I know when the agent is using device capabilities?**
A: Tool uses appear in the conversation with clear labels like "📸 CaptureScreenshot" in the tool use details.

## Support

For issues or questions:

1. Check this guide first
2. Review the implementation docs: `DEVICE_CAPABILITIES_IMPLEMENTATION.md`
3. Check the browser/desktop console for error messages
4. Open an issue on GitHub with:
   - Your OS and version
   - Desktop app vs browser mode
   - Error messages from console
   - Steps to reproduce

---

Last updated: 2026-02-25
Version: 1.0.0
