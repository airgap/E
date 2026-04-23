# E → Full IDE: Gap Analysis

Based on mapping the current codebase (`packages/server`, `packages/client`, `src-tauri`, 86 route modules, 181 Svelte components, CodeMirror 6 editor with ~16 extensions, 6 LSP features wired, xterm.js terminal, SQLite persistence, Tauri v2 shell).

**Framing:** E is already ahead of any mainstream IDE on AI/agent surface (multi-provider kernel, MCP, golems, pattern learning, PRD/story execution, permission modes, remote access). The gaps are almost entirely in the **traditional editor-and-workstation layer**. Below I rank them by how much they block "E as daily driver."

---

## Tier 0 — Blockers (can't replace VS Code until these land)

### 1. Debugging (DAP) — **missing entirely**

No debugger, no breakpoints, no variable inspector, no call stack, no step-over/in/out, no launch configs. There is no DAP client anywhere in `packages/client/src/lib/components/editor/` or route handler in `packages/server/src/routes/`. This is the single biggest gap — an "IDE" without a debugger is a text editor.

- **Work:** DAP client (WebSocket bridge pattern like the existing LSP one at `services/lsp-instance-manager.ts`), new `routes/dap.ts`, editor gutter for breakpoints, bottom panel for variables/watch/call-stack/threads, `launch.json` schema + UI.
- **Effort:** ~4–6 weeks for a credible v1 (Node + Python + Go adapters).

### 2. Multi-cursor & advanced selection — **missing**

CodeMirror 6 supports multi-cursor natively, but `CodeEditor.svelte` doesn't expose `EditorState.allowMultipleSelections` or the Alt-click/Ctrl-D bindings. Block-select, add-next-occurrence, select-all-occurrences — all absent.

- **Effort:** ~1 day; purely enabling what CM6 already ships.

### 3. Project-wide find & replace — **missing**

`routes/search.ts` exists for read-only codebase search; there's no write-side bulk replace, no preview-then-commit UI, no regex/case/word-boundary toggles in the panel.

- **Effort:** ~1 week. Reuse ripgrep via Bash or a native walker; add a dedicated sidebar panel + diff-preview step.

### 4. File watcher / external-change detection — **missing**

Nothing in `routes/files.ts` or the client stores watches the filesystem. Agents write files constantly — without a watcher, the open editor buffer silently desyncs.

- **Effort:** ~2–3 days. Bun has `fs.watch`; add WebSocket broadcast and an "external change" reconcile in `stores/editor.svelte.ts`.

### 5. Workspace symbols & document outline panel — **missing**

LSP is wired for completions/diagnostics/hover/code-lens/inlay-hints/goto-def, but `textDocument/documentSymbol` and `workspace/symbol` aren't exposed. Breadcrumb uses tree-sitter only. There's no "Outline" sidebar and no Cmd-T symbol search.

- **Effort:** ~3–5 days. Server-side plumbing exists; needs new LSP calls + a panel + a new quick-open mode.

---

## Tier 1 — Serious gaps (IDE feels amateur without these)

### 6. Refactoring beyond LSP quick-fix

No extract-function/variable/method dialogs, no rename-with-scope-preview, no move-file-updates-imports. LSP rename works per-file but there's no preview UI showing all affected files before applying.

- **Effort:** ~1–2 weeks for a preview layer over LSP `workspace/applyEdit`.

### 7. Editor UX polish gaps

- No keybinding customization UI (must edit JSON).
- No vim/emacs modes (CM6 has `@replit/codemirror-vim`; 30 min to plug in).
- No bracket-pair colorization, no bracket matching highlight, no smart indent-on-paste.
- No toggle-comment command.
- No code-folding UI affordances (folding is on but no fold-all/unfold-all, no persistent folds).
- No auto-save / save-on-focus-loss.
- No format-on-save (there's `routes/format.ts` but it isn't wired to an editor event).

### 8. Git visuals

`routes/git/` handles status/staging/commits/snapshots and `GitPanel.svelte` exists, but:

- No visual 3-way merge view (plain `merge-conflict.ts` decoration only).
- No interactive rebase UI, no cherry-pick picker, no bisect.
- No graph view of commits/branches.
- No stash UI beyond primitives.
- No hunk-level staging from the editor gutter (common in modern IDEs).

### 9. Test runner UI

`routes/test-generate.ts` and `routes/test-analyze.ts` exist and the editor has a `test-status-gutter.ts` extension, but there's no test explorer tree, no click-to-run-single-test, no test debugging, no assertion diff viewer, no live-coverage-as-you-type.

