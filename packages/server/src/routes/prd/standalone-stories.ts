import { Hono } from 'hono';
import { nanoid, getDb, storyFromRow, callLlm } from './helpers';
import type { StandaloneStoryCreateInput, StoryEstimate } from './helpers';

const app = new Hono();

// List standalone stories for a workspace
app.get('/stories', (c) => {
  const db = getDb();
  const workspacePath = c.req.query('workspacePath');
  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath query parameter is required' }, 400);
  }

  const rows = db
    .query(
      'SELECT * FROM prd_stories WHERE prd_id IS NULL AND workspace_path = ? ORDER BY sort_order ASC, created_at ASC',
    )
    .all(workspacePath) as any[];

  return c.json({ ok: true, data: rows.map(storyFromRow) });
});

// List all stories (standalone + PRD-bound) for a workspace
app.get('/stories/all', (c) => {
  const db = getDb();
  const workspacePath = c.req.query('workspacePath');
  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath query parameter is required' }, 400);
  }

  // Standalone stories
  const standaloneRows = db
    .query(
      'SELECT * FROM prd_stories WHERE prd_id IS NULL AND workspace_path = ? ORDER BY sort_order ASC, created_at ASC',
    )
    .all(workspacePath) as any[];

  // PRD-bound stories via JOIN
  const prdStoryRows = db
    .query(
      `SELECT ps.*, p.name as prd_name FROM prd_stories ps
       JOIN prds p ON ps.prd_id = p.id
       WHERE p.workspace_path = ?
       ORDER BY ps.prd_id, ps.sort_order ASC`,
    )
    .all(workspacePath) as any[];

  return c.json({
    ok: true,
    data: {
      standalone: standaloneRows.map(storyFromRow),
      byPrd: prdStoryRows.map((row: any) => ({
        ...storyFromRow(row),
        prdName: row.prd_name,
      })),
    },
  });
});

// Create a standalone story
app.post('/stories', async (c) => {
  const body = (await c.req.json()) as StandaloneStoryCreateInput;
  const db = getDb();

  if (!body.workspacePath || !body.title?.trim()) {
    return c.json({ ok: false, error: 'workspacePath and title are required' }, 400);
  }

  const id = nanoid(12);
  const now = Date.now();

  // Get max sort_order for standalone stories in this workspace
  const maxRow = db
    .query(
      'SELECT MAX(sort_order) as max_order FROM prd_stories WHERE prd_id IS NULL AND workspace_path = ?',
    )
    .get(body.workspacePath) as any;
  const sortOrder = (maxRow?.max_order ?? -1) + 1;

  const criteria = (body.acceptanceCriteria || []).map((desc: string) => ({
    id: nanoid(6),
    description: desc,
    passed: false,
  }));

  db.query(
    `INSERT INTO prd_stories (
      id, prd_id, workspace_path, title, description, acceptance_criteria,
      priority, depends_on, dependency_reasons, status,
      attempts, max_attempts, learnings, sort_order, created_at, updated_at
    )
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, '{}', 'pending', 0, 3, '[]', ?, ?, ?)`,
  ).run(
    id,
    body.workspacePath,
    body.title.trim(),
    body.description || '',
    JSON.stringify(criteria),
    body.priority || 'medium',
    JSON.stringify(body.dependsOn || []),
    sortOrder,
    now,
    now,
  );

  const row = db.query('SELECT * FROM prd_stories WHERE id = ?').get(id) as any;
  return c.json({ ok: true, data: storyFromRow(row) }, 201);
});

