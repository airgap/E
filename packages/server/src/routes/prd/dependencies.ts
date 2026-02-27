import { Hono } from 'hono';
import {
  getDb,
  storyFromRow,
  callLlm,
  buildDependencyGraph,
  detectCircularDependencies,
  validateSprintPlan,
} from './helpers';
import type { StoryDependency, AnalyzeDependenciesRequest } from './helpers';

const app = new Hono();

// --- Dependency Management ---

// Get dependency graph for a PRD
app.get('/:id/dependencies', (c) => {
  const db = getDb();
  const prdId = c.req.param('id');

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const stories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(prdId) as any[];

  const graph = buildDependencyGraph(stories.map(storyFromRow), prdId);
  return c.json({ ok: true, data: graph });
});

// Add or update a dependency between two stories
app.post('/:id/dependencies', async (c) => {
  const db = getDb();
  const prdId = c.req.param('id');
  const body = await c.req.json();

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId);
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const { fromStoryId, toStoryId, reason } = body;
  if (!fromStoryId || !toStoryId) {
    return c.json({ ok: false, error: 'fromStoryId and toStoryId required' }, 400);
  }
  if (fromStoryId === toStoryId) {
    return c.json({ ok: false, error: 'A story cannot depend on itself' }, 400);
  }

  // Verify both stories exist and belong to this PRD
  const fromStory = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id = ?')
    .get(fromStoryId, prdId) as any;
  const toStory = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id = ?')
    .get(toStoryId, prdId) as any;
  if (!fromStory)
    return c.json({ ok: false, error: `Story ${fromStoryId} not found in this PRD` }, 404);
  if (!toStory)
    return c.json({ ok: false, error: `Story ${toStoryId} not found in this PRD` }, 404);

  // fromStoryId depends on toStoryId (toStoryId blocks fromStoryId)
  const dependsOn: string[] = JSON.parse(fromStory.depends_on || '[]');
  const reasons: Record<string, string> = JSON.parse(fromStory.dependency_reasons || '{}');
  const now = Date.now();

  let changed = false;
  if (!dependsOn.includes(toStoryId)) {
    dependsOn.push(toStoryId);
    changed = true;
  }

  // Store or update reason
  if (reason) {
    reasons[toStoryId] = reason;
    changed = true;
  }

  if (changed) {
    db.query(
      'UPDATE prd_stories SET depends_on = ?, dependency_reasons = ?, updated_at = ? WHERE id = ?',
    ).run(JSON.stringify(dependsOn), JSON.stringify(reasons), now, fromStoryId);
    // Invalidate priority recommendations for affected stories when dependencies change
    db.query(
      'UPDATE prd_stories SET priority_recommendation = NULL, updated_at = ? WHERE id = ? OR id = ?',
    ).run(now, fromStoryId, toStoryId);
    db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);
  }

  // Return the updated graph
  const stories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(prdId) as any[];
  const graph = buildDependencyGraph(stories.map(storyFromRow), prdId);

  return c.json({ ok: true, data: graph });
});

// Remove a dependency between two stories
app.delete('/:id/dependencies', async (c) => {
  const db = getDb();
  const prdId = c.req.param('id');
  const body = await c.req.json();

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId);
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const { fromStoryId, toStoryId } = body;
  if (!fromStoryId || !toStoryId) {
    return c.json({ ok: false, error: 'fromStoryId and toStoryId required' }, 400);
  }

  const fromStory = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id = ?')
    .get(fromStoryId, prdId) as any;
  if (!fromStory)
    return c.json({ ok: false, error: `Story ${fromStoryId} not found in this PRD` }, 404);

  const dependsOn: string[] = JSON.parse(fromStory.depends_on || '[]');
  const reasons: Record<string, string> = JSON.parse(fromStory.dependency_reasons || '{}');
  const filtered = dependsOn.filter((id) => id !== toStoryId);

  if (filtered.length !== dependsOn.length) {
    // Also remove the reason for this dependency
    delete reasons[toStoryId];
    const now = Date.now();
    db.query(
      'UPDATE prd_stories SET depends_on = ?, dependency_reasons = ?, updated_at = ? WHERE id = ?',
    ).run(JSON.stringify(filtered), JSON.stringify(reasons), now, fromStoryId);
    // Invalidate priority recommendations for affected stories when dependencies change
    db.query(
      'UPDATE prd_stories SET priority_recommendation = NULL, updated_at = ? WHERE id = ? OR id = ?',
    ).run(now, fromStoryId, toStoryId);
    db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);
  }

  // Return the updated graph
  const stories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(prdId) as any[];
  const graph = buildDependencyGraph(stories.map(storyFromRow), prdId);

  return c.json({ ok: true, data: graph });
});

