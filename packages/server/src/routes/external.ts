import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import {
  getExternalProvider,
  getProviderConfig,
  saveProviderConfig,
  getSupportedProviders,
} from '../services/external-providers';
import type { ExternalProviderConfig, ImportExternalIssuesRequest } from '@e/shared';

const app = new Hono();

// ── Save provider config ──

app.post('/config', async (c) => {
  const body = (await c.req.json()) as Partial<ExternalProviderConfig>;
  const { provider, apiKey } = body;

  if (!provider || !apiKey) {
    return c.json({ ok: false, error: 'provider and apiKey are required' }, 400);
  }

  const supported = getSupportedProviders();
  if (!supported.includes(provider)) {
    return c.json(
      { ok: false, error: `Unknown provider: ${provider}. Supported: ${supported.join(', ')}` },
      400,
    );
  }

  const config: ExternalProviderConfig = {
    provider,
    apiKey,
    email: body.email,
    baseUrl: body.baseUrl,
    teamId: body.teamId,
    workspaceGid: body.workspaceGid,
  };

  saveProviderConfig(config);
  return c.json({ ok: true });
});

// ── Get config status (non-sensitive) ──

app.get('/config/:provider', (c) => {
  const provider = c.req.param('provider');
  const config = getProviderConfig(provider);

  return c.json({
    ok: true,
    data: {
      configured: !!config,
      provider,
      baseUrl: config?.baseUrl || null,
      email: config?.email ? config.email.replace(/(.{2}).*(@.*)/, '$1***$2') : null,
      teamId: config?.teamId || null,
      workspaceGid: config?.workspaceGid || null,
    },
  });
});

// ── Test connection ──

app.post('/test/:provider', async (c) => {
  const provider = c.req.param('provider');
  const config = getProviderConfig(provider);

  if (!config) {
    return c.json({ ok: true, data: { connected: false, error: 'Provider not configured' } });
  }

  try {
    const ext = getExternalProvider(provider);
    const connected = await ext.testConnection(config);
    return c.json({ ok: true, data: { connected, error: connected ? null : 'Connection failed' } });
  } catch (err) {
    return c.json({ ok: true, data: { connected: false, error: String(err) } });
  }
});

// ── List projects ──

app.get('/projects/:provider', async (c) => {
  const provider = c.req.param('provider');
  const config = getProviderConfig(provider);

  if (!config) {
    return c.json({ ok: false, error: `${provider} is not configured` }, 400);
  }

  try {
    const ext = getExternalProvider(provider);
    const projects = await ext.listProjects(config);
    return c.json({ ok: true, data: projects });
  } catch (err) {
    return c.json({ ok: false, error: `Failed to list projects: ${String(err)}` }, 500);
  }
});

// ── Fetch issues from a project ──

app.get('/issues/:provider/:projectKey', async (c) => {
  const provider = c.req.param('provider');
  const projectKey = c.req.param('projectKey');
  const config = getProviderConfig(provider);
  const status = c.req.query('status');
  const maxResults = parseInt(c.req.query('maxResults') || '50', 10);

  if (!config) {
    return c.json({ ok: false, error: `${provider} is not configured` }, 400);
  }

  try {
    const ext = getExternalProvider(provider);
    const issues = await ext.listIssues(config, projectKey, {
      status: status || undefined,
      maxResults,
    });
    return c.json({ ok: true, data: issues });
  } catch (err) {
    return c.json({ ok: false, error: `Failed to fetch issues: ${String(err)}` }, 500);
  }
});

// ── Import issues → create thin prd_stories rows ──