- **Effort:** ~2 weeks. Build a test explorer panel consuming test-results.xml/JSON + jump-to-source.

### 10. Build / task / run configuration

`routes/task-runner.ts` discovers npm scripts and Makefiles. Missing: launch profiles, environment-variable sets per profile, watch-mode runners, parsed compiler errors → clickable problem panel, task dependency chains.

### 11. Problems panel

No unified diagnostics view. LSP errors only show as inline squiggles; there's no "Problems" tab aggregating across all open (or all workspace) files with filter/sort. This is table-stakes for any real IDE.

---

## Tier 2 — Rounding out the IDE

### 12. Extension / plugin system

No extension API, no marketplace, no sandbox. E _could_ lean on MCP as its extension mechanism (which is a genuinely strong strategic play — MCP servers ≈ extensions), but nothing exposes editor-side contribution points (commands, views, menus, keybindings) to MCP tools. Until that's there, the community can't extend E the way it extends VS Code.

### 13. Theming & customization UI

12+ built-in themes exist (`lib/config/themes.ts`, `hypertheme.ts`), but no theme editor, no custom-theme import, no per-workspace theme, no syntax-token editor.

### 14. Terminal capabilities

xterm.js is wired with several addons. Missing: split terminals, terminal profiles (preset shells/cwd/env), process tree / resource monitor, port-forwarding UI.

### 15. File management

- No internal diff-two-files command (git diff only).
- No drag-drop in/out of the file tree into the editor.
- No large-file/binary viewer (image viewer, hex view).
- No project-wide search index — `routes/search.ts` is a live scan; will stall on big repos.

### 16. Settings

`SettingsModal.svelte` covers many things but the workspace-level settings (`.e/settings.json`) are hand-edited. No JSON schema validation, no "open default settings" diff view, no settings-sync across machines (despite having Tailscale wired up — could piggyback).

### 17. Collaboration beyond remote access

Remote access works (Tailscale/SSH) but it's single-user-at-a-time. No shared cursors, no inline comments on code, no review-mode diff with threaded comments. Given the multi-golem and cross-session infra already present (`services/cross-session.ts`), this is closer than it looks.

---

## Tier 3 — Nice-to-have / competitive parity

- Performance profiler UI, memory heap viewer, bundle-size analyzer.
- Code metrics (cyclomatic complexity, LoC, hot files).
- Dependency graph visualization.
- Command palette help (`?`), keybinding cheat-sheet, onboarding tour.
- Accessibility pass (screen reader, high-contrast audit, keyboard-only nav).
- Settings sync, telemetry dashboard.
- Snippet library UI (CM6 has `snippet()` — needs UI + storage).

---

## Strategic notes

1. **Where E already leads** — don't rebuild what's strong. The agent kernel, MCP surface, golems, permission modes, pattern learning, PRD/story executor, and remote access are beyond any mainstream IDE. The investment story should be: _"IDE with a built-in team of agents"_ — not _"another VS Code."_

2. **LSP is 80% there.** 6 features shipped, 2–3 missing (documentSymbol, workspace/symbol, semanticTokens). Finishing LSP is cheaper than any Tier-1 item and closes the "feels amateur" perception fastest.

3. **DAP is the existential gap.** Until there's a debugger, serious engineers won't switch. It's also the hardest item — start it now in parallel with the quick wins.

4. **MCP-as-extensions is a differentiator.** Instead of building a VS Code-style extension API, expose editor contribution points over MCP (register commands, contribute views, hook keybindings). Plays to existing strength; doesn't force a second runtime.

5. **Watch out for the doc sprawl.** The root has ~25 top-level `.md` design docs (`DEVICE_*`, `STREAMING_*`, `COMMENTARY_*`, `SELF_IMPROVING_*`, `PATTERN_LEARNING_STATUS.md`, etc.) and a `designs/` folder. Before an IDE push, consolidate — new contributors (or agents) can't navigate it.

6. **Suggested sequencing for a 3-month IDE-push milestone:**
   - **Weeks 1–2:** Multi-cursor, project find/replace, file watcher, workspace symbols, Problems panel, format-on-save. (All small, all high-visibility.)
   - **Weeks 3–6:** DAP v1 (Node + Python), test explorer, visual merge, hunk-staging.
   - **Weeks 7–10:** Refactoring preview, keybinding UI, launch configs, MCP extension contribution points.
   - **Weeks 11–12:** Polish, accessibility pass, docs, onboarding.
