<script lang="ts">
  /**
   * PluginConfigForm (LYK-1033) — renders the configuration block declared
   * in a plugin manifest's contributes.configuration.properties. Each
   * property gets an input keyed on its declared `type`; the form reads/
   * writes through settingsStore.pluginConfigValue / setPluginConfigValue
   * so changes persist + broadcast a configuration.changed event to the
   * plugin's iframe(s).
   *
   * v1 supports: string, number, boolean, enum (rendered as <select>),
   * and string[] (newline-textarea). The `object` type is acknowledged
   * with a JSON textarea but parse-on-blur — minimal but unblocks plugins
   * with structured config without a custom widget per property.
   */
  import { settingsStore } from '$lib/stores/settings.svelte';
  import type { ConfigurationContribution, ConfigurationProperty } from '@e/shared';

  let { block, title }: { block: ConfigurationContribution; title?: string } = $props();

  function current(key: string, prop: ConfigurationProperty): unknown {
    const v = settingsStore.pluginConfigValue(key);
    return v === undefined ? prop.default : v;
  }

  function set(key: string, value: unknown) {
    settingsStore.setPluginConfigValue(key, value);
  }
</script>

<div class="config-block">
  <div class="config-block-title">{title ?? block.title ?? 'Configuration'}</div>
  <div class="config-rows">
    {#each Object.entries(block.properties) as [key, prop] (key)}
      {@const value = current(key, prop)}
      <label class="config-row">
        <span class="config-key">{key}</span>
        {#if prop.description}
          <span class="config-desc">{prop.description}</span>
        {/if}

        {#if prop.enum}
          <select
            value={value as string}
            onchange={(e) => set(key, (e.target as HTMLSelectElement).value)}
          >
            {#each prop.enum as opt}
              <option value={String(opt)}>{String(opt)}</option>
            {/each}
          </select>
        {:else if prop.type === 'boolean'}
          <input
            type="checkbox"
            checked={value === true}
            onchange={(e) => set(key, (e.target as HTMLInputElement).checked)}
          />
        {:else if prop.type === 'number'}
          <input
            type="number"
            value={value === undefined || value === null ? '' : String(value)}
            oninput={(e) => {
              const raw = (e.target as HTMLInputElement).value;
              set(key, raw === '' ? undefined : Number(raw));
            }}
          />
        {:else if prop.type === 'array'}
          <textarea
            rows="3"
            value={Array.isArray(value) ? (value as string[]).join('\n') : ''}
            oninput={(e) => {
              const lines = (e.target as HTMLTextAreaElement).value
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean);
              set(key, lines);
            }}
          ></textarea>
        {:else if prop.type === 'object'}
          <textarea
            rows="4"
            value={value == null ? '' : JSON.stringify(value, null, 2)}
            onblur={(e) => {
              const raw = (e.target as HTMLTextAreaElement).value;
              if (!raw.trim()) {
                set(key, undefined);
                return;
              }
              try {
                set(key, JSON.parse(raw));
              } catch (err) {
                console.warn(`[plugin-config] ${key}: invalid JSON`, err);
              }
            }}
          ></textarea>
        {:else}
          <!-- string + fallback -->
          <input
            type="text"
            value={value == null ? '' : String(value)}
            oninput={(e) => set(key, (e.target as HTMLInputElement).value)}
          />
        {/if}
      </label>
    {/each}
  </div>
</div>

<style>
  .config-block {
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    padding: 10px 12px;
    margin-top: 8px;
    background: var(--bg-secondary, transparent);
  }
  .config-block-title {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
  }
  .config-rows {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .config-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: var(--fs-xs);
  }
  .config-key {
    font-family: var(--font-family);
    font-size: var(--fs-xxs);
    color: var(--text-primary);
    letter-spacing: 0.5px;
  }
  .config-desc {
    color: var(--text-tertiary);
    font-size: var(--fs-xxs);
  }
  .config-row input[type='text'],
  .config-row input[type='number'],
  .config-row select,
  .config-row textarea {
    padding: 4px 8px;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    background: var(--bg-primary, var(--bg-elevated));
    color: var(--text-primary);
    font: inherit;
    font-size: var(--fs-xs);
    outline: none;
    font-family: var(--font-family);
  }
  .config-row input[type='text']:focus,
  .config-row input[type='number']:focus,
  .config-row select:focus,
  .config-row textarea:focus {
    border-color: var(--accent-primary);
  }
  .config-row textarea {
    resize: vertical;
  }
</style>
