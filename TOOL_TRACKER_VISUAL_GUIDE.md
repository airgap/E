# Tool Tracker - Visual Guide

## The Problem & Solution at a Glance

### ❌ BEFORE - No Feedback

```
User: "Write a complex system architecture"
↓
[Message field empty for 30 seconds]
↓
[Still empty... is it working?]
↓
[User refreshes page in frustration]
```

### ✅ AFTER - Live Progress

```
User: "Write a complex system architecture"
↓
TOOL EXECUTION                              0/15
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0%
↓
TOOL EXECUTION                              5/15
███████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 33%
↓
TOOL EXECUTION                             10/15
██████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 67%
↓
TOOL EXECUTION                             15/15
██████████████████████████████████████████ 100%
↓
"Here's the architecture I've designed..."
```

## Real-World Scenarios

### Scenario 1: File Analysis (5 tools)

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ TOOL EXECUTION                              3/5     ┃
┃ ███████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 60%   ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ ✓ read_file                              0.3s      ┃
┃ ✓ analyze_syntax                         0.8s      ┃
┃ ⟳ run_linter                                       ┃
┃ ○ generate_report                                  ┃
┃ ○ format_output                                    ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

Here's what I found in your code:
...content below tracker...
```

### Scenario 2: Complex Project Setup (20 tools)

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ TOOL EXECUTION                            18/20     ┃
┃ ████████████████████░░░░░░░░░░░░░░░░░░░░░░░ 90%   ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ ✓ Completed      18                                 ┃
┃ ⟳ Running         1                                 ┃
┃ ✕ Errors          1                                 ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

I've set up your project. Here's a summary:
...content below tracker...
```

### Scenario 3: Error Handling (7 tools with 2 errors)

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ TOOL EXECUTION                              5/7     ┃
┃ ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 71%   ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ ✓ validate_syntax                        0.2s      ┃
┃ ✓ check_dependencies                     1.1s      ┃
┃ ✕ build_project                          error     ┃
┃ ✓ analyze_errors                         0.5s      ┃
┃ ✕ run_tests                              error     ┃
┃ ⟳ generate_report                                  ┃
┃ ○ notify_developer                                 ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

I found some issues while building:
- build_project failed: Missing configuration
- run_tests failed: Build dependency failed

Here's what to fix:
...content below tracker...
```

## Progress States Animation

### Starting (0/20)

```
TOOL EXECUTION                              0/20
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0%
└─ First tools identified
```

### Early Progress (5/20)

```
TOOL EXECUTION                              5/20
█████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 25%
└─ Some tools completing
```

### Midpoint (10/20)

```
TOOL EXECUTION                             10/20
██████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 50%
└─ Halfway there!
```

### Nearly Done (18/20)

```
TOOL EXECUTION                             18/20
██████████████████░░░░░░░░░░░░░░░░░░░░░░░░ 90%
└─ Almost finished
```

### Complete (20/20)

```
TOOL EXECUTION                             20/20
██████████████████████████████████████████ 100%
└─ All done!
```

## Color Coding Guide

### Status Colors

```
✓ Green  - Success
  └─ Tool completed without errors

⟳ Blue   - Running
  └─ Tool currently executing

✕ Red    - Error
  └─ Tool failed with an error

○ Gray   - Pending
  └─ Tool in queue, not started
