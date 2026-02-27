/**
 * Skills Marketplace & Registry Routes
 *
 * A full marketplace with three tiers:
 * - Bundled: Included with E (built-in skills)
 * - Managed: Downloaded and auto-updated from the registry (~/.e/skills/)
 * - Workspace: User-created in the workspace (.e/skills/)
 *
 * Endpoints:
 *   GET  /api/skills-registry/browse              - search/browse marketplace
 *   GET  /api/skills-registry/skill/:id           - get full skill details
 *   POST /api/skills-registry/install             - install a skill
 *   POST /api/skills-registry/uninstall           - uninstall a skill
 *   GET  /api/skills-registry/installed           - list installed skills
 *   POST /api/skills-registry/create              - create a new workspace skill
 *   PATCH /api/skills-registry/config             - update skill configuration
 *   PATCH /api/skills-registry/activate           - activate/deactivate a skill
 *   PATCH /api/skills-registry/pin-version        - pin/unpin version for managed skill
 *   POST /api/skills-registry/check-updates       - check for updates to managed skills
 *   GET  /api/skills-registry/suggest             - get skill suggestions for a query
 *   GET  /api/skills-registry/bundled             - list bundled skills
 */

import { Hono } from 'hono';
import { mkdir, writeFile, rm, stat, readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { getDb } from '../../db/database';
import type {
  SkillTier,
  SkillCategory,
  SkillSortBy,
  SkillSummary,
  MarketplaceSkill,
  SkillBrowseResponse,
} from '@e/shared';
import type { ParsedSkillMd } from './types';
import {
  ensureSkillsTable,
  parseSkillMd,
  generateSkillMd,
  getWorkspacePath,
  fetchRegistrySkills,
  BUNDLED_SKILLS,
  discoverLocalSkills,
  getInstalledRecords,
  toSummary,
  calculateRelevanceScore,
} from './discovery';

const app = new Hono();

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /browse - search/browse the marketplace
app.get('/browse', async (c) => {
  try {
    const query = (c.req.query('query') || '').toLowerCase();
    const category = c.req.query('category') as SkillCategory | 'all' | undefined;
    const sortBy = (c.req.query('sortBy') || 'popularity') as SkillSortBy;
    const tierFilter = c.req.query('tier') as SkillTier | 'all' | undefined;
    const page = parseInt(c.req.query('page') || '1', 10);
    const pageSize = parseInt(c.req.query('pageSize') || '50', 10);
    const workspacePath = c.req.query('workspacePath') || getWorkspacePath();

    ensureSkillsTable();
    const installedRecords = getInstalledRecords(workspacePath);
    const installedIds = new Set(installedRecords.map((r: any) => r.skill_id));
    const activatedIds = new Set(
      installedRecords.filter((r: any) => r.activated).map((r: any) => r.skill_id),
    );

    // Collect all skills from all sources
    let allSkills: SkillSummary[] = [];

    // 1. Bundled skills
    if (!tierFilter || tierFilter === 'all' || tierFilter === 'bundled') {
      for (const skill of BUNDLED_SKILLS) {
        allSkills.push(toSummary(skill, 'bundled', true, activatedIds.has(skill.metadata.id)));
      }
    }

    // 2. Managed skills (from ~/.e/skills/)
    if (!tierFilter || tierFilter === 'all' || tierFilter === 'managed') {
      const managedDir = join(homedir(), '.e', 'skills');
      const managed = await discoverLocalSkills(managedDir, 'managed');
      for (const skill of managed) {
        allSkills.push(
          toSummary(
            skill,
            'managed',
            installedIds.has(skill.metadata.id),
            activatedIds.has(skill.metadata.id),
          ),
        );
      }
    }

    // 3. Workspace skills
    if (!tierFilter || tierFilter === 'all' || tierFilter === 'workspace') {
      for (const parent of ['.e', '.claude']) {
        const wsDir = join(workspacePath, parent, 'skills');
        const workspace = await discoverLocalSkills(wsDir, 'workspace');
        for (const skill of workspace) {
          // Avoid duplicates
          if (!allSkills.find((s) => s.id === skill.metadata.id)) {
            allSkills.push(
              toSummary(skill, 'workspace', true, activatedIds.has(skill.metadata.id)),
            );
          }
        }
      }
    }

    // 4. Registry skills (remote, not yet installed)
    if (!tierFilter || tierFilter === 'all' || tierFilter === 'managed') {
      try {
        const registrySkills = await fetchRegistrySkills();
        for (const skill of registrySkills) {
          // Only add if not already present locally
          if (
            !allSkills.find((s) => s.id === skill.metadata.id || s.name === skill.metadata.name)
          ) {
            allSkills.push(
              toSummary(
                skill,
                'managed',
                installedIds.has(skill.metadata.id),
                activatedIds.has(skill.metadata.id),
              ),
            );
          }
        }
      } catch {
        // Registry unavailable, continue with local skills
      }
    }

    // Apply search filter
    if (query) {
      allSkills = allSkills.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          s.description.toLowerCase().includes(query) ||
          s.tags.some((t) => t.toLowerCase().includes(query)) ||
          s.category.toLowerCase().includes(query),
      );
    }

    // Apply category filter
    if (category && category !== 'all') {
      allSkills = allSkills.filter((s) => s.category === category);
    }

    // Sort
    switch (sortBy) {
      case 'popularity':
        allSkills.sort((a, b) => (b.installs || 0) - (a.installs || 0));
        // Put installed/bundled first
        allSkills.sort((a, b) => {
          if (a.installed && !b.installed) return -1;
          if (!a.installed && b.installed) return 1;
          if (a.tier === 'bundled' && b.tier !== 'bundled') return -1;
          if (a.tier !== 'bundled' && b.tier === 'bundled') return 1;
          return 0;
        });
        break;
      case 'name':
        allSkills.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'newest':
        allSkills.sort((a, b) => b.updatedAt - a.updatedAt);
        break;
      case 'updated':
        allSkills.sort((a, b) => b.updatedAt - a.updatedAt);
        break;
    }

    // Paginate
    const total = allSkills.length;
    const start = (page - 1) * pageSize;
    const paged = allSkills.slice(start, start + pageSize);

    const response: SkillBrowseResponse = {
      skills: paged,
      total,
      page,
      pageSize,
    };

    return c.json({ ok: true, data: response });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: `Failed to browse skills: ${msg}` }, 500);
  }
});

