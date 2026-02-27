/**
 * Shared types, interfaces, and constants for the skills registry.
 */

import type { SkillMetadata, SkillConfigField } from '@e/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const REGISTRY_OWNER = 'anthropics';
export const REGISTRY_REPO = 'skills';
export const REGISTRY_SKILLS_PATH = 'skills';
export const GITHUB_API = 'https://api.github.com';
export const RAW_GITHUB = 'https://raw.githubusercontent.com';

export const GITHUB_HEADERS: HeadersInit = {
  Accept: 'application/vnd.github.v3+json',
  'User-Agent': 'E-IDE/1.0',
};

export const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ParsedSkillMd {
  metadata: SkillMetadata;
  body: string;
  promptTemplate?: string;
  rules?: string[];
  raw: string;
}

export interface RegistryEntry {
  metadata: SkillMetadata;
  content: string;
  raw: string;
  promptTemplate?: string;
  rules?: string[];
}
