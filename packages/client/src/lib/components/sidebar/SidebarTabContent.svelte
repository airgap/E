<script lang="ts">
  import type { SidebarTab } from '$lib/stores/ui.svelte';
  import ConversationList from './ConversationList.svelte';
  import WorkPanel from './WorkPanel.svelte';
  import FileTree from './FileTree.svelte';
  import MemoryPanel from './MemoryPanel.svelte';
  import AgentPanel from './AgentPanel.svelte';
  import SearchPanel from './SearchPanel.svelte';
  import SymbolOutline from '../editor/SymbolOutline.svelte';
  import McpPanel from './McpPanel.svelte';
  import TodoScanPanel from './TodoScanPanel.svelte';
  import CostPanel from './CostPanel.svelte';
  import AmbientPanel from './AmbientPanel.svelte';
  import DigestPanel from './DigestPanel.svelte';
  import CustomToolsPanel from './CustomToolsPanel.svelte';
  import InitiativesPanel from './InitiativesPanel.svelte';
  import HelpPanel from './HelpPanel.svelte';
  import GitPanel from './GitPanel.svelte';
  import GitGraphPanel from './GitGraphPanel.svelte';
  import ArtifactsPanel from './ArtifactsPanel.svelte';
  import AgentNotesPanel from './AgentNotesPanel.svelte';
  import ManagerPanel from './ManagerPanel.svelte';
  import CommentaryPanel from './CommentaryPanel.svelte';
  import CommandHistoryPanel from './CommandHistoryPanel.svelte';
  import CanvasPanel from './CanvasPanel.svelte';
  import LearningPanel from './LearningPanel.svelte';
  import ScriptsPanel from './ScriptsPanel.svelte';
  import CrossdrawPanel from './CrossdrawPanel.svelte';
  import ProblemsPanel from './ProblemsPanel.svelte';
  import DebugPanel from './DebugPanel.svelte';
  import DocsPanel from './DocsPanel.svelte';
  import PluginTreeView from './PluginTreeView.svelte';
  import { parsePluginTreeViewTabId } from '$lib/config/sidebarTabs';

  let { tabId }: { tabId: SidebarTab } = $props();

  // LYK-1041: route plugin tree-view tabs to PluginTreeView with the
  // parsed (pluginId, viewId) pair.
  const pluginTreeView = $derived(parsePluginTreeViewTabId(tabId));
</script>

{#if pluginTreeView}
  <PluginTreeView pluginId={pluginTreeView.pluginId} viewId={pluginTreeView.viewId} />
{:else if tabId === 'conversations'}
  <ConversationList />
{:else if tabId === 'files'}
  <FileTree />
{:else if tabId === 'search'}
  <SearchPanel />
{:else if tabId === 'symbols'}
  <SymbolOutline />
{:else if tabId === 'work'}
  <WorkPanel />
{:else if tabId === 'memory'}
  <MemoryPanel />
{:else if tabId === 'agents'}
  <AgentPanel />
{:else if tabId === 'mcp'}
  <McpPanel />
{:else if tabId === 'todos'}
  <TodoScanPanel />
{:else if tabId === 'costs'}
  <CostPanel />
{:else if tabId === 'ambient'}
  <AmbientPanel />
{:else if tabId === 'digest'}
  <DigestPanel />
{:else if tabId === 'custom-tools'}
  <CustomToolsPanel />
{:else if tabId === 'initiatives'}
  <InitiativesPanel />
{:else if tabId === 'help'}
  <HelpPanel />
{:else if tabId === 'git'}
  <GitPanel />
{:else if tabId === 'git-graph'}
  <GitGraphPanel />
{:else if tabId === 'artifacts'}
  <ArtifactsPanel />
{:else if tabId === 'notes'}
  <AgentNotesPanel />
{:else if tabId === 'manager'}
  <ManagerPanel />
{:else if tabId === 'commentary'}
  <CommentaryPanel />
{:else if tabId === 'command-history'}
  <CommandHistoryPanel />
{:else if tabId === 'canvas'}
  <CanvasPanel />
{:else if tabId === 'learning'}
  <LearningPanel />
{:else if tabId === 'scripts'}
  <ScriptsPanel />
{:else if tabId === 'crossdraw'}
  <CrossdrawPanel />
{:else if tabId === 'problems'}
  <ProblemsPanel />
{:else if tabId === 'debug'}
  <DebugPanel />
{:else if tabId === 'docs'}
  <DocsPanel />
{/if}