// GET /skill/:id - get full skill details
app.get('/skill/:id', async (c) => {
  const id = c.req.param('id');
  const workspacePath = c.req.query('workspacePath') || getWorkspacePath();
  try {
    ensureSkillsTable();

    // Check bundled
    const bundled = BUNDLED_SKILLS.find((s) => s.metadata.id === id);
    if (bundled) {
      const installedRecords = getInstalledRecords(workspacePath);
      const record = installedRecords.find((r: any) => r.skill_id === id);
      const skill: MarketplaceSkill = {
        metadata: bundled.metadata,
        content: bundled.content,
        rawContent: bundled.raw,
        tier: 'bundled',
        installed: true,
        activated: record ? !!record.activated : true,
        updatedAt: Date.now(),
        promptTemplate: bundled.promptTemplate,
        rules: bundled.rules,
        config: record?.config ? JSON.parse(record.config) : undefined,
      };
      return c.json({ ok: true, data: skill });
    }

    // Check local (managed + workspace)
    const dirs = [
      { path: join(homedir(), '.e', 'skills'), tier: 'managed' as SkillTier },
      { path: join(workspacePath, '.e', 'skills'), tier: 'workspace' as SkillTier },
      { path: join(workspacePath, '.claude', 'skills'), tier: 'workspace' as SkillTier },
    ];

    for (const { path: dir, tier } of dirs) {
      try {
        const skillFile = join(dir, id, 'SKILL.md');
        await stat(skillFile);
        const raw = await readFile(skillFile, 'utf-8');
        const parsed = parseSkillMd(raw, id);
        const installedRecords = getInstalledRecords(workspacePath);
        const record = installedRecords.find((r: any) => r.skill_id === id);

        const skill: MarketplaceSkill = {
          metadata: parsed.metadata,
          content: parsed.body,
          rawContent: raw,
          tier,
          installedPath: skillFile,
          installed: true,
          activated: record ? !!record.activated : true,
          updatedAt: Date.now(),
          installedAt: record?.installed_at,
          pinnedVersion: record?.pinned_version || undefined,
          config: record?.config ? JSON.parse(record.config) : undefined,
          promptTemplate: parsed.promptTemplate,
          rules: parsed.rules,
        };
        return c.json({ ok: true, data: skill });
      } catch {
        // Not found in this dir
      }
    }

    // Check registry
    try {
      const registrySkills = await fetchRegistrySkills();
      const registrySkill = registrySkills.find(
        (s) => s.metadata.id === id || s.metadata.name === id,
      );
      if (registrySkill) {
        const skill: MarketplaceSkill = {
          metadata: registrySkill.metadata,
          content: registrySkill.content,
          rawContent: registrySkill.raw,
          tier: 'managed',
          installed: false,
          activated: false,
          updatedAt: Date.now(),
          promptTemplate: registrySkill.promptTemplate,
          rules: registrySkill.rules,
        };
        return c.json({ ok: true, data: skill });
      }
    } catch {
      // Registry unavailable
    }

    return c.json({ ok: false, error: 'Skill not found' }, 404);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 500);
  }
});