// Reorder standalone stories
app.post('/stories/reorder', async (c) => {
  const db = getDb();
  const body = (await c.req.json()) as { storyIds: string[] };

  if (!body.storyIds || !Array.isArray(body.storyIds) || body.storyIds.length === 0) {
    return c.json({ ok: false, error: 'storyIds array is required' }, 400);
  }

  // Validate that proposed order doesn't violate dependency constraints
  const storyRows = db
    .query(
      `SELECT id, depends_on FROM prd_stories WHERE id IN (${body.storyIds.map(() => '?').join(',')})`,
    )
    .all(...body.storyIds) as Array<{ id: string; depends_on: string }>;

  const positionMap = new Map(body.storyIds.map((id, i) => [id, i]));
  const violations: string[] = [];

  for (const row of storyRows) {
    const deps = JSON.parse(row.depends_on || '[]') as string[];
    const myPos = positionMap.get(row.id);
    if (myPos === undefined) continue;
    for (const depId of deps) {
      const depPos = positionMap.get(depId);
      if (depPos !== undefined && depPos > myPos) {
        const depRow = storyRows.find((r) => r.id === depId);
        violations.push(`Story at position ${myPos} depends on story at position ${depPos}`);
      }
    }
  }

  if (violations.length > 0) {
    return c.json(
      {
        ok: false,
        error: `Reorder violates dependency constraints: ${violations.join('; ')}. Dependencies must appear before the stories that depend on them.`,
      },
      400,
    );
  }

  const now = Date.now();

  // Update sort_order for each story based on position in the array
  for (let i = 0; i < body.storyIds.length; i++) {
    db.query('UPDATE prd_stories SET sort_order = ?, updated_at = ? WHERE id = ?').run(
      i,
      now,
      body.storyIds[i],
    );
  }

  return c.json({ ok: true });
});

// Archive all completed standalone stories for a workspace
app.post('/stories/archive-completed', async (c) => {
  const db = getDb();
  const body = (await c.req.json()) as { workspacePath: string };

  if (!body.workspacePath) {
    return c.json({ ok: false, error: 'workspacePath is required' }, 400);
  }

  const now = Date.now();
  const result = db
    .query(
      "UPDATE prd_stories SET status = 'archived', updated_at = ? WHERE prd_id IS NULL AND workspace_path = ? AND status = 'completed'",
    )
    .run(now, body.workspacePath);

  return c.json({ ok: true, data: { archived: result.changes } });
});