app.post('/import', async (c) => {
  const body = (await c.req.json()) as ImportExternalIssuesRequest;
  const { provider, projectKey, workspacePath, issueIds, prdId } = body;

  if (!provider || !projectKey || !workspacePath) {
    return c.json(
      { ok: false, error: 'provider, projectKey, and workspacePath are required' },
      400,
    );
  }

  const config = getProviderConfig(provider);
  if (!config) {
    return c.json({ ok: false, error: `${provider} is not configured` }, 400);
  }

  const db = getDb();
  const ext = getExternalProvider(provider);

  try {
    // Fetch issues from provider
    let issues = await ext.listIssues(config, projectKey, { maxResults: 100 });

    // Filter to specific IDs if requested
    if (issueIds && issueIds.length > 0) {
      const idSet = new Set(issueIds);
      issues = issues.filter((i) => idSet.has(i.externalId));
    }

    // Check which are already imported
    const existingRows = db
      .query(
        'SELECT external_ref FROM prd_stories WHERE external_ref IS NOT NULL AND workspace_path = ?',
      )
      .all(workspacePath) as any[];

    const existingExternalIds = new Set<string>();
    for (const row of existingRows) {
      try {
        const ref = JSON.parse(row.external_ref);
        if (ref.externalId) existingExternalIds.add(ref.externalId);
      } catch {}
    }

    const storyIds: string[] = [];
    const errors: string[] = [];
    let skipped = 0;

    // Get max sort_order for insertion ordering
    const maxOrderRow = db
      .query(
        prdId
          ? 'SELECT MAX(sort_order) as max_order FROM prd_stories WHERE prd_id = ?'
          : 'SELECT MAX(sort_order) as max_order FROM prd_stories WHERE prd_id IS NULL AND workspace_path = ?',
      )
      .get(prdId || workspacePath) as any;
    let sortOrder = (maxOrderRow?.max_order || 0) + 1;

    const now = Date.now();

    for (const issue of issues) {
      if (existingExternalIds.has(issue.externalId)) {
        skipped++;
        continue;
      }

      try {
        const storyId = nanoid(12);
        const externalRef = JSON.stringify({
          provider: issue.provider,
          externalId: issue.externalId,
          externalUrl: issue.externalUrl,
          syncedAt: now,
          syncDirection: 'pull',
        });

        // Map external status category to our story status
        let status: string;
        switch (issue.statusCategory) {
          case 'in_progress':
            status = 'in_progress';
            break;
          case 'done':
            status = 'completed';
            break;
          default:
            status = 'pending';
        }

        const acceptanceCriteria = JSON.stringify(
          issue.acceptanceCriteria.map((ac: string) => ({
            id: nanoid(6),
            description: ac,
            passed: false,
          })),
        );

        db.query(
          `INSERT INTO prd_stories (
            id, prd_id, workspace_path, title, description, acceptance_criteria,
            priority, depends_on, dependency_reasons, status, attempts, max_attempts,
            learnings, sort_order, external_ref, external_status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '{}', ?, 0, 3, '[]', ?, ?, ?, ?, ?)`,
        ).run(
          storyId,
          prdId || null,
          workspacePath,
          issue.title,
          issue.description,
          acceptanceCriteria,
          issue.priorityNormalized,
          status,
          sortOrder++,
          externalRef,
          issue.status,
          now,
          now,
        );

        storyIds.push(storyId);
      } catch (err) {
        errors.push(`Failed to import ${issue.externalId}: ${String(err)}`);
      }
    }

    return c.json({
      ok: true,
      data: {
        imported: storyIds.length,
        skipped,
        storyIds,
        errors,
      },
    });
  } catch (err) {
    return c.json({ ok: false, error: `Import failed: ${String(err)}` }, 500);
  }
});

// ── Refresh a single story from its external source ──

