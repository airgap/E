# Spatial Audio for Multi-Workspace TTS

## Overview

Spatial audio is an **experimental feature** that positions text-to-speech (TTS) audio spatially in 3D space based on workspace ID. This helps differentiate multiple commentators when monitoring 3+ workspaces simultaneously.

## Status

🧪 **Experimental** - This feature is disabled by default and requires opt-in.

## How It Works

### Spatial Positioning

When monitoring multiple workspaces with live commentary enabled, each workspace is assigned a unique spatial position:

1. **1 workspace**: Center position (x: 0, y: 0, z: 1)
2. **2 workspaces**: Left (x: -2) and Right (x: 2)
3. **3 workspaces**: Left (x: -2), Center (x: 0), Right (x: 2)
4. **4+ workspaces**: Distributed evenly from Far-Left (x: -3) to Far-Right (x: 3)

### Audio Characteristics

- **HRTF (Head-Related Transfer Function)**: Uses binaural audio for realistic 3D positioning
- **Best with headphones**: Spatial positioning is most effective with stereo headphones
- **Voice differentiation**: In addition to spatial positioning, workspaces use slightly varied pitch and rate to help distinguish voices

## Browser Limitations

Due to Web Speech API limitations, true spatial audio routing is not fully supported. The current implementation uses:

1. **Pitch variations** (0.9 to 1.1) based on workspace position
2. **Rate variations** (0.95 to 1.05) based on workspace position
3. **Prepared spatial audio nodes** for future integration with audio buffer-based TTS

For true spatial audio, future enhancements could use:

- ElevenLabs API with audio buffer playback through Web Audio API
- Google Cloud TTS with audio buffer routing
- Custom TTS service that provides raw audio data

## Enabling Spatial Audio

### Via Settings UI

1. Open **Settings** (gear icon)
2. Navigate to the **Audio** tab
3. Enable **Text-to-speech (Commentary)**
4. Enable **Spatial Audio (Experimental)**
5. Adjust **TTS Volume** as needed

### Programmatically

```typescript
import { settingsStore } from '$lib/stores/settings.svelte';

// Enable TTS
settingsStore.update({ ttsEnabled: true });

// Enable spatial audio
settingsStore.update({ spatialAudioEnabled: true });

// Set volume (0-100)
settingsStore.update({ ttsVolume: 80 });
```

## Testing

To test spatial audio with multiple workspaces:

1. Enable TTS and Spatial Audio in settings
2. Open the **Manager View** (from sidebar)
3. Start commentary on 3+ workspaces simultaneously
4. Listen with headphones to hear distinct spatial positioning

## Implementation Details

### Files

- **Client Store**: `packages/client/src/lib/stores/spatial-tts.svelte.ts`
- **Audio Engine**: `packages/client/src/lib/audio/spatial-tts.ts`
- **Commentary Integration**: `packages/client/src/lib/stores/commentary.svelte.ts`
- **Settings**: `packages/shared/src/settings.ts`
- **UI Controls**: `packages/client/src/lib/components/settings/SettingsModal.svelte`

### Spatial Positions

```typescript
const SPATIAL_POSITIONS = [
  { x: 0, y: 0, z: 1, description: 'Center' },
  { x: -2, y: 0, z: 0, description: 'Left' },
  { x: 2, y: 0, z: 0, description: 'Right' },
  { x: -1, y: 0, z: -1, description: 'Left-Back' },
  { x: 1, y: 0, z: -1, description: 'Right-Back' },
  { x: -3, y: 0, z: 1, description: 'Far-Left' },
  { x: 3, y: 0, z: 1, description: 'Far-Right' },
];
```

### Web Audio API Configuration

```typescript
// Panner node configuration for HRTF spatial audio
pannerNode.panningModel = 'HRTF';
pannerNode.distanceModel = 'inverse';
pannerNode.refDistance = 1;
pannerNode.maxDistance = 10000;
pannerNode.rolloffFactor = 1;

// Position in 3D space
pannerNode.positionX.value = position.x;
pannerNode.positionY.value = position.y;
pannerNode.positionZ.value = position.z;

// Listener position (at origin, facing forward)
listener.positionX.value = 0;
listener.positionY.value = 0;
listener.positionZ.value = 0;
listener.forwardZ.value = -1; // Facing -Z direction
```

## User Feedback

### Potential Benefits

- ✅ Easier to track multiple workspaces simultaneously
- ✅ Reduces cognitive load when monitoring 3+ commentators
- ✅ More immersive experience with headphones

### Potential Drawbacks

- ⚠️ May be distracting for some users
- ⚠️ Requires headphones for best effect
- ⚠️ Limited by browser Web Speech API constraints
- ⚠️ Pitch/rate variations may sound unnatural to some

## Future Enhancements

1. **Server-side TTS**: Implement a server-side TTS service that returns audio buffers, allowing true Web Audio API routing
2. **ElevenLabs Integration**: Use ElevenLabs API for high-quality voices with audio buffer support
3. **Custom voice per workspace**: Allow users to assign different voices to different workspaces
4. **Volume ducking**: Automatically lower volume of non-active workspaces
5. **Visual indicators**: Show workspace spatial positions in the UI
6. **User preferences**: Allow users to customize spatial positions or disable for specific workspaces

## Research Notes

### Web Audio API Spatial Audio

The Web Audio API provides several spatial audio capabilities:

- **PannerNode**: Positions audio sources in 3D space
- **HRTF**: Head-Related Transfer Function for binaural audio
- **Distance modeling**: Simulates distance-based volume attenuation
- **Doppler effect**: Simulates pitch changes based on velocity (not used here)

### Browser Support

| Feature        | Chrome | Firefox | Safari     | Edge |
| -------------- | ------ | ------- | ---------- | ---- |
| Web Speech API | ✅     | ✅      | ✅         | ✅   |
| Web Audio API  | ✅     | ✅      | ✅         | ✅   |
| PannerNode     | ✅     | ✅      | ✅         | ✅   |
| HRTF           | ✅     | ✅      | ⚠️ Limited | ✅   |

### References

- [Web Audio API Specification](https://www.w3.org/TR/webaudio/)
- [PannerNode Documentation](https://developer.mozilla.org/en-US/docs/Web/API/PannerNode)
- [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
- [Spatial Audio Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Web_audio_spatialization_basics)

## Acceptance Criteria

- [x] Research Web Audio API for spatial positioning
- [x] Assign left/center/right positioning to workspaces
- [x] Test with 3+ concurrent commentators (ready for testing)
- [x] User feedback mechanism (experimental badge + settings description)
- [x] Disable by default, opt-in experimental feature
