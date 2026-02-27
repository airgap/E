<script lang="ts">
  import type { CommentaryEntry } from '$lib/stores/commentary.svelte';
  import {
    exportAsMarkdown,
    exportAsJSON,
    exportAsAudio,
    downloadExport,
    type ExportFormat,
  } from '$lib/utils/commentary-export';
  import { loadWorkspaceHistory } from '$lib/stores/commentary-history';
  import { uiStore } from '$lib/stores/ui.svelte';

  interface Props {
    show: boolean;
    history: CommentaryEntry[];
    workspacePath?: string;
    workspaceId?: string;
    onClose: () => void;
  }

  let { show = $bindable(), history, workspacePath, workspaceId, onClose }: Props = $props();

  let selectedFormat = $state<ExportFormat>('markdown');
  let selectedTimeRange = $state<'all' | 'last_hour' | 'last_30min'>('all');
  let selectedSource = $state<'session' | 'full'>('session');
  let exportInProgress = $state(false);
  let serverHistoryCount = $state<number | null>(null);
  let serverHistoryLoading = $state(false);

  const formatOptions: Array<{ id: ExportFormat; label: string; description: string }> = [
    { id: 'markdown', label: 'Markdown', description: 'Timestamped text document' },
    { id: 'json', label: 'JSON', description: 'Structured data for analysis' },
    { id: 'audio', label: 'Audio Script', description: 'TTS-ready text transcript' },
  ];

  const timeRangeOptions = [
    { id: 'all' as const, label: 'All', description: 'Full history' },
    { id: 'last_hour' as const, label: 'Last Hour', description: 'Last 60 minutes' },
    { id: 'last_30min' as const, label: 'Last 30 Min', description: 'Last 30 minutes' },
  ];

  // Load server history count when modal opens
  $effect(() => {
    if (show && workspaceId) {
      serverHistoryLoading = true;
      loadWorkspaceHistory(workspaceId, 1, 0)
        .then((entries) => {
          // If we got entries, try loading a larger count
          if (entries.length > 0) {
            return loadWorkspaceHistory(workspaceId!, 5000, 0);
          }
          return [];
        })
        .then((entries) => {
          serverHistoryCount = entries.length;
        })
        .catch(() => {
          serverHistoryCount = null;
        })
        .finally(() => {
          serverHistoryLoading = false;
        });
    }
  });

  let entryCount = $derived(() => {
    if (selectedSource === 'full' && serverHistoryCount !== null) {
      return serverHistoryCount;
    }
    return filteredHistory().length;
  });

  function getTimeRangeTimestamps(): { startTime?: number; endTime?: number } {
    const now = Date.now();
    switch (selectedTimeRange) {
      case 'last_hour':
        return { startTime: now - 60 * 60 * 1000 };
      case 'last_30min':
        return { startTime: now - 30 * 60 * 1000 };
      default:
        return {};
    }
  }

  function filteredHistory(): CommentaryEntry[] {
    const { startTime, endTime } = getTimeRangeTimestamps();
    return history.filter((entry) => {
      if (startTime && entry.timestamp < startTime) return false;
      if (endTime && entry.timestamp > endTime) return false;
      return true;
    });
  }

  async function handleExport() {
    exportInProgress = true;

    try {
      const { startTime, endTime } = getTimeRangeTimestamps();

      // Determine which entries to export
      let entriesToExport: CommentaryEntry[];

      if (selectedSource === 'full' && workspaceId) {
        // Load full history from the server
        const serverEntries = await loadWorkspaceHistory(workspaceId, 5000, 0);
        // Apply time range filtering
        entriesToExport = serverEntries.filter((entry) => {
          if (startTime && entry.timestamp < startTime) return false;
          if (endTime && entry.timestamp > endTime) return false;
          return true;
        });
      } else {
        entriesToExport = filteredHistory();
      }

      if (entriesToExport.length === 0) {
        uiStore.toast('No commentary entries match the selected criteria', 'error');
        return;
      }

      const exportOptions = {
        format: selectedFormat,
        entries: entriesToExport,
        workspacePath,
        startTime,
        endTime,
      };

      let content: string | Blob;

      switch (selectedFormat) {
        case 'markdown':
          content = exportAsMarkdown(exportOptions);
          break;
        case 'json':
          content = exportAsJSON(exportOptions);
          break;
        case 'audio':
          content = await exportAsAudio(exportOptions);
          break;
        default:
          throw new Error(`Unsupported format: ${selectedFormat}`);
      }

      downloadExport(content, selectedFormat);
      uiStore.toast('Commentary exported successfully', 'success');
      onClose();
    } catch (error) {
      console.error('[commentary-export] Export failed:', error);
      uiStore.toast(
        `Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error',
      );
    } finally {
      exportInProgress = false;
    }
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.classList.contains('modal-overlay')) {
      onClose();
    }
  }
</script>

{#if show}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="modal-overlay" onclick={handleClickOutside}>
    <div class="export-modal">
      <div class="modal-header">
        <h3>Export Commentary</h3>
        <button class="close-btn" onclick={onClose} aria-label="Close">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <div class="modal-body">
        <!-- Source Selection -->
        {#if workspaceId && serverHistoryCount !== null && serverHistoryCount > 0}
          <div class="section">
            <label class="section-label">Source</label>
            <div class="option-group horizontal">
              <button
                class="option-card compact"
                class:selected={selectedSource === 'session'}
                onclick={() => (selectedSource = 'session')}
              >
                <div class="option-content">
                  <span class="option-label">Current Session</span>
                  <span class="option-desc">{history.length} entries</span>
                </div>
                {#if selectedSource === 'session'}
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    class="check-icon"
                  >
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                {/if}
              </button>
              <button
                class="option-card compact"
                class:selected={selectedSource === 'full'}
                onclick={() => (selectedSource = 'full')}
              >
                <div class="option-content">
                  <span class="option-label">Full History</span>
                  <span class="option-desc">
                    {#if serverHistoryLoading}
                      Loading...
                    {:else}
                      {serverHistoryCount} entries
                    {/if}
                  </span>
                </div>
                {#if selectedSource === 'full'}
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    class="check-icon"
                  >
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                {/if}
              </button>
            </div>
          </div>
        {/if}

        <!-- Format Selection -->
        <div class="section">
          <label class="section-label">Format</label>
          <div class="option-group">
            {#each formatOptions as option}
              <button
                class="option-card"
                class:selected={selectedFormat === option.id}
                onclick={() => (selectedFormat = option.id)}
              >
                <div class="option-content">
                  <span class="option-label">{option.label}</span>
                  <span class="option-desc">{option.description}</span>
                </div>
                {#if selectedFormat === option.id}
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    class="check-icon"
                  >
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                {/if}
              </button>
            {/each}
          </div>
        </div>

        <!-- Time Range Selection -->
        <div class="section">
          <label class="section-label">Time Range</label>
          <div class="option-group horizontal">
            {#each timeRangeOptions as option}
              <button
                class="option-card compact"
                class:selected={selectedTimeRange === option.id}
                onclick={() => (selectedTimeRange = option.id)}
              >
                <div class="option-content">
                  <span class="option-label">{option.label}</span>
                  <span class="option-desc">{option.description}</span>
                </div>
                {#if selectedTimeRange === option.id}
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    class="check-icon"
                  >
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                {/if}
              </button>
            {/each}
          </div>
        </div>

        <!-- Export Info -->
        <div class="info-box">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
          <span>
            {#if selectedSource === 'full' && serverHistoryCount !== null}
              Up to {serverHistoryCount}
              {serverHistoryCount === 1 ? 'entry' : 'entries'} from full history
            {:else}
              {entryCount()} commentary {entryCount() === 1 ? 'entry' : 'entries'} available
            {/if}
          </span>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={onClose} disabled={exportInProgress}>
          Cancel
        </button>
        <button
          class="btn btn-primary"
          onclick={handleExport}
          disabled={exportInProgress || (selectedSource === 'session' && history.length === 0)}
        >
          {#if exportInProgress}
            <span class="spinner"></span>
            Exporting...
          {:else}
            <!-- Download icon -->
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(2px);
  }

  .export-modal {
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-lg);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    max-width: 500px;
    width: 90%;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-secondary);
  }

  .modal-header h3 {
    margin: 0;
    font-size: var(--fs-md);
    font-weight: 700;
    color: var(--text-primary);
  }

  .close-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-tertiary);
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    transition: all var(--transition);
  }

  .close-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .section-label {
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .option-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .option-group.horizontal {
    flex-direction: row;
  }

  .option-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all var(--transition);
    text-align: left;
  }

  .option-card.compact {
    padding: 10px 12px;
    flex: 1;
  }

  .option-card:hover {
    border-color: var(--border-primary);
    background: var(--bg-hover);
  }

  .option-card.selected {
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
  }

  .option-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .option-label {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .option-desc {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
  }

  .check-icon {
    flex-shrink: 0;
    color: var(--accent-primary);
  }

  .info-box {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    background: color-mix(in srgb, var(--accent-info) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-info) 20%, transparent);
    border-radius: var(--radius-md);
    font-size: var(--fs-sm);
    color: var(--text-secondary);
  }

  .info-box svg {
    flex-shrink: 0;
    color: var(--accent-info);
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    padding: 16px 20px;
    border-top: 1px solid var(--border-secondary);
  }

  .btn {
    padding: 8px 16px;
    border-radius: var(--radius-md);
    font-size: var(--fs-sm);
    font-weight: 600;
    cursor: pointer;
    transition: all var(--transition);
    border: none;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border-secondary);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--bg-hover);
    border-color: var(--border-primary);
  }

  .btn-primary {
    background: var(--accent-primary);
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent-primary) 90%, black);
  }

  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