// Edit a dependency's reason
app.patch('/:id/dependencies', async (c) => {
  const db = getDb();
  const prdId = c.req.param('id');
  const body = await c.req.json();

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId);
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const { fromStoryId, toStoryId, reason } = body;
  if (!fromStoryId || !toStoryId) {
    return c.json({ ok: false, error: 'fromStoryId and toStoryId required' }, 400);
  }

  const fromStory = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id = ?')
    .get(fromStoryId, prdId) as any;
  if (!fromStory)
    return c.json({ ok: false, error: `Story ${fromStoryId} not found in this PRD` }, 404);

  const dependsOn: string[] = JSON.parse(fromStory.depends_on || '[]');
  if (!dependsOn.includes(toStoryId)) {
    return c.json({ ok: false, error: 'Dependency does not exist' }, 404);
  }

  const reasons: Record<string, string> = JSON.parse(fromStory.dependency_reasons || '{}');
  if (reason !== undefined && reason !== null) {
    if (reason === '') {
      delete reasons[toStoryId];
    } else {
      reasons[toStoryId] = reason;
    }
  }

  const now = Date.now();
  db.query('UPDATE prd_stories SET dependency_reasons = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(reasons),
    now,
    fromStoryId,
  );
  db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);

  // Return the updated graph
  const stories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(prdId) as any[];
  const graph = buildDependencyGraph(stories.map(storyFromRow), prdId);

  return c.json({ ok: true, data: graph });
});

