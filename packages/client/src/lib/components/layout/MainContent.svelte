<script lang="ts">
  import type { Snippet } from 'svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { deviceStore } from '$lib/stores/device.svelte';
  import SplitPane from './SplitPane.svelte';
  import EditorPane from '../editor/EditorPane.svelte';
  import PrimaryPane from './PrimaryPane.svelte';

  let { children } = $props<{ children: Snippet }>();

  // On mobile (touch + no hardware keyboard), always show chat-only.
  // The user can still access the editor via the sidebar file tree.
  const effectiveLayout = $derived(deviceStore.isMobileUI ? 'chat-only' : editorStore.layoutMode);
</script>

{#if effectiveLayout === 'chat-only'}
  <div class="pane-full">
    <PrimaryPane {children} />
  </div>
{:else if effectiveLayout === 'editor-only'}
  <div class="pane-full">
    <EditorPane />
  </div>
{:else if effectiveLayout === 'split-horizontal'}
  <SplitPane
    ratio={editorStore.splitRatio}
    direction="horizontal"
    onRatioChange={(r) => editorStore.setSplitRatio(r)}
  >
    {#snippet first()}
      <div class="pane-full">
        <PrimaryPane {children} />
      </div>
    {/snippet}
    {#snippet second()}
      <EditorPane />
    {/snippet}
  </SplitPane>
{/if}

<style>
  .pane-full {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
</style>
