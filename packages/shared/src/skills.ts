/**
 * Skills Marketplace types
 *
 * Skills are reusable agent capabilities (prompt templates, tool configurations,
 * workflow recipes) that can be discovered, installed, and shared.
 *
 * Three tiers:
 * - Bundled: Included with E
 * - Managed: Downloaded and auto-updated from the registry
 * - Workspace: User-created in the workspace, version-controlled with the project
 */

/** Skill installation tier */
export type SkillTier = 'bundled' | 'managed' | 'workspace';

/** Skill category for browsing/filtering */
export type SkillCategory =
  | 'code-generation'
  | 'testing'
  | 'debugging'
  | 'documentation'
  | 'refactoring'
  | 'devops'
  | 'security'
  | 'data'
  | 'workflow'
  | 'productivity'
  | 'other';

export const SKILL_CATEGORIES: Array<{ value: SkillCategory | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'code-generation', label: 'Code Gen' },
  { value: 'testing', label: 'Testing' },
  { value: 'debugging', label: 'Debugging' },
  { value: 'documentation', label: 'Docs' },
  { value: 'refactoring', label: 'Refactoring' },
  { value: 'devops', label: 'DevOps' },
  { value: 'security', label: 'Security' },
  { value: 'data', label: 'Data' },
  { value: 'workflow', label: 'Workflow' },
  { value: 'productivity', label: 'Productivity' },
  { value: 'other', label: 'Other' },
];

/** Sort options for marketplace browsing */
export type SkillSortBy = 'popularity' | 'name' | 'newest' | 'updated';

/** Skill metadata from SKILL.md frontmatter */
export interface SkillMetadata {
  /** Unique skill identifier (directory name) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Short description */
  description: string;
  /** Version string (semver) */
  version: string;
  /** Author name or org */
  author?: string;
  /** Skill category */
  category: SkillCategory;
  /** Tags for search */
  tags: string[];
  /** License identifier */
  license?: string;
  /** Compatibility notes (e.g. "Claude 3.5+") */
  compatibility?: string;
  /** Required MCP servers */
  requiredMcpServers?: string[];
  /** Required tools */
  requiredTools?: string[];
  /** Configuration schema (JSON Schema subset) */
  configSchema?: Record<string, SkillConfigField>;
  /** Popularity / install count (from registry) */
  installs?: number;
  /** Star rating (from registry) */
  stars?: number;
}

/** A configurable field in a skill */
export interface SkillConfigField {
  type: 'string' | 'number' | 'boolean' | 'select';
  label: string;
  description?: string;
  default?: string | number | boolean;
  options?: string[]; // For 'select' type
  required?: boolean;
}

/** A fully resolved skill with content and installation info */
export interface MarketplaceSkill {
  /** Skill metadata from SKILL.md */
  metadata: SkillMetadata;
  /** Full SKILL.md content (markdown body after frontmatter) */
  content: string;
  /** Raw SKILL.md file content */
  rawContent: string;
  /** Installation tier */
  tier: SkillTier;
  /** File path where installed (null if not installed) */
  installedPath?: string;
  /** Whether the skill is currently installed */
  installed: boolean;
  /** Whether the skill is activated for the current conversation */
  activated: boolean;
  /** Pinned version (null = auto-update) */
  pinnedVersion?: string;
  /** Last updated timestamp */
  updatedAt: number;
  /** Installed timestamp */
  installedAt?: number;
  /** User-provided configuration values */
  config?: Record<string, string | number | boolean>;
  /** Prompt template defined by the skill */
  promptTemplate?: string;
  /** Rules defined by the skill */
  rules?: string[];
}

/** Summary for listing (lighter than full MarketplaceSkill) */
export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  category: SkillCategory;
  tags: string[];
  license?: string;
  compatibility?: string;
  installs?: number;
  stars?: number;
  tier: SkillTier;
  installed: boolean;
  activated: boolean;
  updatedAt: number;
}

/** Input for creating a new workspace skill */
export interface SkillCreateInput {
  name: string;
  description: string;
  category: SkillCategory;
  tags: string[];
  promptTemplate: string;
  rules?: string[];
  requiredTools?: string[];
  requiredMcpServers?: string[];
  configSchema?: Record<string, SkillConfigField>;
}

/** Input for installing a skill */
export interface SkillInstallInput {
  skillId: string;
  /** Where to install: 'managed' = ~/.e/skills/, 'workspace' = .e/skills/ */
  tier: 'managed' | 'workspace';
  workspacePath?: string;
  /** Optional version to pin to */
  pinnedVersion?: string;
}

/** Input for updating skill configuration */
export interface SkillConfigUpdateInput {
  skillId: string;
  config: Record<string, string | number | boolean>;
}

/** Installed skill record stored in database */
export interface InstalledSkillRecord {
  id: string;
  skillId: string;
  tier: SkillTier;
  version: string;
  pinnedVersion?: string;
  installedPath: string;
  workspacePath?: string;
  config?: string; // JSON string
  activated: boolean;
  installedAt: number;
  updatedAt: number;
}

/** Skill search/browse request */
export interface SkillBrowseRequest {
  query?: string;
  category?: SkillCategory;
  sortBy?: SkillSortBy;
  tier?: SkillTier | 'all';
  page?: number;
  pageSize?: number;
}

/** Skill search/browse response */
export interface SkillBrowseResponse {
  skills: SkillSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/** Skill suggestion from agent */
export interface SkillSuggestion {
  skillId: string;
  skillName: string;
  reason: string;
  confidence: number;
}
