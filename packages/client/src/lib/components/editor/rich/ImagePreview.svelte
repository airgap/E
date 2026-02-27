<script lang="ts">
  import { getBaseUrl } from '$lib/api/client';
  import { chirpEngine } from '$lib/audio/chirp-engine';
  import { settingsStore } from '$lib/stores/settings.svelte';

  let { data } = $props<{ data: string }>();

  function uiClick() {
    if (settingsStore.soundEnabled) chirpEngine.uiClick();
  }

  let selectedImage = $state<string | null>(null);

  const paths = $derived.by((): string[] => {
    try {
      return JSON.parse(data);
    } catch {
      return [];
    }
  });

  /** Build URL to serve a file through the server's file API */
  function imageUrl(path: string): string {
    return `${getBaseUrl()}/files/read?path=${encodeURIComponent(path)}`;
  }

  function getFileName(path: string): string {
    return path.split('/').pop() || path;
  }
</script>

{#if paths.length > 0}
  <div class="image-preview-wrapper">
    <div class="preview-toolbar">
      <span class="image-count">
        {paths.length} image{paths.length !== 1 ? 's' : ''}
      </span>
    </div>

    <div class="thumbnail-grid">
      {#each paths as path (path)}
        <button
          class="thumbnail"
          onclick={() => {
            selectedImage = selectedImage === path ? null : path;
            uiClick();
          }}
          title={getFileName(path)}
        >
          <img src={imageUrl(path)} alt={getFileName(path)} loading="lazy" />
          <span class="thumb-label">{getFileName(path)}</span>
        </button>
      {/each}
    </div>

    {#if selectedImage}
      <div class="lightbox">
        <div class="lightbox-header">
          <span class="lightbox-path">{selectedImage}</span>
          <button class="lightbox-close" onclick={() => (selectedImage = null)}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div class="lightbox-image">
          <img src={imageUrl(selectedImage)} alt={getFileName(selectedImage)} />
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .image-preview-wrapper {
    border: var(--ht-border-width, 1px) var(--ht-border-style, solid)
      color-mix(in srgb, var(--text-tertiary, #6e7681) 20%, transparent);
    border-radius: var(--ht-radius, 4px);
    overflow: hidden;
    background: var(--bg-primary, #0d1117);
    transition: border-color var(--ht-transition-speed, 125ms) ease;
  }

  .preview-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: color-mix(in srgb, var(--bg-secondary, #161b22) 80%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--text-tertiary, #6e7681) 15%, transparent);
    font-size: var(--fs-sans-xxs);
    color: var(--text-tertiary, #6e7681);
  }

  .thumbnail-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px;
  }

  .thumbnail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 4px;
    border: 1px solid color-mix(in srgb, var(--text-tertiary, #6e7681) 15%, transparent);
    border-radius: 4px;
    background: var(--bg-secondary, #161b22);
    cursor: pointer;
    transition:
      border-color 0.15s,
      background 0.15s;
    max-width: 120px;
  }

  .thumbnail:hover {
    border-color: var(--accent-primary, #00b4ff);
    background: color-mix(in srgb, var(--accent-primary, #00b4ff) 5%, var(--bg-secondary, #161b22));
  }

  .thumbnail img {
    max-width: 100px;
    max-height: 80px;
    object-fit: contain;
    border-radius: 2px;
  }

  .thumb-label {
    font-size: var(--fs-sans-xs);
    color: var(--text-tertiary, #6e7681);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100px;
    text-align: center;
  }

  .lightbox {
    border-top: 1px solid color-mix(in srgb, var(--text-tertiary, #6e7681) 15%, transparent);
    padding: 8px;
  }

  .lightbox-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 6px;
  }

  .lightbox-path {
    flex: 1;
    font-size: var(--fs-sans-xxs);
    color: var(--text-tertiary, #6e7681);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lightbox-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border: none;
    background: none;
    color: var(--text-tertiary, #6e7681);
    cursor: pointer;
    border-radius: 3px;
  }

  .lightbox-close:hover {
    color: var(--text-primary, #c9d1d9);
    background: color-mix(in srgb, var(--text-primary, #c9d1d9) 10%, transparent);
  }

  .lightbox-image {
    display: flex;
    justify-content: center;
    max-height: 400px;
    overflow: auto;
  }

  .lightbox-image img {
    max-width: 100%;
    max-height: 400px;
    object-fit: contain;
    border-radius: 4px;
  }
</style>
