/**
 * Skill discovery, parsing, validation, and bundled skill definitions.
 *
 * Handles:
 * - SKILL.md parsing (YAML frontmatter + body extraction)
 * - SKILL.md generation from metadata
 * - Local filesystem skill discovery
 * - Remote registry fetching with caching
 * - Bundled skill definitions
 * - Relevance scoring for search/suggestions
 */

import { readdir, stat, readFile } from 'fs/promises';
import { join } from 'path';
import type {
  SkillTier,
  SkillCategory,
  SkillMetadata,
  SkillSummary,
  SkillConfigField,
} from '@e/shared';
import { getDb } from '../../db/database';
import type { ParsedSkillMd, RegistryEntry } from './types';
import {
  REGISTRY_OWNER,
  REGISTRY_REPO,
  REGISTRY_SKILLS_PATH,
  GITHUB_API,
  RAW_GITHUB,
  GITHUB_HEADERS,
  CACHE_TTL_MS,
} from './types';

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

export function ensureSkillsTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS installed_skills (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'managed',
      version TEXT NOT NULL DEFAULT '1.0.0',
      pinned_version TEXT,
      installed_path TEXT NOT NULL,
      workspace_path TEXT,
      config TEXT,
      activated INTEGER NOT NULL DEFAULT 1,
      installed_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_installed_skills_skill_id ON installed_skills(skill_id);
    CREATE INDEX IF NOT EXISTS idx_installed_skills_workspace ON installed_skills(workspace_path);
  `);
}

// ---------------------------------------------------------------------------
// SKILL.md Parser
// ---------------------------------------------------------------------------

/**
 * Parse YAML frontmatter from a SKILL.md string.
 * Extracts metadata, prompt template, and rules.
 */
export function parseSkillMd(raw: string, fallbackId: string): ParsedSkillMd {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) {
    return {
      metadata: {
        id: fallbackId,
        name: fallbackId,
        description: '',
        version: '1.0.0',
        category: 'other',
        tags: [],
      },
      body: raw,
      raw,
    };
  }

  const yamlStr = fmMatch[1];
  const body = fmMatch[2] || '';

  // Simple line-by-line YAML parser
  const parsed: Record<string, any> = {};
  const lines = yamlStr.split('\n');
  let currentKey: string | null = null;
  let metadataBlock = false;
  let configBlock = false;
  let currentConfigKey: string | null = null;
  const metadata: Record<string, string> = {};
  const configSchema: Record<string, SkillConfigField> = {};
  const tags: string[] = [];
  const requiredTools: string[] = [];
  const requiredMcpServers: string[] = [];
  let inArrayKey: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect metadata block
    if (trimmed === 'metadata:') {
      metadataBlock = true;
      configBlock = false;
      currentKey = null;
      inArrayKey = null;
      continue;
    }

    // Detect config block
    if (trimmed === 'config:' || trimmed === 'configSchema:') {
      configBlock = true;
      metadataBlock = false;
      currentKey = null;
      inArrayKey = null;
      continue;
    }

    if (metadataBlock && line.match(/^\s{2,}\w/)) {
      const mMatch = line.match(/^\s+(\w[\w-]*):\s*(.*)$/);
      if (mMatch) {
        metadata[mMatch[1]] = mMatch[2].replace(/^["']|["']$/g, '');
      }
      continue;
    } else if (metadataBlock && !line.match(/^\s/)) {
      metadataBlock = false;
    }

    if (configBlock && line.match(/^\s{2,}\w/)) {
      const configKeyMatch = line.match(/^\s{2}(\w[\w-]*):\s*$/);
      if (configKeyMatch) {
        currentConfigKey = configKeyMatch[1];
        configSchema[currentConfigKey] = { type: 'string', label: currentConfigKey };
        continue;
      }
      if (currentConfigKey && line.match(/^\s{4,}/)) {
        const kvMatch = line.match(/^\s+(\w[\w-]*):\s*(.*)$/);
        if (kvMatch) {
          const k = kvMatch[1];
          const v = kvMatch[2].replace(/^["']|["']$/g, '');
          const field = configSchema[currentConfigKey];
          if (field) {
            if (k === 'type') field.type = v as any;
            else if (k === 'label') field.label = v;
            else if (k === 'description') field.description = v;
            else if (k === 'default') field.default = v;
            else if (k === 'required') field.required = v === 'true';
          }
        }
      }
      continue;
    } else if (configBlock && !line.match(/^\s/)) {
      configBlock = false;
      currentConfigKey = null;
    }

    // Array items (tags, requiredTools, requiredMcpServers)
    if (inArrayKey && trimmed.startsWith('- ')) {
      const val = trimmed.slice(2).replace(/^["']|["']$/g, '');
      if (inArrayKey === 'tags') tags.push(val);
      else if (inArrayKey === 'requiredTools' || inArrayKey === 'required_tools')
        requiredTools.push(val);
      else if (inArrayKey === 'requiredMcpServers' || inArrayKey === 'required_mcp_servers')
        requiredMcpServers.push(val);
      continue;
    } else if (inArrayKey && !trimmed.startsWith('- ') && trimmed !== '') {
      inArrayKey = null;
    }

    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const val = kvMatch[2].replace(/^["']|["']$/g, '').trim();
      if (
        val === '' &&
        (key === 'tags' ||
          key === 'requiredTools' ||
          key === 'required_tools' ||
          key === 'requiredMcpServers' ||
          key === 'required_mcp_servers')
      ) {
        inArrayKey = key;
        currentKey = key;
        continue;
      }
      // Handle inline arrays: tags: [a, b, c]
      if (val.startsWith('[') && val.endsWith(']')) {
        const items = val
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''));
        if (key === 'tags') tags.push(...items);
        else if (key === 'requiredTools' || key === 'required_tools') requiredTools.push(...items);
        else if (key === 'requiredMcpServers' || key === 'required_mcp_servers')
          requiredMcpServers.push(...items);
        else parsed[key] = items;
      } else {
        parsed[key] = val;
      }
      currentKey = key;
      inArrayKey = null;
    } else if (currentKey && line.match(/^\s+/) && !metadataBlock && !configBlock) {
      // Multi-line value continuation
      parsed[currentKey] = (parsed[currentKey] || '') + ' ' + trimmed;
    }
  }

  // Extract prompt template from body (## Prompt Template section)
  let promptTemplate: string | undefined;
  const promptMatch = body.match(/##\s*Prompt\s*Template\s*\n([\s\S]*?)(?=\n##\s|\n$|$)/i);
  if (promptMatch) {
    promptTemplate = promptMatch[1].trim();
  }

  // Extract rules from body (## Rules section)
  let rules: string[] | undefined;
  const rulesMatch = body.match(/##\s*Rules\s*\n([\s\S]*?)(?=\n##\s|\n$|$)/i);
  if (rulesMatch) {
    rules = rulesMatch[1]
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('- ') || l.startsWith('* '))
      .map((l) => l.slice(2).trim())
      .filter(Boolean);
  }

  const skillMetadata: SkillMetadata = {
    id: parsed['id'] || fallbackId,
    name: parsed['name'] || fallbackId,
    description: parsed['description'] || '',
    version: parsed['version'] || '1.0.0',
    author: parsed['author'],
    category: (parsed['category'] as SkillCategory) || 'other',
    tags: tags.length > 0 ? tags : [],
    license: parsed['license'],
    compatibility: parsed['compatibility'],
    requiredMcpServers: requiredMcpServers.length > 0 ? requiredMcpServers : undefined,
    requiredTools: requiredTools.length > 0 ? requiredTools : undefined,
    configSchema: Object.keys(configSchema).length > 0 ? configSchema : undefined,
    installs: parsed['installs'] ? parseInt(parsed['installs'], 10) : undefined,
    stars: parsed['stars'] ? parseInt(parsed['stars'], 10) : undefined,
  };

  return {
    metadata: skillMetadata,
    body,
    promptTemplate,
    rules,
    raw,
  };
}

/**
 * Generate SKILL.md content from metadata and prompt
 */
export function generateSkillMd(
  metadata: SkillMetadata,
  promptTemplate?: string,
  rules?: string[],
): string {
  const lines: string[] = ['---'];
  lines.push(`name: "${metadata.name}"`);
  lines.push(`description: "${metadata.description}"`);
  lines.push(`version: "${metadata.version}"`);
  if (metadata.author) lines.push(`author: "${metadata.author}"`);
  lines.push(`category: ${metadata.category}`);
  if (metadata.tags.length > 0) {
    lines.push(`tags: [${metadata.tags.map((t) => `"${t}"`).join(', ')}]`);
  }
  if (metadata.license) lines.push(`license: "${metadata.license}"`);
  if (metadata.compatibility) lines.push(`compatibility: "${metadata.compatibility}"`);
  if (metadata.requiredTools && metadata.requiredTools.length > 0) {
    lines.push('requiredTools:');
    for (const t of metadata.requiredTools) lines.push(`  - "${t}"`);
  }
  if (metadata.requiredMcpServers && metadata.requiredMcpServers.length > 0) {
    lines.push('requiredMcpServers:');
    for (const s of metadata.requiredMcpServers) lines.push(`  - "${s}"`);
  }
  if (metadata.configSchema) {
    lines.push('configSchema:');
    for (const [key, field] of Object.entries(metadata.configSchema)) {
      lines.push(`  ${key}:`);
      lines.push(`    type: ${field.type}`);
      lines.push(`    label: "${field.label}"`);
      if (field.description) lines.push(`    description: "${field.description}"`);
      if (field.default !== undefined) lines.push(`    default: "${field.default}"`);
      if (field.required) lines.push(`    required: true`);
    }
  }
  lines.push('---');
  lines.push('');
  lines.push(`# ${metadata.name}`);
  lines.push('');
  lines.push(metadata.description);
  lines.push('');

  if (promptTemplate) {
    lines.push('## Prompt Template');
    lines.push('');
    lines.push(promptTemplate);
    lines.push('');
  }

  if (rules && rules.length > 0) {
    lines.push('## Rules');
    lines.push('');
    for (const r of rules) {
      lines.push(`- ${r}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Workspace path helper
// ---------------------------------------------------------------------------

export function getWorkspacePath(): string {
  try {
    const db = getDb();
    const row = db.query("SELECT value FROM settings WHERE key = 'workspacePath'").get() as any;
    if (row) return JSON.parse(row.value);
  } catch {}
  return '.';
}

// ---------------------------------------------------------------------------
// Registry Cache
// ---------------------------------------------------------------------------

let listCache: { skills: RegistryEntry[]; ts: number } | null = null;

export async function fetchRegistrySkills(): Promise<RegistryEntry[]> {
  if (listCache && Date.now() - listCache.ts < CACHE_TTL_MS) {
    return listCache.skills;
  }

  // List skill directories from GitHub
  const dirsRes = await fetch(
    `${GITHUB_API}/repos/${REGISTRY_OWNER}/${REGISTRY_REPO}/contents/${REGISTRY_SKILLS_PATH}`,
    { headers: GITHUB_HEADERS },
  );
  if (!dirsRes.ok) throw new Error(`GitHub API error ${dirsRes.status}`);
  const dirs = (await dirsRes.json()) as any[];

  const skillDirs = dirs.filter((d: any) => d.type === 'dir');

  // Fetch SKILL.md for each directory in parallel (limit concurrency)
  const CONCURRENCY = 5;
  const skills: RegistryEntry[] = [];

  for (let i = 0; i < skillDirs.length; i += CONCURRENCY) {
    const batch = skillDirs.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (dir: any) => {
        const rawUrl = `${RAW_GITHUB}/${REGISTRY_OWNER}/${REGISTRY_REPO}/main/${REGISTRY_SKILLS_PATH}/${dir.name}/SKILL.md`;
        const res = await fetch(rawUrl, { headers: GITHUB_HEADERS });
        if (!res.ok) return null;
        const raw = await res.text();
        const parsed = parseSkillMd(raw, dir.name);
        return {
          metadata: parsed.metadata,
          content: parsed.body,
          raw,
          promptTemplate: parsed.promptTemplate,
          rules: parsed.rules,
        } as RegistryEntry;
      }),
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        skills.push(r.value);
      }
    }
  }

  listCache = { skills, ts: Date.now() };
  return skills;
}

// ---------------------------------------------------------------------------
// Bundled Skills
// ---------------------------------------------------------------------------

export const BUNDLED_SKILLS: RegistryEntry[] = [
  {
    metadata: {
      id: 'code-review',
      name: 'Code Review',
      description:
        'Comprehensive code review with security, performance, and best practices analysis',
      version: '1.0.0',
      author: 'E Team',
      category: 'code-generation',
      tags: ['review', 'quality', 'security'],
      compatibility: 'All models',
    },
    content:
      'Performs thorough code review analyzing security vulnerabilities, performance issues, code style, and best practices.',
    raw: `---
name: "Code Review"
description: "Comprehensive code review with security, performance, and best practices analysis"
version: "1.0.0"
author: "E Team"
category: code-generation
tags: [review, quality, security]
compatibility: "All models"
---

# Code Review

Performs thorough code review analyzing security vulnerabilities, performance issues, code style, and best practices.

## Prompt Template

Review the provided code thoroughly. Analyze:

1. **Security**: Look for injection vulnerabilities, authentication issues, data exposure
2. **Performance**: Identify N+1 queries, unnecessary re-renders, memory leaks
3. **Best Practices**: Check naming conventions, error handling, type safety
4. **Maintainability**: Evaluate code organization, documentation, test coverage

Provide specific, actionable feedback with code examples for each issue found.

## Rules

- Always explain the "why" behind each suggestion
- Prioritize issues by severity (critical, warning, info)
- Include positive feedback for well-written code
- Suggest specific fixes, not just problems`,
    promptTemplate: `Review the provided code thoroughly. Analyze:

1. **Security**: Look for injection vulnerabilities, authentication issues, data exposure
2. **Performance**: Identify N+1 queries, unnecessary re-renders, memory leaks
3. **Best Practices**: Check naming conventions, error handling, type safety
4. **Maintainability**: Evaluate code organization, documentation, test coverage

Provide specific, actionable feedback with code examples for each issue found.`,
    rules: [
      'Always explain the "why" behind each suggestion',
      'Prioritize issues by severity (critical, warning, info)',
      'Include positive feedback for well-written code',
      'Suggest specific fixes, not just problems',
    ],
  },
  {
    metadata: {
      id: 'test-generator',
      name: 'Test Generator',
      description: 'Generate comprehensive test suites with edge cases and mocks',
      version: '1.0.0',
      author: 'E Team',
      category: 'testing',
      tags: ['testing', 'unit-tests', 'coverage'],
      compatibility: 'All models',
    },
    content:
      'Generates comprehensive test suites including unit tests, integration tests, and edge case coverage.',
    raw: `---
name: "Test Generator"
description: "Generate comprehensive test suites with edge cases and mocks"
version: "1.0.0"
author: "E Team"
category: testing
tags: [testing, unit-tests, coverage]
compatibility: "All models"
---

# Test Generator

Generates comprehensive test suites including unit tests, integration tests, and edge case coverage.

## Prompt Template

Generate comprehensive tests for the given code:

1. Identify all public functions, methods, and classes
2. For each, generate:
   - Happy path tests
   - Edge case tests (empty inputs, null values, boundary conditions)
   - Error handling tests
   - Mock setup for external dependencies
3. Use the project's existing test framework and patterns
4. Aim for high branch coverage

## Rules

- Follow the project's existing test patterns and framework
- Use descriptive test names that explain the scenario
- Group related tests logically
- Include both positive and negative test cases`,
    promptTemplate: `Generate comprehensive tests for the given code:

1. Identify all public functions, methods, and classes
2. For each, generate:
   - Happy path tests
   - Edge case tests (empty inputs, null values, boundary conditions)
   - Error handling tests
   - Mock setup for external dependencies
3. Use the project's existing test framework and patterns
4. Aim for high branch coverage`,
    rules: [
      "Follow the project's existing test patterns and framework",
      'Use descriptive test names that explain the scenario',
      'Group related tests logically',
      'Include both positive and negative test cases',
    ],
  },
  {
    metadata: {
      id: 'doc-writer',
      name: 'Documentation Writer',
      description: 'Generate clear, comprehensive documentation from code',
      version: '1.0.0',
      author: 'E Team',
      category: 'documentation',
      tags: ['docs', 'readme', 'api-docs'],
      compatibility: 'All models',
    },
    content:
      'Generates clear, well-structured documentation including API docs, README files, and inline comments.',
    raw: `---
name: "Documentation Writer"
description: "Generate clear, comprehensive documentation from code"
version: "1.0.0"
author: "E Team"
category: documentation
tags: [docs, readme, api-docs]
compatibility: "All models"
---

# Documentation Writer

Generates clear, well-structured documentation including API docs, README files, and inline comments.

## Prompt Template

Generate documentation for the provided code:

1. Write a high-level overview explaining the purpose and architecture
2. Document all public APIs with parameters, return types, and examples
3. Include usage examples with common patterns
4. Note any prerequisites, configuration, or setup steps
5. Add troubleshooting tips for common issues

## Rules

- Write for the reader, not the author
- Include practical examples over abstract descriptions
- Keep language clear and jargon-free when possible
- Structure docs with clear headings and navigation`,
    promptTemplate: `Generate documentation for the provided code:

1. Write a high-level overview explaining the purpose and architecture
2. Document all public APIs with parameters, return types, and examples
3. Include usage examples with common patterns
4. Note any prerequisites, configuration, or setup steps
5. Add troubleshooting tips for common issues`,
    rules: [
      'Write for the reader, not the author',
      'Include practical examples over abstract descriptions',
      'Keep language clear and jargon-free when possible',
      'Structure docs with clear headings and navigation',
    ],
  },
  {
    metadata: {
      id: 'refactor-assistant',
      name: 'Refactor Assistant',
      description: 'Intelligent code refactoring with pattern detection and modernization',
      version: '1.0.0',
      author: 'E Team',
      category: 'refactoring',
      tags: ['refactoring', 'cleanup', 'modernization'],
      compatibility: 'All models',
    },
    content:
      'Analyzes code for refactoring opportunities and provides safe, incremental improvement suggestions.',
    raw: `---
name: "Refactor Assistant"
description: "Intelligent code refactoring with pattern detection and modernization"
version: "1.0.0"
author: "E Team"
category: refactoring
tags: [refactoring, cleanup, modernization]
compatibility: "All models"
---

# Refactor Assistant

Analyzes code for refactoring opportunities and provides safe, incremental improvement suggestions.

## Prompt Template

Analyze the code for refactoring opportunities:

1. Identify code smells (duplication, long methods, deep nesting)
2. Suggest design pattern applications where appropriate
3. Modernize deprecated APIs and language features
4. Improve naming for clarity
5. Extract reusable components/functions

Apply refactoring incrementally, preserving existing behavior.

## Rules

- Never change behavior while refactoring
- Make small, reviewable changes
- Explain the benefit of each refactoring
- Preserve all existing tests`,
    promptTemplate: `Analyze the code for refactoring opportunities:

1. Identify code smells (duplication, long methods, deep nesting)
2. Suggest design pattern applications where appropriate
3. Modernize deprecated APIs and language features
4. Improve naming for clarity
5. Extract reusable components/functions

Apply refactoring incrementally, preserving existing behavior.`,
    rules: [
      'Never change behavior while refactoring',
      'Make small, reviewable changes',
      'Explain the benefit of each refactoring',
      'Preserve all existing tests',
    ],
  },
  {
    metadata: {
      id: 'debug-detective',
      name: 'Debug Detective',
      description: 'Systematic debugging with root cause analysis and fix suggestions',
      version: '1.0.0',
      author: 'E Team',
      category: 'debugging',
      tags: ['debugging', 'troubleshooting', 'errors'],
      compatibility: 'All models',
    },
    content:
      'Systematic approach to debugging that identifies root causes and suggests targeted fixes.',
    raw: `---
name: "Debug Detective"
description: "Systematic debugging with root cause analysis and fix suggestions"
version: "1.0.0"
author: "E Team"
category: debugging
tags: [debugging, troubleshooting, errors]
compatibility: "All models"
---

# Debug Detective

Systematic approach to debugging that identifies root causes and suggests targeted fixes.

## Prompt Template

Debug the reported issue systematically:

1. **Reproduce**: Understand the exact steps to reproduce
2. **Isolate**: Narrow down the affected code path
3. **Analyze**: Examine the root cause (not just symptoms)
4. **Fix**: Propose a minimal, targeted fix
5. **Verify**: Suggest how to verify the fix works
6. **Prevent**: Recommend tests or guards to prevent regression

## Rules

- Always identify the root cause, not just symptoms
- Propose the minimal fix that resolves the issue
- Include a test case that would catch the regression
- Document what caused the bug for team learning`,
    promptTemplate: `Debug the reported issue systematically:

1. **Reproduce**: Understand the exact steps to reproduce
2. **Isolate**: Narrow down the affected code path
3. **Analyze**: Examine the root cause (not just symptoms)
4. **Fix**: Propose a minimal, targeted fix
5. **Verify**: Suggest how to verify the fix works
6. **Prevent**: Recommend tests or guards to prevent regression`,
    rules: [
      'Always identify the root cause, not just symptoms',
      'Propose the minimal fix that resolves the issue',
      'Include a test case that would catch the regression',
      'Document what caused the bug for team learning',
    ],
  },
];

// ---------------------------------------------------------------------------
// Local skill discovery helpers
// ---------------------------------------------------------------------------

export async function discoverLocalSkills(
  basePath: string,
  _tier: SkillTier,
): Promise<RegistryEntry[]> {
  const skills: RegistryEntry[] = [];
  try {
    const entries = await readdir(basePath);
    for (const entry of entries) {
      try {
        const skillFile = join(basePath, entry, 'SKILL.md');
        await stat(skillFile);
        const raw = await readFile(skillFile, 'utf-8');
        const parsed = parseSkillMd(raw, entry);
        skills.push({
          metadata: parsed.metadata,
          content: parsed.body,
          raw,
          promptTemplate: parsed.promptTemplate,
          rules: parsed.rules,
        });
      } catch {
        // Not a valid skill directory
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return skills;
}

/**
 * Get installed skill records from the database
 */
export function getInstalledRecords(workspacePath?: string): any[] {
  const db = getDb();
  ensureSkillsTable();
  if (workspacePath) {
    return db
      .query('SELECT * FROM installed_skills WHERE workspace_path = ? OR workspace_path IS NULL')
      .all(workspacePath) as any[];
  }
  return db.query('SELECT * FROM installed_skills').all() as any[];
}

/**
 * Convert a registry entry + install info to a SkillSummary
 */
export function toSummary(
  entry: RegistryEntry,
  tier: SkillTier,
  installed: boolean,
  activated: boolean,
): SkillSummary {
  return {
    id: entry.metadata.id,
    name: entry.metadata.name,
    description: entry.metadata.description,
    version: entry.metadata.version,
    author: entry.metadata.author,
    category: entry.metadata.category,
    tags: entry.metadata.tags,
    license: entry.metadata.license,
    compatibility: entry.metadata.compatibility,
    installs: entry.metadata.installs,
    stars: entry.metadata.stars,
    tier,
    installed,
    activated,
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Relevance scoring
// ---------------------------------------------------------------------------

export function calculateRelevanceScore(metadata: SkillMetadata, query: string): number {
  let score = 0;
  const q = query.toLowerCase();

  if (metadata.name.toLowerCase().includes(q)) score += 5;
  if (metadata.description.toLowerCase().includes(q)) score += 3;
  if (metadata.category.toLowerCase().includes(q)) score += 2;
  for (const tag of metadata.tags) {
    if (tag.toLowerCase().includes(q)) score += 2;
  }

  // Keyword matching
  const keywords = q.split(/\s+/);
  for (const kw of keywords) {
    if (kw.length < 2) continue;
    if (metadata.name.toLowerCase().includes(kw)) score += 1;
    if (metadata.description.toLowerCase().includes(kw)) score += 1;
    for (const tag of metadata.tags) {
      if (tag.toLowerCase().includes(kw)) score += 1;
    }
  }

  return score;
}
