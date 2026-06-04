<!--
  Editor3DView.svelte — editable fisheye "focus" editor (LYK-1113 + LYK-1090).

  Renders the REAL, fully-editable CodeMirror with the fisheye extension on: the
  cursor line is largest and lines shrink with distance, so the focus pops and
  context recedes — depth via scale, the editable cousin of a literal 3D tilt.

  Why not an actual CSS 3D rotation? CodeMirror virtualizes rendering using
  getBoundingClientRect math that a CSS 3D transform collapses — under perspective
  it renders only ~2 lines. So a tilted CM is editable but unusable. The honest
  editable option is fisheye (this); a true geometric tilt is only viable as a
  read-only WebGL render. Flag-gated by the caller (`editor3dText`).
-->
<script lang="ts">
  import CodeEditor from './CodeEditor.svelte';
  import type { EditorTab } from '$lib/stores/editor.svelte';

  let { tab }: { tab: EditorTab } = $props();
</script>

<div class="ed3d">
  <div class="ed3d-bar">
    <span class="ed3d-label">Focus mode</span>
    <span class="ed3d-hint">editable · fisheye scales lines around the cursor</span>
  </div>
  <div class="ed3d-stage">
    <CodeEditor {tab} fisheye />
  </div>
</div>

<style>
  .ed3d {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg-code);
  }
  .ed3d-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px 12px;
    border-bottom: 1px solid var(--border-secondary, rgba(255, 255, 255, 0.08));
    flex-shrink: 0;
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
  }
  .ed3d-label {
    color: var(--text-secondary);
  }
  .ed3d-hint {
    margin-left: auto;
    opacity: 0.7;
  }
  .ed3d-stage {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .ed3d-stage > :global(.code-editor-wrapper) {
    flex: 1;
    min-height: 0;
  }
</style>
