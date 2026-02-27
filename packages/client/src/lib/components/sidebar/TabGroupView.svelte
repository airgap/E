<script lang="ts">
  import type { TabGroup } from '$lib/stores/sidebarLayout.svelte';
  import TabGroupBar from './TabGroupBar.svelte';
  import SidebarTabContent from './SidebarTabContent.svelte';

  interface Props {
    group: TabGroup;
    column: 'left' | 'right';
    groupIndex: number;
  }

  let { group, column, groupIndex }: Props = $props();
</script>

<div class="tab-group-view">
  <TabGroupBar {group} {column} {groupIndex} />
  <div class="tab-group-content">
    <SidebarTabContent tabId={group.activeTab} />
  </div>
</div>

<style>
  .tab-group-view {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
    overflow: hidden;
  }

  .tab-group-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
  }
</style>