// Update a standalone story
app.patch('/stories/:storyId', async (c) => {
  const db = getDb();
  const storyId = c.req.param('storyId');
  const body = await c.req.json();

  const existing = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id IS NULL')
    .get(storyId) as any;
  if (!existing) {
    return c.json({ ok: false, error: 'Standalone story not found' }, 404);
  }

  const updates: string[] = [];
  const values: any[] = [];

  const fieldMap: Record<string, string> = {
    title: 'title',
    description: 'description',
    priority: 'priority',
    status: 'status',
    sortOrder: 'sort_order',
    externalStatus: 'external_status',
    researchOnly: 'research_only',
  };

  // Boolean → integer conversion for SQLite
  if (body.researchOnly !== undefined) {
    body.researchOnly = body.researchOnly ? 1 : 0;
  }

  for (const [key, col] of Object.entries(fieldMap)) {
    if (body[key] !== undefined) {
      updates.push(`${col} = ?`);
      values.push(body[key]);
    }
  }

  // JSON fields
  if (body.acceptanceCriteria !== undefined) {
    const criteria = body.acceptanceCriteria.map((ac: any) =>
      typeof ac === 'string' ? { id: nanoid(6), description: ac, passed: false } : ac,
    );
    updates.push('acceptance_criteria = ?');
    values.push(JSON.stringify(criteria));
  }
  if (body.dependsOn !== undefined) {
    updates.push('depends_on = ?');
    values.push(JSON.stringify(body.dependsOn));
  }
  if (body.dependencyReasons !== undefined) {
    updates.push('dependency_reasons = ?');
    values.push(JSON.stringify(body.dependencyReasons));
  }
  if (body.externalRef !== undefined) {
    updates.push('external_ref = ?');
    values.push(body.externalRef ? JSON.stringify(body.externalRef) : null);
  }

  if (updates.length === 0) {
    return c.json({ ok: true, data: storyFromRow(existing) });
  }

  updates.push('updated_at = ?');
  values.push(Date.now());
  values.push(storyId);

  db.query(`UPDATE prd_stories SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.query('SELECT * FROM prd_stories WHERE id = ?').get(storyId) as any;
  return c.json({ ok: true, data: storyFromRow(updated) });
});

// Delete a standalone story
app.delete('/stories/:storyId', (c) => {
  const db = getDb();
  const storyId = c.req.param('storyId');

  const existing = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id IS NULL')
    .get(storyId) as any;
  if (!existing) {
    return c.json({ ok: false, error: 'Standalone story not found' }, 404);
  }

  db.query('DELETE FROM prd_stories WHERE id = ? AND prd_id IS NULL').run(storyId);
  return c.json({ ok: true });
});

// Estimate a standalone story
app.post('/stories/:storyId/estimate', async (c) => {
  const db = getDb();
  const storyId = c.req.param('storyId');

  const storyRow = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id IS NULL')
    .get(storyId) as any;
  if (!storyRow) {
    return c.json({ ok: false, error: 'Standalone story not found' }, 404);
  }

  const story = storyFromRow(storyRow);

  // Reuse the AI estimation logic (same as PRD story estimation)
  const criteriaText = story.acceptanceCriteria.map((ac: any) => ac.description).join('\n- ');

  const systemPrompt = `You are a senior software engineer who estimates user stories using the Fibonacci story points scale (1, 2, 3, 5, 8, 13).

Return a JSON object with EXACTLY this structure:
{
  "size": "small" | "medium" | "large",
  "storyPoints": <number: 1|2|3|5|8|13>,
  "confidence": "low" | "medium" | "high",
  "confidenceScore": <number: 0-100>,
  "factors": [{"factor": "<description>", "impact": "increases"|"decreases"|"neutral", "weight": "minor"|"moderate"|"major"}],
  "reasoning": "<brief explanation>",
  "suggestedBreakdown": ["<sub-task>"] // ONLY for stories >= 8 points
}

Guidelines:
- small (1-2 pts): simple change, single file, no dependencies
- medium (3-5 pts): moderate complexity, 2-4 files, some dependencies
- large (8-13 pts): high complexity, many files, significant dependencies
- suggestedBreakdown is ONLY for stories estimated at 8+ points`;

  const userPrompt = `Estimate the complexity of this story:

Title: ${story.title}
Description: ${story.description}
${criteriaText ? `Acceptance Criteria:\n- ${criteriaText}` : ''}
Priority: ${story.priority}

Provide a complexity estimate with story points, confidence level, and key factors.`;

  try {
    const response = await callLlm({ system: systemPrompt, user: userPrompt });

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');
    const parsed = JSON.parse(jsonMatch[0]);

    const estimate: StoryEstimate = {
      storyId,
      size: parsed.size || 'medium',
      storyPoints: parsed.storyPoints || 3,
      confidence: parsed.confidence || 'medium',
      confidenceScore: parsed.confidenceScore || 50,
      factors: parsed.factors || [],
      reasoning: (parsed.reasoning || 'Estimate based on story content analysis.').trim(),
      suggestedBreakdown: parsed.suggestedBreakdown,
      isManualOverride: false,
    };

    db.query('UPDATE prd_stories SET estimate = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(estimate),
      Date.now(),
      storyId,
    );

    return c.json({ ok: true, data: { storyId, estimate } });
  } catch (err) {
    return c.json({ ok: false, error: `Estimation failed: ${String(err)}` }, 500);
  }
});

// Save a manual estimate for a standalone story
app.put('/stories/:storyId/estimate', async (c) => {
  const db = getDb();
  const storyId = c.req.param('storyId');
  const body = await c.req.json();

  const storyRow = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id IS NULL')
    .get(storyId) as any;
  if (!storyRow) {
    return c.json({ ok: false, error: 'Standalone story not found' }, 404);
  }

  const existingEstimate = storyRow.estimate ? JSON.parse(storyRow.estimate) : {};

  const estimate: StoryEstimate = {
    ...existingEstimate,
    storyId,
    size: body.size || existingEstimate.size || 'medium',
    storyPoints: body.storyPoints ?? existingEstimate.storyPoints ?? 3,
    confidence: 'high',
    confidenceScore: 100,
    reasoning: body.reasoning || 'Manual estimate',
    isManualOverride: true,
  };

  db.query('UPDATE prd_stories SET estimate = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(estimate),
    Date.now(),
    storyId,
  );

  return c.json({ ok: true, data: { storyId, estimate } });
});

export default app;