// POST /install - install a skill
app.post('/install', async (c) => {
  const body = await c.req.json();
  const {
    skillId,
    skillName,
    tier = 'workspace',
    workspacePath: reqWorkspacePath,
    pinnedVersion,
  } = body;

  const resolvedId = skillId || skillName;
  if (!resolvedId) return c.json({ ok: false, error: 'skillId or skillName required' }, 400);

  const workspacePath = reqWorkspacePath || getWorkspacePath();

  try {
    ensureSkillsTable();

    // Find the skill content
    let skillContent: string | null = null;
    let parsedSkill: ParsedSkillMd | null = null;

    // Check bundled first
    const bundled = BUNDLED_SKILLS.find(
      (s) => s.metadata.id === resolvedId || s.metadata.name === resolvedId,
    );
    if (bundled) {
      skillContent = bundled.raw;
      parsedSkill = parseSkillMd(bundled.raw, resolvedId);
    }

    // Then check registry
    if (!skillContent) {
      const registrySkills = await fetchRegistrySkills();
      const found = registrySkills.find(
        (s) => s.metadata.id === resolvedId || s.metadata.name === resolvedId,
      );
      if (found) {
        skillContent = found.raw;
        parsedSkill = parseSkillMd(found.raw, resolvedId);
      }
    }

    if (!skillContent || !parsedSkill) {
      return c.json({ ok: false, error: `Skill '${resolvedId}' not found` }, 404);
    }

    const installId = parsedSkill.metadata.id || resolvedId;

    // Determine install path
    let installDir: string;
    let installTier = tier as SkillTier;
    if (installTier === 'managed') {
      installDir = join(homedir(), '.e', 'skills', installId);
    } else {
      installDir = join(workspacePath, '.e', 'skills', installId);
      installTier = 'workspace';
    }

    // Write skill file
    await mkdir(installDir, { recursive: true });
    const skillFile = join(installDir, 'SKILL.md');
    await writeFile(skillFile, skillContent, 'utf-8');

    // Also write to .claude/skills for backward compat (workspace only)
    if (installTier === 'workspace') {
      const claudeDir = join(workspacePath, '.claude', 'skills', installId);
      await mkdir(claudeDir, { recursive: true });
      await writeFile(join(claudeDir, 'SKILL.md'), skillContent, 'utf-8');
    }

    // Record in database
    const db = getDb();
    const now = Date.now();
    const existingRecord = db
      .query(
        'SELECT id FROM installed_skills WHERE skill_id = ? AND (workspace_path = ? OR (workspace_path IS NULL AND ? IS NULL))',
      )
      .get(
        installId,
        installTier === 'workspace' ? workspacePath : null,
        installTier === 'workspace' ? workspacePath : null,
      ) as any;

    if (existingRecord) {
      db.query(
        'UPDATE installed_skills SET version = ?, pinned_version = ?, installed_path = ?, activated = 1, updated_at = ? WHERE id = ?',
      ).run(parsedSkill.metadata.version, pinnedVersion || null, skillFile, now, existingRecord.id);
    } else {
      const id = `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      db.query(
        'INSERT INTO installed_skills (id, skill_id, tier, version, pinned_version, installed_path, workspace_path, activated, installed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
      ).run(
        id,
        installId,
        installTier,
        parsedSkill.metadata.version,
        pinnedVersion || null,
        skillFile,
        installTier === 'workspace' ? workspacePath : null,
        now,
        now,
      );
    }

    return c.json({ ok: true, data: { path: skillFile, skillId: installId } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: `Failed to install skill: ${msg}` }, 500);
  }
});

// POST /uninstall - remove an installed skill
app.post('/uninstall', async (c) => {
  const body = await c.req.json();
  const { skillId, workspacePath: reqWorkspacePath } = body;
  if (!skillId) return c.json({ ok: false, error: 'skillId required' }, 400);

  const workspacePath = reqWorkspacePath || getWorkspacePath();

  try {
    ensureSkillsTable();
    const db = getDb();

    // Find the installed record
    const record = db
      .query('SELECT * FROM installed_skills WHERE skill_id = ?')
      .get(skillId) as any;

    if (!record) {
      return c.json({ ok: false, error: 'Skill not installed' }, 404);
    }

    // Cannot uninstall bundled skills
    if (record.tier === 'bundled') {
      return c.json({ ok: false, error: 'Cannot uninstall bundled skills' }, 400);
    }

    // Remove skill files
    const paths = [
      join(homedir(), '.e', 'skills', skillId),
      join(workspacePath, '.e', 'skills', skillId),
      join(workspacePath, '.claude', 'skills', skillId),
    ];

    for (const p of paths) {
      try {
        await rm(p, { recursive: true, force: true });
      } catch {
        // Directory may not exist
      }
    }

    // Remove database record
    db.query('DELETE FROM installed_skills WHERE skill_id = ?').run(skillId);

    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: `Failed to uninstall: ${msg}` }, 500);
  }
});

// GET /installed - list installed skills
app.get('/installed', async (c) => {
  const workspacePath = c.req.query('workspacePath') || getWorkspacePath();
  try {
    ensureSkillsTable();

    const installedRecords = getInstalledRecords(workspacePath);
    const skills: SkillSummary[] = [];

    // Bundled skills are always "installed"
    for (const bundled of BUNDLED_SKILLS) {
      const record = installedRecords.find((r: any) => r.skill_id === bundled.metadata.id);
      skills.push(toSummary(bundled, 'bundled', true, record ? !!record.activated : true));
    }

    // Discover from filesystem
    const dirs = [
      { path: join(homedir(), '.e', 'skills'), tier: 'managed' as SkillTier },
      { path: join(workspacePath, '.e', 'skills'), tier: 'workspace' as SkillTier },
      { path: join(workspacePath, '.claude', 'skills'), tier: 'workspace' as SkillTier },
    ];

    for (const { path: dir, tier } of dirs) {
      const localSkills = await discoverLocalSkills(dir, tier);
      for (const skill of localSkills) {
        if (!skills.find((s) => s.id === skill.metadata.id)) {
          const record = installedRecords.find((r: any) => r.skill_id === skill.metadata.id);
          skills.push(toSummary(skill, tier, true, record ? !!record.activated : true));
        }
      }
    }

    return c.json({ ok: true, data: skills });
  } catch {
    return c.json({ ok: true, data: [] });
  }
});

// POST /create - create a new workspace skill
app.post('/create', async (c) => {
  const body = await c.req.json();
  const {
    name,
    description,
    category = 'other',
    tags = [],
    promptTemplate = '',
    rules = [],
    requiredTools = [],
    requiredMcpServers = [],
    workspacePath: reqWorkspacePath,
  } = body;

  if (!name) return c.json({ ok: false, error: 'name required' }, 400);
  if (!description) return c.json({ ok: false, error: 'description required' }, 400);

  const workspacePath = reqWorkspacePath || getWorkspacePath();

  try {
    ensureSkillsTable();

    // Generate ID from name
    const skillId = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const metadata = {
      id: skillId,
      name,
      description,
      version: '1.0.0',
      category,
      tags,
      requiredTools: requiredTools.length > 0 ? requiredTools : undefined,
      requiredMcpServers: requiredMcpServers.length > 0 ? requiredMcpServers : undefined,
    };

    // Generate SKILL.md content
    const skillMdContent = generateSkillMd(
      metadata,
      promptTemplate || undefined,
      rules.length > 0 ? rules : undefined,
    );

    // Write to workspace .e/skills/
    const skillDir = join(workspacePath, '.e', 'skills', skillId);
    await mkdir(skillDir, { recursive: true });
    const skillFile = join(skillDir, 'SKILL.md');
    await writeFile(skillFile, skillMdContent, 'utf-8');

    // Also write to .claude/skills/ for backward compat
    const claudeDir = join(workspacePath, '.claude', 'skills', skillId);
    await mkdir(claudeDir, { recursive: true });
    await writeFile(join(claudeDir, 'SKILL.md'), skillMdContent, 'utf-8');

    // Record in database
    const db = getDb();
    const now = Date.now();
    const id = `skill-${now}-${Math.random().toString(36).slice(2, 8)}`;
    db.query(
      'INSERT INTO installed_skills (id, skill_id, tier, version, installed_path, workspace_path, activated, installed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
    ).run(id, skillId, 'workspace', '1.0.0', skillFile, workspacePath, now, now);

    return c.json({ ok: true, data: { skillId, path: skillFile } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: `Failed to create skill: ${msg}` }, 500);
  }
});

// PATCH /config - update skill configuration
app.patch('/config', async (c) => {
  const body = await c.req.json();
  const { skillId, config } = body;
  if (!skillId) return c.json({ ok: false, error: 'skillId required' }, 400);

  try {
    ensureSkillsTable();
    const db = getDb();
    const now = Date.now();
    db.query('UPDATE installed_skills SET config = ?, updated_at = ? WHERE skill_id = ?').run(
      JSON.stringify(config),
      now,
      skillId,
    );

    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 500);
  }
});

// PATCH /activate - activate or deactivate a skill
app.patch('/activate', async (c) => {
  const body = await c.req.json();
  const { skillId, activated, workspacePath: reqWorkspacePath } = body;
  if (!skillId) return c.json({ ok: false, error: 'skillId required' }, 400);

  const workspacePath = reqWorkspacePath || getWorkspacePath();

  try {
    ensureSkillsTable();
    const db = getDb();
    const now = Date.now();

    // Check if record exists; if not, create one (e.g. for bundled skills)
    const record = db
      .query('SELECT id FROM installed_skills WHERE skill_id = ?')
      .get(skillId) as any;
    if (record) {
      db.query('UPDATE installed_skills SET activated = ?, updated_at = ? WHERE skill_id = ?').run(
        activated ? 1 : 0,
        now,
        skillId,
      );
    } else {
      // Create a record for activation tracking (bundled/discovered skills)
      const id = `skill-${now}-${Math.random().toString(36).slice(2, 8)}`;
      db.query(
        'INSERT INTO installed_skills (id, skill_id, tier, version, installed_path, workspace_path, activated, installed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(id, skillId, 'bundled', '1.0.0', '', workspacePath, activated ? 1 : 0, now, now);
    }

    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 500);
  }
});

// PATCH /pin-version - pin or unpin version for managed skill
app.patch('/pin-version', async (c) => {
  const body = await c.req.json();
  const { skillId, pinnedVersion } = body;
  if (!skillId) return c.json({ ok: false, error: 'skillId required' }, 400);

  try {
    ensureSkillsTable();
    const db = getDb();
    const now = Date.now();
    db.query(
      'UPDATE installed_skills SET pinned_version = ?, updated_at = ? WHERE skill_id = ?',
    ).run(pinnedVersion || null, now, skillId);

    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 500);
  }
});

// POST /check-updates - check for updates to managed skills
app.post('/check-updates', async (c) => {
  try {
    ensureSkillsTable();
    const db = getDb();
    const managedRecords = db
      .query("SELECT * FROM installed_skills WHERE tier = 'managed' AND pinned_version IS NULL")
      .all() as any[];

    if (managedRecords.length === 0) {
      return c.json({ ok: true, data: { updates: [] } });
    }

    const registrySkills = await fetchRegistrySkills();
    const updates: Array<{
      skillId: string;
      currentVersion: string;
      latestVersion: string;
    }> = [];

    for (const record of managedRecords) {
      const registrySkill = registrySkills.find(
        (s) => s.metadata.id === record.skill_id || s.metadata.name === record.skill_id,
      );
      if (registrySkill && registrySkill.metadata.version !== record.version) {
        updates.push({
          skillId: record.skill_id,
          currentVersion: record.version,
          latestVersion: registrySkill.metadata.version,
        });

        // Auto-update: overwrite the installed file
        if (record.installed_path) {
          try {
            const dir = record.installed_path.replace(/\/SKILL\.md$/, '');
            await mkdir(dir, { recursive: true });
            await writeFile(record.installed_path, registrySkill.raw, 'utf-8');
            db.query('UPDATE installed_skills SET version = ?, updated_at = ? WHERE id = ?').run(
              registrySkill.metadata.version,
              Date.now(),
              record.id,
            );
          } catch {
            // Failed to update file
          }
        }
      }
    }

    return c.json({ ok: true, data: { updates } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 500);
  }
});

// GET /suggest - suggest skills for a query/capability gap
app.get('/suggest', async (c) => {
  const query = (c.req.query('query') || '').toLowerCase();
  if (!query) return c.json({ ok: true, data: [] });

  try {
    // Search across all available skills
    const allSkills: Array<{
      metadata: { id: string; name: string; description: string };
      score: number;
    }> = [];

    // Search bundled
    for (const skill of BUNDLED_SKILLS) {
      const score = calculateRelevanceScore(skill.metadata, query);
      if (score > 0) allSkills.push({ metadata: skill.metadata, score });
    }

    // Search registry
    try {
      const registrySkills = await fetchRegistrySkills();
      for (const skill of registrySkills) {
        const score = calculateRelevanceScore(skill.metadata, query);
        if (score > 0) allSkills.push({ metadata: skill.metadata, score });
      }
    } catch {
      // Registry unavailable
    }

    // Sort by relevance and return top suggestions
    allSkills.sort((a, b) => b.score - a.score);
    const suggestions = allSkills.slice(0, 5).map((s) => ({
      skillId: s.metadata.id,
      skillName: s.metadata.name,
      reason: `Matches "${query}" \u2014 ${s.metadata.description}`,
      confidence: Math.min(s.score / 10, 1),
    }));

    return c.json({ ok: true, data: suggestions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 500);
  }
});

// GET /bundled - list bundled skills
app.get('/bundled', (c) => {
  const skills = BUNDLED_SKILLS.map((s) => toSummary(s, 'bundled', true, true));
  return c.json({ ok: true, data: skills });
});

export { app as skillsRegistryRoutes };
