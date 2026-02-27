import type { ExternalProviderConfig } from '@e/shared';
import type { IExternalProvider } from './types';
import { JiraProvider } from './jira-provider';
import { LinearProvider } from './linear-provider';
import { AsanaProvider } from './asana-provider';
import { getDb } from '../../db/database';

export type { IExternalProvider } from './types';

// ── Provider Registry ──

const providers: Record<string, IExternalProvider> = {
  jira: new JiraProvider(),
  linear: new LinearProvider(),
  asana: new AsanaProvider(),
};

export function getExternalProvider(provider: string): IExternalProvider {
  const p = providers[provider];
  if (!p) {
    throw new Error(
      `Unknown external provider: ${provider}. Supported: ${Object.keys(providers).join(', ')}`,
    );
  }
  return p;
}

export function getSupportedProviders(): string[] {
  return Object.keys(providers);
}

// ── Config Helper ──

const CONFIG_KEY_MAP: Record<string, string> = {
  jira: 'jiraConfig',
  linear: 'linearConfig',
  asana: 'asanaConfig',
};

/** Read a provider's config from the settings table. Returns null if not configured. */
export function getProviderConfig(provider: string): ExternalProviderConfig | null {
  const key = CONFIG_KEY_MAP[provider];
  if (!key) return null;

  const db = getDb();
  const row = db.query('SELECT value FROM settings WHERE key = ?').get(key) as any;
  if (!row) return null;

  try {
    return JSON.parse(row.value) as ExternalProviderConfig;
  } catch {
    return null;
  }
}

/** Save a provider's config to the settings table. */
export function saveProviderConfig(config: ExternalProviderConfig): void {
  const key = CONFIG_KEY_MAP[config.provider];
  if (!key) throw new Error(`Unknown provider: ${config.provider}`);

  const db = getDb();
  db.query(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, JSON.stringify(config));
}
