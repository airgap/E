<script lang="ts">
  import { FEATURE_FLAGS, type FeatureFlag, type FeatureFlagGroup } from '$lib/config/featureFlags';
  import { featureFlags } from '$lib/stores/featureFlags.svelte';

  // Group the flat registry for display.
  const groups = $derived.by(() => {
    const m = new Map<FeatureFlagGroup, typeof FEATURE_FLAGS>();
    for (const f of FEATURE_FLAGS) {
      const arr = (m.get(f.group) ?? []) as (typeof FEATURE_FLAGS)[number][];
      arr.push(f);
      m.set(f.group, arr as unknown as typeof FEATURE_FLAGS);
    }
    return [...m.entries()];
  });

  const enabledCount = $derived(FEATURE_FLAGS.filter((f) => featureFlags.enabled(f.key)).length);
</script>

<div class="labs">
  <div class="labs-head">
    <div>
      <h3>Labs — experimental editor</h3>
      <p>
        Things E can do that a VS Code extension can't (it renders its own editor and is
        agent-native). All off by default. {enabledCount} on.
      </p>
    </div>
    {#if enabledCount > 0}
      <button class="reset" onclick={() => featureFlags.disableAll()}>Disable all</button>
    {/if}
  </div>

  {#each groups as [group, flags] (group)}
    <section>
      <span class="group-label">{group}</span>
      {#each flags as f (f.key)}
        {@const implemented = (f as FeatureFlag).implemented}
        <label class="flag" class:soon={!implemented}>
          <input
            type="checkbox"
            checked={featureFlags.enabled(f.key)}
            onchange={() => featureFlags.toggle(f.key)}
          />
          <span class="meta">
            <span class="name">
              {f.label}
              {#if !implemented}<span class="badge">planned</span>{/if}
              <span class="issue">{f.issue}</span>
            </span>
            <span class="desc">{f.description}</span>
          </span>
        </label>
      {/each}
    </section>
  {/each}

  <p class="note">
    Editor-extension flags (inline widgets) apply when the file is next opened — reopen the tab
    after toggling.
  </p>
</div>

<style>
  .labs {
    display: flex;
    flex-direction: column;
    gap: 18px;
    max-width: 640px;
  }
  .labs-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
  }
  .labs-head h3 {
    margin: 0 0 4px;
    font-size: var(--fs-md, 1rem);
  }
  .labs-head p {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--fs-sm, 0.85rem);
  }
  .reset {
    flex-shrink: 0;
    padding: 4px 10px;
    border: 1px solid var(--border-primary);
    background: var(--bg-primary);
    color: var(--text-secondary);
    border-radius: var(--ht-radius, 6px);
    cursor: pointer;
  }
  .reset:hover {
    color: var(--text-primary);
    border-color: var(--accent-primary);
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .group-label {
    font-size: var(--fs-xs, 0.7rem);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-tertiary);
    margin-bottom: 4px;
  }
  .flag {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 7px 8px;
    border-radius: var(--ht-radius, 6px);
    cursor: pointer;
  }
  .flag:hover {
    background: var(--bg-hover);
  }
  .flag.soon {
    opacity: 0.72;
  }
  .flag input {
    margin-top: 2px;
  }
  .meta {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .name {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-sm, 0.9rem);
    color: var(--text-primary);
  }
  .badge {
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent-warning);
    border: 1px solid var(--accent-warning);
    border-radius: 100px;
    padding: 0 6px;
  }
  .issue {
    font-family: var(--font-family);
    font-size: 0.62rem;
    color: var(--text-tertiary);
  }
  .desc {
    font-size: var(--fs-xs, 0.78rem);
    color: var(--text-secondary);
  }
  .note {
    font-size: var(--fs-xs, 0.75rem);
    color: var(--text-tertiary);
    margin: 0;
  }
</style>