// AI-powered dependency analysis
app.post('/:id/dependencies/analyze', async (c) => {
  const db = getDb();
  const prdId = c.req.param('id');
  const body = (await c.req.json()) as AnalyzeDependenciesRequest;

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const stories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(prdId) as any[];

  if (stories.length < 2) {
    return c.json({ ok: false, error: 'Need at least 2 stories to analyze dependencies' }, 400);
  }

  const mappedStories = stories.map(storyFromRow);

  // Build story context for AI analysis
  let storyContext = '';
  for (const s of mappedStories) {
    const criteria = s.acceptanceCriteria.map((ac: any) => `  - ${ac.description}`).join('\n');
    storyContext += `\n### Story "${s.title}" (ID: ${s.id}) [${s.priority}]
${s.description}
Acceptance Criteria:
${criteria}\n`;
  }

  // Preserve manually-added dependencies (they won't be in the AI result)
  // A dependency is "manual" if it existed before analysis and we're not replacing
  const existingDeps: Map<string, string[]> = new Map();
  if (!body.replaceAutoDetected) {
    for (const s of mappedStories) {
      if (s.dependsOn.length > 0) {
        existingDeps.set(s.id, [...s.dependsOn]);
      }
    }
  }

  const systemPrompt = `You are an expert software architect analyzing user stories for a product requirements document to identify dependencies between them.

A dependency exists when one story MUST be completed before another can start. Common reasons:
- Story B builds on infrastructure/features created by Story A
- Story B requires APIs, schemas, or data models defined in Story A
- Story B extends or modifies functionality created by Story A
- Story B tests or validates something implemented in Story A

RULES:
1. Only identify real, technical dependencies — not just thematic relationships
2. A story can depend on multiple other stories
3. Avoid circular dependencies (A→B→C→A)
4. Consider the acceptance criteria when determining dependencies
5. If two stories are independent, do NOT create a dependency between them

You MUST respond with ONLY a valid JSON array. No markdown, no explanation, no code fences.

Each dependency object must have this shape:
{
  "fromStoryId": "<ID of the story that DEPENDS ON another>",
  "toStoryId": "<ID of the story that must be done FIRST>",
  "reason": "<brief explanation of why this dependency exists>"
}

Only return dependencies you are confident about. Empty array [] is valid if stories are independent.`;

  const userPrompt = `Analyze these stories for the PRD "${prdRow.name}" and identify dependencies between them:
${storyContext}

Which stories must be completed before others can start? Return the dependency list as JSON.`;

  try {
    const rawResponse = await callLlm({ system: systemPrompt, user: userPrompt });

    let rawText = rawResponse.trim();
    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    let aiDeps: Array<{ fromStoryId: string; toStoryId: string; reason?: string }>;
    try {
      aiDeps = JSON.parse(rawText);
    } catch {
      return c.json(
        { ok: false, error: 'Failed to parse AI dependency analysis as JSON. Try again.' },
        502,
      );
    }

    if (!Array.isArray(aiDeps)) {
      return c.json({ ok: false, error: 'AI returned invalid dependency format' }, 502);
    }

    // Validate story IDs
    const storyIds = new Set(mappedStories.map((s) => s.id));
    const validDeps = aiDeps.filter(
      (d) =>
        d.fromStoryId &&
        d.toStoryId &&
        storyIds.has(d.fromStoryId) &&
        storyIds.has(d.toStoryId) &&
        d.fromStoryId !== d.toStoryId,
    );

    // Build new depends_on maps
    const newDepsMap: Map<string, Set<string>> = new Map();
    for (const s of mappedStories) {
      newDepsMap.set(s.id, new Set());
    }

    // If not replacing, keep existing manual deps
    if (!body.replaceAutoDetected) {
      for (const [storyId, deps] of existingDeps) {
        for (const dep of deps) {
          newDepsMap.get(storyId)?.add(dep);
        }
      }
    }

    // Add AI-detected deps
    for (const dep of validDeps) {
      newDepsMap.get(dep.fromStoryId)?.add(dep.toStoryId);
    }

    // Check for circular dependencies and remove them
    const circularPairs = detectCircularDependencies(newDepsMap);
    for (const [from, to] of circularPairs) {
      // Remove the AI-added dependency that creates the cycle
      const wasExisting = existingDeps.get(from)?.includes(to);
      if (!wasExisting) {
        newDepsMap.get(from)?.delete(to);
      }
    }

    // Build reasons map from AI analysis
    const aiReasonsMap: Map<string, Record<string, string>> = new Map();
    for (const dep of validDeps) {
      if (dep.reason) {
        if (!aiReasonsMap.has(dep.fromStoryId)) {
          aiReasonsMap.set(dep.fromStoryId, {});
        }
        aiReasonsMap.get(dep.fromStoryId)![dep.toStoryId] = dep.reason;
      }
    }

    // Persist to database
    const now = Date.now();
    for (const [storyId, deps] of newDepsMap) {
      const currentRow = db
        .query('SELECT depends_on, dependency_reasons FROM prd_stories WHERE id = ?')
        .get(storyId) as any;
      const currentDeps = JSON.parse(currentRow?.depends_on || '[]');
      const currentReasons: Record<string, string> = JSON.parse(
        currentRow?.dependency_reasons || '{}',
      );
      const newDeps = Array.from(deps);

      // Merge AI reasons into existing reasons (preserve manual overrides)
      const newReasons = { ...currentReasons };
      const aiReasons = aiReasonsMap.get(storyId) || {};
      for (const [depId, reason] of Object.entries(aiReasons)) {
        // Only set AI reason if no manual reason already exists, or if replacing
        if (!newReasons[depId] || body.replaceAutoDetected) {
          newReasons[depId] = reason;
        }
      }

      // Remove reasons for deps that no longer exist
      for (const key of Object.keys(newReasons)) {
        if (!newDeps.includes(key)) {
          delete newReasons[key];
        }
      }

      // Only update if changed
      const depsChanged = JSON.stringify(currentDeps.sort()) !== JSON.stringify(newDeps.sort());
      const reasonsChanged = JSON.stringify(currentReasons) !== JSON.stringify(newReasons);
      if (depsChanged || reasonsChanged) {
        db.query(
          'UPDATE prd_stories SET depends_on = ?, dependency_reasons = ?, updated_at = ? WHERE id = ?',
        ).run(JSON.stringify(newDeps), JSON.stringify(newReasons), now, storyId);
        // Invalidate priority recommendations when dependencies change
        db.query(
          'UPDATE prd_stories SET priority_recommendation = NULL, updated_at = ? WHERE id = ?',
        ).run(now, storyId);
      }
    }

    db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);

    // Reload stories and build graph
    const updatedStories = db
      .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC')
      .all(prdId) as any[];
    const graph = buildDependencyGraph(updatedStories.map(storyFromRow), prdId);

    const dependencies: StoryDependency[] = validDeps.map((d) => ({
      fromStoryId: d.fromStoryId,
      toStoryId: d.toStoryId,
      type: 'blocked_by' as const,
      reason: d.reason,
      autoDetected: true,
    }));

    return c.json({
      ok: true,
      data: {
        prdId,
        dependencies,
        graph,
      },
    });
  } catch (err) {
    return c.json(
      { ok: false, error: `Dependency analysis failed: ${(err as Error).message}` },
      500,
    );
  }
});

// Validate sprint plan — warn about missing dependencies
app.get('/:id/dependencies/validate', (c) => {
  const db = getDb();
  const prdId = c.req.param('id');

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const stories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(prdId) as any[];

  const validation = validateSprintPlan(stories.map(storyFromRow));
  return c.json({ ok: true, data: validation });
});

export default app;
