/**
 * Feature-flags store (LYK-1081).
 *
 * Holds per-user overrides for the experimental editor flags defined in
 * `config/featureFlags.ts`. Every flag defaults OFF; an override is persisted
 * to localStorage so it survives reloads. Features read `featureFlags.enabled(key)`
 * and no-op when false.
 */
import { FEATURE_FLAG_KEYS, type FeatureFlagKey } from '$lib/config/featureFlags';

const STORAGE_KEY = 'e-feature-flags';

function load(): Record<string, boolean> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function createFeatureFlagsStore() {
  let overrides = $state<Record<string, boolean>>(load());

  function persist() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    } catch {
      /* ignore quota / disabled storage */
    }
  }

  return {
    /** Reactive: is this experimental feature on? Defaults to false. */
    enabled(key: FeatureFlagKey): boolean {
      return overrides[key] === true;
    },
    /** All current overrides (reactive snapshot). */
    get all(): Readonly<Record<string, boolean>> {
      return overrides;
    },
    set(key: FeatureFlagKey, on: boolean) {
      overrides = { ...overrides, [key]: on };
      persist();
    },
    toggle(key: FeatureFlagKey) {
      this.set(key, !this.enabled(key));
    },
    reset() {
      overrides = {};
      persist();
    },
    /** Turn everything off (panic switch). */
    disableAll() {
      const next: Record<string, boolean> = {};
      for (const k of FEATURE_FLAG_KEYS) next[k] = false;
      overrides = next;
      persist();
    },
  };
}

export const featureFlags = createFeatureFlagsStore();
