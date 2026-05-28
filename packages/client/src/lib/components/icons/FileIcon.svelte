<script lang="ts">
  /**
   * Renders a file-type or folder icon — a tinted base shape with an
   * optional 1-3 character label overlay. Shape + color + label all come
   * from `getFileIcon(name, isDirectory, isOpen)` so callers just pass
   * the filename.
   *
   * The base shapes are drawn inline as SVG paths rather than imported
   * from an icon font — keeps the bundle small and avoids FOUT.
   */
  import { getFileIcon, type FileIcon as IconData } from '$lib/utils/fileIcons';
  import { resolvePluginFileIconUrl } from '$lib/stores/pluginIconThemes.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';

  let {
    name,
    directory = false,
    open = false,
    size = 16,
    icon,
  }: {
    name: string;
    directory?: boolean;
    open?: boolean;
    size?: number;
    /** Pre-resolved icon data; if provided, overrides name-based lookup. */
    icon?: IconData;
  } = $props();

  // Plugin icon theme has first dibs (LYK-1039). Re-read on every render
  // so toggling the active theme in settings repaints the tree.
  // settingsStore.activeIconThemeId is touched here so $derived tracks it.
  let pluginIconUrl = $derived(
    settingsStore.activeIconThemeId ? resolvePluginFileIconUrl(name, directory, open) : null,
  );
  let resolved = $derived(icon ?? getFileIcon(name, directory, open));
</script>

{#if pluginIconUrl}
  <!-- Plugin icon theme override (LYK-1039). Inline <img> so the SVG
       (or PNG) the plugin shipped is fetched + cached by the browser
       without us re-implementing image inlining. -->
  <img class="file-icon plugin-icon" src={pluginIconUrl} alt="" width={size} height={size} />
{:else}
  <svg
    class="file-icon"
    class:is-folder={resolved.kind !== 'file'}
    class:is-open={resolved.kind === 'folder-open'}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    style:--icon-color={resolved.color}
  >
    {#if resolved.kind === 'file'}
      <!-- Document with corner fold -->
      <path
        d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"
        fill="var(--icon-color)"
        fill-opacity="0.18"
        stroke="var(--icon-color)"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
      <path
        d="M14 2v6h6"
        fill="none"
        stroke="var(--icon-color)"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
      {#if resolved.label}
        <text
          x="12"
          y="17"
          text-anchor="middle"
          fill="var(--icon-color)"
          font-family="var(--font-family-sans, sans-serif)"
          font-weight="700"
          font-size={resolved.label.length >= 3 ? 6 : 7}
          letter-spacing="0.2">{resolved.label}</text
        >
      {/if}
    {:else if resolved.kind === 'folder-open'}
      <!-- Open folder -->
      <path
        d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z"
        fill="var(--icon-color)"
        fill-opacity="0.22"
        stroke="var(--icon-color)"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
      <path
        d="M3 10h18l-2.2 8.2A2 2 0 0 1 16.9 20H6.1a2 2 0 0 1-1.94-1.5L3 10z"
        fill="var(--icon-color)"
        fill-opacity="0.32"
        stroke="var(--icon-color)"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
      {#if resolved.label}
        <text
          x="12"
          y="17"
          text-anchor="middle"
          fill="var(--icon-color)"
          font-family="var(--font-family-sans, sans-serif)"
          font-weight="700"
          font-size="6"
          letter-spacing="0.2">{resolved.label}</text
        >
      {/if}
    {:else}
      <!-- Closed folder -->
      <path
        d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
        fill="var(--icon-color)"
        fill-opacity="0.24"
        stroke="var(--icon-color)"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
      {#if resolved.label}
        <text
          x="12"
          y="16"
          text-anchor="middle"
          fill="var(--icon-color)"
          font-family="var(--font-family-sans, sans-serif)"
          font-weight="700"
          font-size="6"
          letter-spacing="0.2">{resolved.label}</text
        >
      {/if}
    {/if}
  </svg>
{/if}

<style>
  .file-icon {
    flex: 0 0 auto;
    display: block;
  }
  .plugin-icon {
    object-fit: contain;
  }
</style>
