# Spatial Audio Testing Plan

## Quick Test (5 minutes)

### Prerequisites

- Use headphones for best results
- Have 3 workspaces ready (or create test workspaces)
- Commentary feature must be available

### Steps

1. **Enable Spatial Audio**

   ```
   Settings → Audio → Enable "Text-to-Speech (Commentary)"
   Settings → Audio → Enable "Spatial Audio (Experimental)"
   ```

2. **Open 3 Workspaces**
   - Workspace A (will be Center)
   - Workspace B (will be Left)
   - Workspace C (will be Right)

3. **Start Commentary**
   - Click commentary panel for each workspace
   - Enable commentary TTS
   - Select any personality

4. **Trigger Activity**
   - Perform actions in each workspace to trigger commentary
   - Listen for audio differences
   - Note workspace position assignments

5. **Verify Positions**
   ```
   Settings → Audio → "Active Workspace Positions"
   ```
   Should show:
   - Workspace A: Center
   - Workspace B: Left
   - Workspace C: Right

## Expected Results

### Current Implementation (Browser TTS)

- ✅ Positions are assigned correctly
- ✅ UI shows assigned positions
- ⚠️ Spatial effect is subtle (pitch/rate only)
- ⚠️ May be hard to distinguish without practice

### Future Implementation (Cloud TTS)

- ✅ Clear left/center/right separation
- ✅ Easy to identify which workspace is speaking
- ✅ Natural spatial audio with headphones

## Detailed Test Scenarios

### Scenario 1: Position Cycling (7+ Workspaces)

**Objective**: Verify position assignment cycles correctly

1. Create 7 workspaces
2. Enable spatial audio
3. Start commentary on each
4. Verify position pattern:
   - WS1: Center
   - WS2: Left
   - WS3: Right
   - WS4: Left
   - WS5: Right
   - WS6: Center
   - WS7: Left

### Scenario 2: Position Reset

**Objective**: Verify reset functionality

1. Assign positions to 3+ workspaces
2. Settings → Audio → Click "Reset" button
3. Verify positions are cleared
4. Restart commentary
5. Verify positions are reassigned from scratch

### Scenario 3: Multi-Workspace Monitoring

**Objective**: Test practical use case

1. Enable spatial audio
2. Start background agents on 3 workspaces
3. Enable commentary on each
4. Monitor all 3 simultaneously
5. Try to identify which workspace is speaking
6. Note: With browser TTS, this may be challenging

**Feedback Questions**:

- Can you distinguish workspaces by audio?
- Is it useful or distracting?
- Would clearer spatial separation help?

### Scenario 4: Settings Persistence

**Objective**: Verify settings are saved

1. Enable spatial audio
2. Reload browser/app
3. Verify spatial audio remains enabled
4. Verify workspace positions persist (if still active)

### Scenario 5: Browser Compatibility

**Objective**: Test across browsers

Test in:

- ✅ Chrome/Chromium
- ✅ Firefox
- ✅ Safari
- ✅ Edge

Verify:

- Web Audio API support
- SpeechSynthesis support
- No console errors
- Settings UI renders correctly

## Performance Testing

### CPU Usage

1. Enable spatial audio
2. Start commentary on 5+ workspaces
3. Monitor CPU usage
4. Expected: Minimal overhead (<5% increase)

### Memory Usage

1. Run spatial audio for extended period (30+ min)
2. Monitor memory usage
3. Expected: No memory leaks, stable memory

### Audio Quality

1. Listen for audio artifacts
2. Check for:
   - ✅ No distortion
   - ✅ No popping/clicking
   - ✅ Smooth transitions
   - ✅ Consistent volume

## Accessibility Testing

### Screen Reader Compatibility

1. Enable screen reader
2. Navigate to spatial audio settings
3. Verify all controls are labeled
4. Verify position info is announced

### Keyboard Navigation

1. Use Tab to navigate spatial audio settings
2. Use Space/Enter to toggle switches
3. Verify focus indicators are visible

## Known Limitations

1. **Browser TTS Spatial Limitation**
   - True spatial positioning not possible with SpeechSynthesis
   - Only pitch/rate variations currently implemented
   - See docs/features/spatial-audio.md for details

2. **SpeechSynthesis.cancel() Global Behavior**
   - Cancelling one workspace stops all TTS
   - Web Speech API limitation

3. **Voice Selection**
   - Available voices vary by OS/browser
   - Quality varies by voice

## Feedback Collection

After testing, please provide feedback on:

### Usefulness (1-5 scale)

- Does spatial audio help distinguish commentators?
- Is it easier to monitor multiple workspaces?
- Would you use this feature regularly?

### User Experience

- Is the position assignment intuitive?
- Is the settings UI clear?
- Are the controls easy to use?

### Improvements Needed

- Should positions be customizable?
- Would manual position assignment be better?
- What additional features would help?

### Cloud TTS Interest

- Would you pay for cloud TTS to get true spatial audio?
- Which provider would you prefer (ElevenLabs, Google)?
- What's your expected latency tolerance?

## Reporting Issues

If you encounter issues, please report:

1. **Browser & OS**: [Browser name/version, OS]
2. **Issue Description**: [What happened]
3. **Steps to Reproduce**: [How to trigger the issue]
4. **Expected Behavior**: [What should happen]
5. **Console Errors**: [Any errors in browser console]
6. **Screenshot**: [If applicable]

Example:

```
Browser: Chrome 120.0, macOS 14.0
Issue: Spatial audio settings not persisting
Steps:
  1. Enable spatial audio
  2. Reload page
  3. Settings reset to disabled
Expected: Settings should persist across reloads
Console: No errors
```

## Success Criteria

✅ **Must Have**:

- Positions assigned correctly to workspaces
- Settings UI displays active positions
- No console errors during normal operation
- Settings persist across reloads
- No audio quality degradation

✅ **Should Have**:

- Subtle audio differentiation (current browser TTS)
- Smooth user experience
- Clear documentation
- Helpful error messages

🔮 **Future Goals**:

- Clear spatial separation (with cloud TTS)
- User reports feature is useful for 3+ workspaces
- Positive feedback on UX
- Low distraction rating