```

### Progress Bar Colors

```
Gradient: [Primary Blue] ──→ [Secondary Green]
└─ Smoothly transitions as progress increases
```

### Background Colors

```
Border:      Bright Primary Blue
Background:  Semi-transparent Secondary
└─ Matches application theme
```

## Compact View (Many Tools)

When there are **more than 5 tools**, the tracker switches to compact summary mode:

### Detailed View (≤5 tools)

```
┌─ Tracker Header with progress bar
├─ Tool 1: ✓ name                  0.3s
├─ Tool 2: ⟳ name
├─ Tool 3: ✕ name                  error
├─ Tool 4: ○ name
└─ Tool 5: ○ name
```

### Compact View (>5 tools)

```
┌─ Tracker Header with progress bar
├─ ✓ Completed    15
├─ ⟳ Running       2
└─ ✕ Errors        1
```

## Responsive Behavior

### Desktop (Wide)

```
Full progress bar displayed
Full tool names visible
Duration always shown
Individual tools listed for ≤5 tools
```

### Tablet (Medium)

```
Slightly condensed progress bar
Tool names may truncate
Duration shown for ≤5 tools
Compact view used at threshold
```

### Mobile (Narrow)

```
Full width progress bar
Tool names may wrap
Duration shown where space allows
Always uses compact view for multiple tools
```

## Animation Timing

### Progress Bar

- Smooth transition between percentages
- Duration: 0.3 seconds per update
- Easing: Linear for consistent feel

### Icons

- Status icons animate on change
- Spinner rotates continuously for running
- Color transitions smooth

### Component Appearance

- Slides in from top
- Duration: 0.3 seconds
- Only appears when tools present

## Theme Integration

### Dark Theme (Default)

```
Background:  Semi-transparent dark secondary
Border:      Bright cyan primary (#00b4ff)
Progress:    Cyan → Green gradient
Text:        Light gray
Completed:   Bright green (#00ff88)
Running:     Bright cyan (#00b4ff)
Error:       Bright red (#ff3344)
```

### Light Theme

```
Background:  Semi-transparent light secondary
Border:      Dark cyan primary
Progress:    Cyan → Green gradient
Text:        Dark text
Colors:      Adjusted for light background
```

### Cyberpunk Themes

```
Same colors as dark theme
Enhanced glow effects
Neon accent colors
More prominent progress bar
```

## Usage Example

### Code Request Flow

```
User Types:
  "Analyze this codebase and suggest optimizations"

↓ Click Send

↓ Message appears:

  TOOL EXECUTION                              0/8
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0%

  (Tools start executing)

↓ After 2 seconds:

  TOOL EXECUTION                              2/8
  ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 25%

  ✓ list_files                             0.3s
  ✓ read_package_json                      0.4s
  ⟳ analyze_dependencies
  ○ check_performance
  ...more tools...

↓ After 5 seconds:

  TOOL EXECUTION                              5/8
  █████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 62%

  ✓ list_files                             0.3s
  ✓ read_package_json                      0.4s
  ✓ analyze_dependencies                   1.2s
  ✓ check_performance                      0.8s
  ✓ identify_bottlenecks                   1.1s
  ⟳ generate_report
  ○ format_suggestions

↓ After 8 seconds:

  TOOL EXECUTION                              8/8
  ██████████████████████████████████████████ 100%

  ✓ list_files                             0.3s
  ✓ read_package_json                      0.4s
  ✓ analyze_dependencies                   1.2s
  ✓ check_performance                      0.8s
  ✓ identify_bottlenecks                   1.1s
  ✓ generate_report                        0.9s
  ✓ format_suggestions                     0.6s

Here are the optimizations I found:

1. **Dependency Management**
   - Replace lodash with native array methods
   - Remove unused dependencies...

2. **Performance Improvements**
   - Implement lazy loading for routes
   - Add code splitting...

3. **Code Quality**
   - Add error boundaries
   - Implement proper logging...
```

## Accessibility Features

### Color + Icons (Not Color Alone)

```
✓ = Success (also green)
⟳ = Running (also blue, with animation)
✕ = Error (also red)
○ = Pending (also gray)
```

### Readable Text

```
"3/5" = Both numerator and denominator
"60%" = Explicit percentage
"0.3s" = Clear duration format
```

### High Contrast

```
✓ Text on background: >7:1 ratio
✓ Icons on background: >7:1 ratio
✓ Progress bar: Clear distinction
✓ Error states: Highly visible
```

### Keyboard Navigation

```
✓ No interactive elements needed
✓ Information display only
✓ Tab order not affected
✓ Screen reader compatible
```

## Performance Visualization

### Execution Timeline for 20 Tools

```
Time  Progress  Status
0s    0%        All pending
2s    15%       ✓ 3 done
4s    40%       ✓ 8 done, ⟳ 1 running
6s    70%       ✓ 14 done, ⟳ 1 running
8s    90%       ✓ 18 done, ⟳ 1 running
10s   100%      ✓ 20 done
```

### Throughput Visualization

```
Completed Per Second
└─ 2-3 tools/sec typical
└─ Shows as steady progress bar growth
```

## Troubleshooting Visual Guide

### Problem: Tracker Not Visible

```
Expected:
┌─────────────────────┐
│ TOOL EXECUTION 0/5  │
│ ░░░░░░░░░░░░░░░░░░ │
└─────────────────────┘

Actual:
[Nothing visible]

Check:
1. Are tools actually executing?
2. Is streaming active?
3. Check browser console
```

### Problem: Wrong Tool Count

```
Expected: 20/20
Actual:   15/20

Reason:
- Only tool_use blocks counted
- Text/thinking blocks ignored
- Check if all tools recorded

Verify:
- Open browser DevTools
- Check streamStore.contentBlocks
- Count 'tool_use' items
```

### Problem: Progress Stuck

```
Expected:
0% ───→ 50% ───→ 100%

Actual:
0% ───X (stuck)

Check:
- Tool results stored?
- No streaming error?
- Results matching tool IDs?
```

## Interactive Elements

The tracker is **display-only** - no interactive elements:

- ✓ No buttons to click
- ✓ No expandable sections
- ✓ No keyboard navigation needed
- ✓ Purely informational

## Animation Behavior

### Smooth Transitions

```
Progress bar:    Smooth percentage growth
Status change:   Instant icon update
Color change:    Smooth fade
Entry/Exit:      Slide animation
```

### GPU-Accelerated

```
All CSS animations:
- Use transform property
- Use opacity property
- Run at 60+ FPS
- Zero jank
```

---

**Visual feedback makes users happy!** 😊✨
