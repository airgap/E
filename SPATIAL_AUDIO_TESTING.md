# Spatial Audio Testing Guide

## Overview

This document provides guidance for testing the experimental spatial audio feature for multi-workspace TTS commentary.

## What is Spatial Audio?

Spatial audio positions TTS (Text-to-Speech) commentary audio in 3D space based on workspace ID. This helps differentiate multiple commentators when monitoring 3+ workspaces simultaneously.

- **Left workspace**: Audio positioned at approximately -2 on the stereo field
- **Center workspace**: Audio positioned at 0 (center)
- **Right workspace**: Audio positioned at approximately +2 on the stereo field
- **4+ workspaces**: Evenly distributed across the stereo field from -2 to 2

## Implementation Details

### Components

1. **Spatial TTS Engine** (`packages/client/src/lib/audio/spatial-tts.ts`)
   - Uses Web Audio API with PannerNode for 3D positioning
   - Manages workspace-to-position mapping
   - Handles audio lifecycle and cleanup

2. **Settings Integration** (`packages/shared/src/settings.ts`)
   - `spatialAudioEnabled`: boolean flag (default: false)
   - Experimental feature, opt-in only

3. **Commentary Audio Bridge** (`packages/client/src/lib/components/effects/CommentaryAudio.svelte`)
   - Syncs settings with spatial TTS engine
   - Watches commentary events and triggers spatial audio

4. **Settings UI** (`packages/client/src/lib/components/settings/SettingsModal.svelte`)
   - Spatial audio toggle in Audio settings tab
   - Shows "Beta" badge
   - Disabled when TTS is disabled

## Testing Instructions

### Prerequisites

1. **Headphones strongly recommended** - Spatial audio effects are most noticeable with headphones
2. **Enable TTS** - Spatial audio requires TTS to be enabled first
3. **Multiple workspaces** - Test with at least 3 workspaces for best results

### Test Scenario 1: Single Workspace

**Expected Result**: No spatial effect needed, audio plays from center

1. Open Settings → Audio tab
2. Enable "Text-to-speech (Commentary)"
3. Enable "Spatial Audio (Experimental)"
4. Open Commentary Panel for a single workspace
5. Start commentary
6. **Expected**: Audio should play normally from center position

### Test Scenario 2: Two Workspaces

**Expected Result**: Audio from different workspaces should appear to come from left and right

1. Open 2 workspaces (use workspace tabs or manager view)
2. Enable TTS and Spatial Audio in settings
3. Start commentary for both workspaces
4. Generate activity in workspace 1, then workspace 2
5. **Expected**:
   - Workspace 1 commentary should sound like it's coming from the left
   - Workspace 2 commentary should sound like it's coming from the right
   - Clear stereo separation when wearing headphones

### Test Scenario 3: Three+ Workspaces

**Expected Result**: Audio distributed across stereo field

1. Open 3+ workspaces
2. Enable TTS and Spatial Audio
3. Start commentary for all workspaces
4. Generate activity across workspaces
5. **Expected**:
   - Workspace 1: Far left
   - Workspace 2: Center
   - Workspace 3: Far right
   - Workspace 4+: Distributed evenly between left and right

### Test Scenario 4: Toggle Spatial Audio

**Expected Result**: Can enable/disable without issues

1. Start with spatial audio enabled and commentary playing
2. Disable spatial audio in settings
3. **Expected**: Audio should fall back to normal (center) playback
4. Re-enable spatial audio
5. **Expected**: Spatial positioning should resume

### Test Scenario 5: Browser Compatibility

Test across different browsers as Web Audio API support varies:

- ✅ Chrome/Edge: Full support expected
- ✅ Firefox: Full support expected
- ⚠️ Safari: May have limitations
- ❌ Mobile browsers: Not recommended (spatial audio less effective on phone speakers)

## Known Limitations

### Technical Constraints

