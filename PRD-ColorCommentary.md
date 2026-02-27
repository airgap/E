# PRD: Live Color Commentary System

## Overview

A real-time "eagle's eye" commentary system where AI commentators narrate what's happening in conversations across workspaces. Each workspace can have its own commentator with a distinct personality, providing strategic narration of E's work. Multiple project leads can speak simultaneously about their respective projects, creating a multi-workspace "mission control" experience.

## Goals

1. **Real-time narration** - Live commentary streams as E works, describing strategy and actions
2. **Multiple personalities** - 5+ distinct commentator voices (sports announcer, documentary narrator, technical analyst, comedic observer, first-person project lead)
3. **Per-workspace assignment** - Each workspace gets its own commentator with configurable personality
4. **Manager View integration** - Commentary feeds visible on workspace cards in the multi-workspace dashboard
5. **Optional TTS** - Text-to-speech narration with different voices per personality

## User Personas

- **Multi-project manager** - Monitoring 3-5 workspaces simultaneously, wants quick status updates narrated
- **Solo developer** - Single workspace, wants engaging commentary while E works (sports announcer or comedic tone)
- **Team lead** - Wants professional technical analysis narration for code review sessions
- **Learning developer** - Uses documentary narrator to understand E's strategic decision-making

## Success Metrics

- Users enable commentary in at least 60% of active workspaces
- Average commentary session duration > 10 minutes (indicates engagement)
- Users configure different personalities for different workspaces (shows personality value)
- Manager View adoption increases 30% due to commentary feature

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Client Layer                                                │
├─────────────────────────────────────────────────────────────┤
│  - CommentaryStore (Svelte state management)                │
│  - CommentaryPanel (UI component)                           │
│  - Manager View Integration (commentary on workspace cards) │
│  - Settings UI (personality picker, TTS toggle)             │
└─────────────────────────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Server Layer                                                │
├─────────────────────────────────────────────────────────────┤
│  - Commentary Route (SSE stream endpoint)                   │
│  - Commentator Service (LLM prompt + event aggregation)     │
│  - Event Bridge (mirrors StreamEvents to commentators)      │
│  - TTS Service (optional text-to-speech)                    │
└─────────────────────────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Data Layer                                                  │
├─────────────────────────────────────────────────────────────┤
│  - Commentary Settings (DB table: workspace -> personality) │
│  - Commentary History (optional: save narrations)           │
└─────────────────────────────────────────────────────────────┘
```

## Personalities

### 1. 🎙️ Sports Announcer (3rd person, energetic)

- **Tone**: Fast-paced, exciting, play-by-play
- **Example**: "And E makes the move—three parallel file reads! Excellent strategic positioning as it maps out the architecture before committing to an approach. This is textbook AI coding, folks!"

### 2. 🎬 Documentary Narrator (3rd person, calm)

- **Tone**: David Attenborough observing nature
- **Example**: "Here we observe E in its natural habitat, the codebase. Notice how it carefully examines the streaming infrastructure before making any changes. This patient, methodical approach is characteristic of mature AI agents."

### 3. 🤓 Technical Analyst (3rd person, strategic)

- **Tone**: Professional breakdown of approach and reasoning
- **Example**: "E is employing a depth-first exploration pattern here. By reading the stream store first, then tracing to the event types, it's building a complete mental model before proposing changes. This reduces the risk of architectural mismatches."

### 4. 😄 Comedic Observer (3rd person, witty)

- **Tone**: Self-aware, playful commentary on the AI doing AI things
- **Example**: "There goes E, casually reading 47 files simultaneously like it's just browsing a menu. Meanwhile, I can barely remember what I had for breakfast. The confidence is inspiring, truly."

### 5. 👤 Project Lead (1st person, authoritative)

- **Tone**: First-person narration as if E is the project lead
- **Example**: "I'm analyzing the stream events architecture right now. Let me check how the commentator service should integrate... Ah, I see—we can mirror events through a new bridge. I'll design that next."

## Constraints

- **Performance**: Commentary generation must not slow down E's primary conversation stream
- **Cost**: Use lightweight models (Haiku, GPT-4o-mini) for commentary to keep costs low
- **Privacy**: Commentary should be local-only unless user explicitly enables cloud TTS
- **Latency**: Commentary should trail main conversation by < 5 seconds

## Dependencies

- Existing streaming infrastructure (`stream.ts`, `streamStore`)
- Manager View multi-workspace dashboard
- Settings persistence layer
- (Optional) TTS service integration

## Risks

1. **Commentary lag** - If commentary falls too far behind, it becomes confusing
   - _Mitigation_: Batch events in 3-5 second windows, summarize strategically
2. **Cost accumulation** - Running commentary on every event could get expensive
   - _Mitigation_: Use cheapest models, allow users to set verbosity levels
3. **Distraction** - Commentary might be more distracting than helpful
   - _Mitigation_: Easy mute/toggle, per-workspace control, "strategic milestones only" mode

## Timeline Estimate

- **Phase 1** (Stories 1-5): Core infrastructure and basic commentary - 2-3 days
- **Phase 2** (Stories 6-10): Personality system and UI - 2-3 days
- **Phase 3** (Stories 11-15): Manager View integration and polish - 2 days
- **Phase 4** (Stories 16-18): TTS and advanced features - 2 days

**Total**: 8-10 days of implementation time

## Out of Scope (Future Enhancements)

- Multi-language commentary (international narrators)
- User-created custom personalities
- Commentary replays (scrubbing through past commentary)
- Cross-workspace commentary synthesis ("Here's what's happening across all your projects...")
- Voice cloning for personalized narrators

---

## Stories (See below)
