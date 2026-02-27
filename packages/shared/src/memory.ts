export interface MemoryFile {
  path: string;
  content: string;
  type: MemoryFileType;
  lastModified: number;
}

export type MemoryFileType =
  | 'project' // ./CLAUDE.md
  | 'project-local' // ./CLAUDE.local.md
  | 'user' // ~/.claude/CLAUDE.md
  | 'auto-memory' // ~/.claude/projects/xxx/memory/MEMORY.md
  | 'auto-topic' // ~/.claude/projects/xxx/memory/topic.md
  | 'rules' // .claude/rules/*.md
  | 'skills' // .claude/skills/*/SKILL.md
  | 'compat-rules'; // .cursorrules, AGENTS.md, .github/copilot-instructions.md

export interface Skill {
  name: string;
  command: string; // slash command trigger
  description: string;
  content: string;
  filePath: string;
}

export interface MemoryState {
  files: MemoryFile[];
  skills: Skill[];
  autoMemoryEnabled: boolean;
}

/** Mode for a rule: 'active' = always injected into system prompt, 'on-demand' = available via @rule */
export type RuleMode = 'active' | 'on-demand';

/** Metadata about a rule file stored in the database */
export interface RuleMetadata {
  id: string;
  workspacePath: string;
  filePath: string;
  mode: RuleMode;
  createdAt: number;
  updatedAt: number;
}

/** A rule file with its content and metadata */
export interface RuleFile {
  path: string;
  name: string;
  content: string;
  type: MemoryFileType;
  mode: RuleMode;
  lastModified: number;
}