app.post('/refresh/:storyId', async (c) => {
  const storyId = c.req.param('storyId');
  const db = getDb();

  const row = db.query('SELECT * FROM prd_stories WHERE id = ?').get(storyId) as any;
  if (!row) return c.json({ ok: false, error: 'Story not found' }, 404);
  if (!row.external_ref)
    return c.json({ ok: false, error: 'Story has no external reference' }, 400);

  const externalRef = JSON.parse(row.external_ref);
  const config = getProviderConfig(externalRef.provider);
  if (!config) {
    return c.json({ ok: false, error: `${externalRef.provider} is not configured` }, 400);
  }

  try {
    const ext = getExternalProvider(externalRef.provider);
    const issue = await ext.getIssue(config, externalRef.externalId);

    const now = Date.now();
    const updates: string[] = [];
    const values: any[] = [];

    // Always update content fields (source of truth is remote)
    updates.push('title = ?', 'description = ?', 'priority = ?', 'external_status = ?');
    values.push(issue.title, issue.description, issue.priorityNormalized, issue.status);

    // Update acceptance criteria
    updates.push('acceptance_criteria = ?');
    values.push(
      JSON.stringify(
        issue.acceptanceCriteria.map((ac: string) => ({
          id: nanoid(6),
          description: ac,
          passed: false,
        })),
      ),
    );

    // Only update local status if not in a loop-managed state (don't interrupt active work or QA)
    if (row.status !== 'in_progress' && row.status !== 'qa') {
      let status: string;
      switch (issue.statusCategory) {
        case 'in_progress':
          status = 'in_progress';
          break;
        case 'done':
          status = 'completed';
          break;
        default:
          status = 'pending';
      }
      updates.push('status = ?');
      values.push(status);
    }

    // Update syncedAt
    const updatedRef = { ...externalRef, syncedAt: now };
    updates.push('external_ref = ?', 'updated_at = ?');
    values.push(JSON.stringify(updatedRef), now);

    values.push(storyId);
    db.query(`UPDATE prd_stories SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return c.json({ ok: true, data: { storyId, refreshedFrom: issue.externalId } });
  } catch (err) {
    return c.json({ ok: false, error: `Refresh failed: ${String(err)}` }, 500);
  }
});

// ── Refresh all external stories in a workspace ──

app.post('/refresh-all', async (c) => {
  const body = (await c.req.json()) as { workspacePath: string };
  if (!body.workspacePath) {
    return c.json({ ok: false, error: 'workspacePath is required' }, 400);
  }

  const db = getDb();
  const rows = db
    .query(
      'SELECT id, external_ref FROM prd_stories WHERE external_ref IS NOT NULL AND workspace_path = ?',
    )
    .all(body.workspacePath) as any[];

  let refreshed = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      const externalRef = JSON.parse(row.external_ref);
      const config = getProviderConfig(externalRef.provider);
      if (!config) continue;

      const ext = getExternalProvider(externalRef.provider);
      const issue = await ext.getIssue(config, externalRef.externalId);

      const storyRow = db.query('SELECT status FROM prd_stories WHERE id = ?').get(row.id) as any;
      const now = Date.now();

      const updates: string[] = [
        'title = ?',
        'description = ?',
        'priority = ?',
        'external_status = ?',
        'external_ref = ?',
        'updated_at = ?',
      ];
      const values: any[] = [
        issue.title,
        issue.description,
        issue.priorityNormalized,
        issue.status,
        JSON.stringify({ ...externalRef, syncedAt: now }),
        now,
      ];

      // Only update status if not in_progress
      if (storyRow?.status !== 'in_progress') {
        let status: string;
        switch (issue.statusCategory) {
          case 'in_progress':
            status = 'in_progress';
            break;
          case 'done':
            status = 'completed';
            break;
          default:
            status = 'pending';
        }
        updates.push('status = ?');
        values.push(status);
      }

      values.push(row.id);
      db.query(`UPDATE prd_stories SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      refreshed++;
    } catch (err) {
      errors.push(`${row.id}: ${String(err)}`);
    }
  }

  return c.json({ ok: true, data: { refreshed, total: rows.length, errors } });
});

// ── Push status back to external provider ──

app.post('/push-status', async (c) => {
  const body = (await c.req.json()) as {
    storyId: string;
    status: 'completed' | 'failed' | 'in_progress';
    commitSha?: string;
    prUrl?: string;
    comment?: string;
  };

  if (!body.storyId || !body.status) {
    return c.json({ ok: false, error: 'storyId and status are required' }, 400);
  }

  const db = getDb();
  const row = db.query('SELECT * FROM prd_stories WHERE id = ?').get(body.storyId) as any;
  if (!row) return c.json({ ok: false, error: 'Story not found' }, 404);
  if (!row.external_ref)
    return c.json({ ok: false, error: 'Story has no external reference' }, 400);

  const externalRef = JSON.parse(row.external_ref);
  const config = getProviderConfig(externalRef.provider);
  if (!config) {
    return c.json({ ok: false, error: `${externalRef.provider} is not configured` }, 400);
  }

  try {
    const ext = getExternalProvider(externalRef.provider);
    await ext.pushStatus(config, externalRef.externalId, body.status, {
      commitSha: body.commitSha,
      prUrl: body.prUrl,
      comment: body.comment,
    });

    // Update syncedAt
    const updatedRef = { ...externalRef, syncedAt: Date.now() };
    db.query('UPDATE prd_stories SET external_ref = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(updatedRef),
      Date.now(),
      body.storyId,
    );

    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: `Push failed: ${String(err)}` }, 500);
  }
});

export { app as externalRoutes };