1. **SpeechSynthesis API Limitation**
   - Web Speech API (`SpeechSynthesis`) doesn't provide direct access to audio streams
   - Cannot route directly through Web Audio API nodes
   - Current implementation uses pitch/rate variations as a workaround
   - Future enhancement: Use external TTS APIs (ElevenLabs, Google) that return audio buffers

2. **Workspace Position Assignment**
   - Positions are assigned when workspaces first generate commentary
   - Position assignment persists for the session
   - Reset by refreshing the page or restarting commentary

3. **Browser Autoplay Policies**
   - AudioContext requires user gesture to initialize
   - First interaction (click, keypress) unlocks audio context
   - Handled automatically by `CommentaryAudio` component

## User Feedback Testing

### Questions to Ask Users

1. **Clarity**: "Can you distinguish between different workspace commentaries?"
2. **Usefulness**: "Does spatial audio help you monitor multiple workspaces?"
3. **Distraction**: "Is the spatial effect distracting or helpful?"
4. **Preference**: "Do you prefer spatial audio on or off?"
5. **Quality**: "Is the audio quality acceptable?"

### Success Criteria

- [ ] Users can distinguish at least 2-3 workspace positions
- [ ] Spatial positioning helps with multi-workspace monitoring
- [ ] No significant audio quality degradation
- [ ] No crashes or audio glitches
- [ ] Feature is discoverable in settings
- [ ] Users understand it's experimental/optional

## Debugging

### Console Logging

Spatial audio logs debug information to the browser console:

```
[spatial-tts] AudioContext initialized
[spatial-tts] Updated workspace positions: <workspace-id>: (x, y, z)
[spatial-tts] Speaking for workspace <id> at position <description>
```

### Troubleshooting

**No spatial effect detected:**

- Verify spatial audio is enabled in settings
- Confirm TTS is enabled
- Check browser console for errors
- Try with headphones
- Verify multiple workspaces are active

**Audio not playing:**

- Check TTS volume in settings
- Verify SpeechSynthesis is supported: Open console and type `'speechSynthesis' in window`
- Check system audio settings
- Try clicking the page to unlock AudioContext

**Unexpected behavior:**

- Check browser console for errors
- Verify workspace IDs are unique
- Try disabling and re-enabling spatial audio
- Refresh the page to reset position assignments

## Future Enhancements

### Potential Improvements

1. **True Spatial Audio**
   - Integrate with ElevenLabs or Google TTS APIs
   - Return audio buffers that can be routed through Web Audio API
   - Full PannerNode control for true 3D positioning

2. **Configurable Positions**
   - Allow users to customize workspace positions
   - Visual position editor in settings
   - Save position preferences per workspace

3. **Enhanced Positioning**
   - Use distance (Z-axis) to vary volume
   - Add reverberation for "far" workspaces
   - Doppler effect for "moving" workspaces

4. **Position Indicators**
   - Visual indicator in commentary panel showing workspace position
   - Spatial audio visualization (left/center/right badges)
   - Mini-map of workspace audio positions

5. **Accessibility**
   - Mono mode for users with hearing impairment in one ear
   - Alternative differentiation methods (different voices, pitch, speed)
   - Non-audio position indicators

## Research Notes

### Web Audio API

- **PannerNode**: Provides 3D spatial audio positioning
- **HRTF**: Head-Related Transfer Function for realistic spatial audio
- **Coordinate System**:
  - X: left (-) to right (+)
  - Y: down (-) to up (+)
  - Z: back (-) to front (+)

### Best Practices

- Position sources 1-3 meters from listener for best effect
- Use HRTF panning model for binaural audio
- Test with various audio output devices (headphones, speakers, earbuds)
- Consider user preferences (some find spatial audio distracting)

## Conclusion

Spatial audio is an experimental feature designed to help power users monitor multiple workspaces simultaneously. It leverages Web Audio API to create a more intuitive multi-workspace experience.

**Recommendation**: Start with 2-3 workspaces and headphones for the best initial experience.

---

**Feature Status**: Experimental (Beta)
**Default State**: Disabled
**Last Updated**: 2026-02-20
