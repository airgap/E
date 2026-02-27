import { Hono } from 'hono';
import { nanoid, getDb, prdFromRow, storyFromRow, reorderStoriesByDependencies } from './helpers';
import type { PRDCreateInput, StoryPriority } from './helpers';
import { prdEvents, type PrdEvent } from './events';

const app = new Hono();

/** Fire-and-forget PRD event emission. */
function emitPrdEvent(event: PrdEvent): void {
  try {
    prdEvents.emit('prd_change', event);
  } catch {
    /* never block the request */
  }
}

// List PRDs (optionally filtered by workspacePath).
// Includes stories for each PRD so clients can display counts immediately
// without a separate per-PRD fetch.
app.get('/', (c) => {
  const db = getDb();
  const workspacePath = c.req.query('workspacePath');

  let rows: any[];
  if (workspacePath) {
    rows = db
      .query('SELECT * FROM prds WHERE workspace_path = ? ORDER BY updated_at DESC')
      .all(workspacePath);
  } else {
    rows = db.query('SELECT * FROM prds ORDER BY updated_at DESC').all();
  }

  return c.json({
    ok: true,
    data: rows.map((row) => {
      const stories = db
        .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC')
        .all(row.id) as any[];
      return {
        ...prdFromRow(row),
        stories: stories.map(storyFromRow),
      };
    }),
  });
});

// SSE endpoint for real-time PRD change notifications
// Must be registered before /:id to avoid being caught by the parameter route
app.get('/events', (c) => {
  const workspacePath = c.req.query('workspacePath');
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: PrdEvent | { type: string; ts: number }) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* client disconnected */
        }
      };

      // Initial ping
      send({ type: 'ping', ts: Date.now() });

      const handler = (event: PrdEvent) => {
        // If client specified a workspace filter, only send matching events
        if (workspacePath && event.workspacePath && event.workspacePath !== workspacePath) {
          return;
        }
        send(event);
      };

      prdEvents.on('prd_change', handler);

      // Keep-alive ping every 20s
      const pingInterval = setInterval(() => {
        send({ type: 'ping', ts: Date.now() });
      }, 20000);

      // Cleanup on client disconnect
      c.req.raw.signal?.addEventListener('abort', () => {
        prdEvents.off('prd_change', handler);
        clearInterval(pingInterval);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

// Get single PRD with all stories
app.get('/:id', (c) => {
  const db = getDb();
  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(c.req.param('id')) as any;
  if (!prdRow) return c.json({ ok: false, error: 'Not found' }, 404);

  const stories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(prdRow.id) as any[];

  return c.json({
    ok: true,
    data: {
      ...prdFromRow(prdRow),
      stories: stories.map(storyFromRow),
    },
  });
});

// Create PRD with stories
app.post('/', async (c) => {
  const body = (await c.req.json()) as PRDCreateInput;
  const db = getDb();
  const prdId = nanoid(12);
  const now = Date.now();

  db.query(
    `INSERT INTO prds (id, workspace_path, name, description, branch_name, quality_checks, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    prdId,
    body.workspacePath,
    body.name,
    body.description || '',
    body.branchName || null,
    JSON.stringify(body.qualityChecks || []),
    now,
    now,
  );

  // Create stories
  const storyInsert = db.query(
    `INSERT INTO prd_stories (id, prd_id, title, description, acceptance_criteria, priority, depends_on, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const storyIds: string[] = [];
  for (let i = 0; i < (body.stories || []).length; i++) {
    const s = body.stories[i];
    const storyId = nanoid(12);
    storyIds.push(storyId);

    const criteria = s.acceptanceCriteria.map((desc) => ({
      id: nanoid(8),
      description: desc,
      passed: false,
    }));

    storyInsert.run(
      storyId,
      prdId,
      s.title,
      s.description || '',
      JSON.stringify(criteria),
      s.priority || 'medium',
      JSON.stringify(s.dependsOn || []),
      i,
      now,
      now,
    );
  }

  // Reorder stories so sort_order respects dependency constraints
  if (storyIds.length > 0) {
    reorderStoriesByDependencies(db, prdId);
  }

  emitPrdEvent({ type: 'prd_created', prdId, workspacePath: body.workspacePath, ts: now });

  return c.json({ ok: true, data: { id: prdId, storyIds } }, 201);
});

// Update PRD metadata
app.patch('/:id', async (c) => {
  const body = await c.req.json();
  const db = getDb();
  const id = c.req.param('id');

  const existing = db.query('SELECT * FROM prds WHERE id = ?').get(id);
  if (!existing) return c.json({ ok: false, error: 'Not found' }, 404);

  const updates: string[] = [];
  const values: any[] = [];

  for (const field of ['name', 'description', 'branch_name'] as const) {
    const camelField = field === 'branch_name' ? 'branchName' : field;
    if (body[camelField] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(body[camelField]);
    }
  }
  if (body.qualityChecks !== undefined) {
    updates.push('quality_checks = ?');
    values.push(JSON.stringify(body.qualityChecks));
  }
  if (body.workflowConfig !== undefined) {
    updates.push('workflow_config = ?');
    values.push(JSON.stringify(body.workflowConfig));
  }

  if (updates.length === 0) return c.json({ ok: false, error: 'No fields to update' }, 400);

  updates.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);

  db.query(`UPDATE prds SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  emitPrdEvent({ type: 'prd_updated', prdId: id, ts: Date.now() });

  return c.json({ ok: true });
});

// Delete PRD (cascades to stories)
app.delete('/:id', (c) => {
  const db = getDb();
  const id = c.req.param('id');
  const result = db.query('DELETE FROM prds WHERE id = ?').run(id);
  if (result.changes === 0) return c.json({ ok: false, error: 'Not found' }, 404);

  emitPrdEvent({ type: 'prd_deleted', prdId: id, ts: Date.now() });

  return c.json({ ok: true });
});

// Add story to existing PRD
app.post('/:id/stories', async (c) => {
  const body = await c.req.json();
  const db = getDb();
  const prdId = c.req.param('id');

  const prd = db.query('SELECT * FROM prds WHERE id = ?').get(prdId);
  if (!prd) return c.json({ ok: false, error: 'PRD not found' }, 404);

  // Get max sort_order
  const maxRow = db
    .query('SELECT MAX(sort_order) as max_order FROM prd_stories WHERE prd_id = ?')
    .get(prdId) as any;
  const sortOrder = (maxRow?.max_order ?? -1) + 1;

  const storyId = nanoid(12);
  const now = Date.now();

  const criteria = (body.acceptanceCriteria || []).map((desc: string) => ({
    id: nanoid(8),
    description: desc,
    passed: false,
  }));

  db.query(
    `INSERT INTO prd_stories (id, prd_id, title, description, acceptance_criteria, priority, depends_on, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    storyId,
    prdId,
    body.title,
    body.description || '',
    JSON.stringify(criteria),
    body.priority || 'medium',
    JSON.stringify(body.dependsOn || []),
    sortOrder,
    now,
    now,
  );

  // Reorder so new story (and any it depends on) are in correct topological order
  if ((body.dependsOn || []).length > 0) {
    reorderStoriesByDependencies(db, prdId);
  }

  // Touch PRD updated_at
  db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);

  emitPrdEvent({ type: 'story_added', prdId, storyId, ts: now });

  return c.json({ ok: true, data: { id: storyId } }, 201);
});

// Update a story
app.patch('/:prdId/stories/:storyId', async (c) => {
  const body = await c.req.json();
  const db = getDb();
  const storyId = c.req.param('storyId');

  const existing = db.query('SELECT * FROM prd_stories WHERE id = ?').get(storyId) as any;
  if (!existing) return c.json({ ok: false, error: 'Story not found' }, 404);

  const updates: string[] = [];
  const values: any[] = [];

  const fieldMap: Record<string, string> = {
    title: 'title',
    description: 'description',
    priority: 'priority',
    status: 'status',
    taskId: 'task_id',
    agentId: 'agent_id',
    conversationId: 'conversation_id',
    commitSha: 'commit_sha',
    attempts: 'attempts',
    maxAttempts: 'max_attempts',
    sortOrder: 'sort_order',
    researchOnly: 'research_only',
  };

  // Boolean → integer conversion for SQLite
  if (body.researchOnly !== undefined) {
    body.researchOnly = body.researchOnly ? 1 : 0;
  }

  for (const [camel, snake] of Object.entries(fieldMap)) {
    if (body[camel] !== undefined) {
      updates.push(`${snake} = ?`);
      values.push(body[camel]);
    }
  }

  if (body.acceptanceCriteria !== undefined) {
    updates.push('acceptance_criteria = ?');
    values.push(JSON.stringify(body.acceptanceCriteria));
  }
  if (body.dependsOn !== undefined) {
    updates.push('depends_on = ?');
    values.push(JSON.stringify(body.dependsOn));
  }
  if (body.learnings !== undefined) {
    updates.push('learnings = ?');
    values.push(JSON.stringify(body.learnings));
  }
  if (body.estimate !== undefined) {
    updates.push('estimate = ?');
    values.push(body.estimate ? JSON.stringify(body.estimate) : null);
  }
  // Append a single learning without replacing
  if (body.addLearning) {
    const current = JSON.parse(existing.learnings || '[]');
    current.push(body.addLearning);
    updates.push('learnings = ?');
    values.push(JSON.stringify(current));
  }

  if (updates.length === 0) return c.json({ ok: false, error: 'No fields to update' }, 400);

  const now = Date.now();
  updates.push('updated_at = ?');
  values.push(now);
  values.push(storyId);

  db.query(`UPDATE prd_stories SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  // Touch PRD updated_at
  const prdId = c.req.param('prdId');
  db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);

  // Reorder and invalidate priority recommendations when dependencies change
  if (body.dependsOn !== undefined) {
    // Reorder stories to respect updated dependency constraints
    if (existing.prd_id) {
      reorderStoriesByDependencies(db, existing.prd_id);
    }

    // Invalidate this story's recommendation since its dependencies changed
    db.query(
      'UPDATE prd_stories SET priority_recommendation = NULL, updated_at = ? WHERE id = ?',
    ).run(now, storyId);
    // Also invalidate recommendations for stories that were previously depended on
    // (they might have had their blocksCount change)
    const oldDeps: string[] = JSON.parse(existing.depends_on || '[]');
    const newDeps: string[] = body.dependsOn;
    const affectedIds = new Set([...oldDeps, ...newDeps]);
    for (const depId of affectedIds) {
      db.query(
        'UPDATE prd_stories SET priority_recommendation = NULL, updated_at = ? WHERE id = ?',
      ).run(now, depId);
    }
  }

  // Invalidate priority recommendations for related stories when priority changes
  // (sibling stories' recommendations may reference this story's priority level)
  if (body.priority !== undefined && body.priority !== existing.priority) {
    // Invalidate recommendations for stories that depend on this one or that this one depends on
    const deps: string[] = JSON.parse(existing.depends_on || '[]');
    const allPrdStories = db
      .query('SELECT id, depends_on FROM prd_stories WHERE prd_id = ?')
      .all(prdId) as any[];
    const blockedByThis = allPrdStories
      .filter((s: any) => {
        const d: string[] = JSON.parse(s.depends_on || '[]');
        return d.includes(storyId);
      })
      .map((s: any) => s.id);
    const affectedIds = new Set([...deps, ...blockedByThis]);
    for (const id of affectedIds) {
      db.query(
        'UPDATE prd_stories SET priority_recommendation = NULL, updated_at = ? WHERE id = ?',
      ).run(now, id);
    }
  }

  const updated = db.query('SELECT * FROM prd_stories WHERE id = ?').get(storyId);

  emitPrdEvent({ type: 'story_updated', prdId, storyId, ts: now });

  return c.json({ ok: true, data: storyFromRow(updated as any) });
});

// Delete a story
app.delete('/:prdId/stories/:storyId', (c) => {
  const db = getDb();
  const storyId = c.req.param('storyId');
  const result = db.query('DELETE FROM prd_stories WHERE id = ?').run(storyId);
  if (result.changes === 0) return c.json({ ok: false, error: 'Story not found' }, 404);

  // Touch PRD updated_at
  const prdId = c.req.param('prdId');
  const now = Date.now();
  db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);

  emitPrdEvent({ type: 'story_deleted', prdId, storyId, ts: now });

  return c.json({ ok: true });
});

// Archive all completed stories in a PRD
app.post('/:prdId/stories/archive-completed', async (c) => {
  const db = getDb();
  const prdId = c.req.param('prdId');
  const now = Date.now();

  const result = db
    .query(
      "UPDATE prd_stories SET status = 'archived', updated_at = ? WHERE prd_id = ? AND status = 'completed'",
    )
    .run(now, prdId);

  // Touch PRD updated_at
  db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);

  if (result.changes > 0) {
    emitPrdEvent({ type: 'stories_archived', prdId, ts: now });
  }

  return c.json({ ok: true, data: { archived: result.changes } });
});

// Import Ralph-format prd.json
app.post('/import', async (c) => {
  const body = await c.req.json();
  const { workspacePath, prdJson } = body;

  if (!workspacePath || !prdJson) {
    return c.json({ ok: false, error: 'workspacePath and prdJson required' }, 400);
  }

  // Parse Ralph format:
  // { project, branchName, description, userStories: [{ id, title, description, acceptanceCriteria, priority, passes }] }
  const ralph = typeof prdJson === 'string' ? JSON.parse(prdJson) : prdJson;

  const db = getDb();
  const prdId = nanoid(12);
  const now = Date.now();

  db.query(
    `INSERT INTO prds (id, workspace_path, name, description, branch_name, quality_checks, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '[]', ?, ?)`,
  ).run(
    prdId,
    workspacePath,
    ralph.project || 'Imported PRD',
    ralph.description || '',
    ralph.branchName || null,
    now,
    now,
  );

  const storyInsert = db.query(
    `INSERT INTO prd_stories (id, prd_id, title, description, acceptance_criteria, priority, depends_on, status, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)`,
  );

  const storyIds: string[] = [];
  const ralphStories = ralph.userStories || ralph.stories || [];

  for (let i = 0; i < ralphStories.length; i++) {
    const rs = ralphStories[i];
    const storyId = nanoid(12);
    storyIds.push(storyId);

    // Ralph acceptanceCriteria can be string[] or {description}[]
    const rawCriteria = rs.acceptanceCriteria || [];
    const criteria = rawCriteria.map((ac: string | { description: string }) => ({
      id: nanoid(8),
      description: typeof ac === 'string' ? ac : ac.description,
      passed: false,
    }));

    // Map Ralph priority (number 1-4) to our string priority
    let priority: StoryPriority = 'medium';
    if (typeof rs.priority === 'number') {
      priority =
        rs.priority <= 1
          ? 'critical'
          : rs.priority === 2
            ? 'high'
            : rs.priority === 3
              ? 'medium'
              : 'low';
    } else if (typeof rs.priority === 'string') {
      priority = rs.priority as StoryPriority;
    }

    const status = rs.passes === true ? 'completed' : 'pending';

    storyInsert.run(
      storyId,
      prdId,
      rs.title,
      rs.description || '',
      JSON.stringify(criteria),
      priority,
      status,
      i,
      now,
      now,
    );
  }

  emitPrdEvent({ type: 'prd_created', prdId, workspacePath, ts: now });

  return c.json({ ok: true, data: { id: prdId, storyIds, imported: ralphStories.length } }, 201);
});

// Export PRD as Ralph-compatible prd.json
app.get('/:id/export', (c) => {
  const db = getDb();
  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(c.req.param('id')) as any;
  if (!prdRow) return c.json({ ok: false, error: 'Not found' }, 404);

  const stories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC')
    .all(prdRow.id) as any[];

  // Map priority string to Ralph number
  const priorityMap: Record<string, number> = { critical: 1, high: 2, medium: 3, low: 4 };

  const ralph = {
    project: prdRow.name,
    branchName: prdRow.branch_name || `ralph/${prdRow.name.toLowerCase().replace(/\s+/g, '-')}`,
    description: prdRow.description,
    userStories: stories.map((s, i) => ({
      id: `US-${String(i + 1).padStart(3, '0')}`,
      title: s.title,
      description: s.description,
      acceptanceCriteria: JSON.parse(s.acceptance_criteria || '[]').map(
        (ac: any) => ac.description || ac,
      ),
      priority: priorityMap[s.priority] || 3,
      passes: s.status === 'completed',
      notes: '',
    })),
  };

  return c.json({ ok: true, data: ralph });
});

export default app;
