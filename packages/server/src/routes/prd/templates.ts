import { Hono } from 'hono';
import { nanoid, getDb, templateFromRow, seedBuiltInTemplates } from './helpers';
import type {
  CreateTemplateRequest,
  CreateStoryFromTemplateRequest,
  CreateStoryFromTemplateResponse,
} from './helpers';

const app = new Hono();

// --- List all templates ---
// NOTE: Template routes MUST be defined before /:id to avoid being caught by the catch-all param route
app.get('/templates', (c) => {
  const db = getDb();
  seedBuiltInTemplates();

  const category = c.req.query('category');
  let rows: any[];
  if (category) {
    rows = db
      .query('SELECT * FROM story_templates WHERE category = ? ORDER BY is_built_in DESC, name ASC')
      .all(category);
  } else {
    rows = db.query('SELECT * FROM story_templates ORDER BY is_built_in DESC, name ASC').all();
  }

  return c.json({ ok: true, data: rows.map(templateFromRow) });
});

// --- Get a single template ---
app.get('/templates/:templateId', (c) => {
  const db = getDb();
  seedBuiltInTemplates();

  const row = db.query('SELECT * FROM story_templates WHERE id = ?').get(c.req.param('templateId'));
  if (!row) {
    return c.json({ ok: false, error: 'Template not found' }, 404);
  }
  return c.json({ ok: true, data: templateFromRow(row) });
});

// --- Create a custom template ---
app.post('/templates', async (c) => {
  const db = getDb();
  const body = (await c.req.json()) as CreateTemplateRequest;

  if (!body.name?.trim()) {
    return c.json({ ok: false, error: 'Template name is required' }, 400);
  }
  if (!body.category) {
    return c.json({ ok: false, error: 'Template category is required' }, 400);
  }

  const id = nanoid(12);
  const now = Date.now();

  db.query(
    `INSERT INTO story_templates (id, name, description, category, title_template, description_template,
     acceptance_criteria_templates, priority, tags, is_built_in, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    id,
    body.name.trim(),
    body.description?.trim() || '',
    body.category,
    body.titleTemplate?.trim() || '',
    body.descriptionTemplate?.trim() || '',
    JSON.stringify(body.acceptanceCriteriaTemplates || []),
    body.priority || 'medium',
    JSON.stringify(body.tags || []),
    now,
    now,
  );

  const row = db.query('SELECT * FROM story_templates WHERE id = ?').get(id);
  return c.json({ ok: true, data: templateFromRow(row) }, 201);
});

// --- Update a custom template ---
app.patch('/templates/:templateId', async (c) => {
  const db = getDb();
  const templateId = c.req.param('templateId');
  const body = await c.req.json();

  const existing = db.query('SELECT * FROM story_templates WHERE id = ?').get(templateId) as any;
  if (!existing) {
    return c.json({ ok: false, error: 'Template not found' }, 404);
  }

  // Don't allow editing built-in templates' core fields, but allow all edits on custom
  const now = Date.now();
  const updates: string[] = [];
  const values: any[] = [];

  if (body.name !== undefined) {
    updates.push('name = ?');
    values.push(body.name.trim());
  }
  if (body.description !== undefined) {
    updates.push('description = ?');
    values.push(body.description.trim());
  }
  if (body.category !== undefined) {
    updates.push('category = ?');
    values.push(body.category);
  }
  if (body.titleTemplate !== undefined) {
    updates.push('title_template = ?');
    values.push(body.titleTemplate.trim());
  }
  if (body.descriptionTemplate !== undefined) {
    updates.push('description_template = ?');
    values.push(body.descriptionTemplate.trim());
  }
  if (body.acceptanceCriteriaTemplates !== undefined) {
    updates.push('acceptance_criteria_templates = ?');
    values.push(JSON.stringify(body.acceptanceCriteriaTemplates));
  }
  if (body.priority !== undefined) {
    updates.push('priority = ?');
    values.push(body.priority);
  }
  if (body.tags !== undefined) {
    updates.push('tags = ?');
    values.push(JSON.stringify(body.tags));
  }

  if (updates.length === 0) {
    return c.json({ ok: true, data: templateFromRow(existing) });
  }

  updates.push('updated_at = ?');
  values.push(now);
  values.push(templateId);

  db.query(`UPDATE story_templates SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const row = db.query('SELECT * FROM story_templates WHERE id = ?').get(templateId);
  return c.json({ ok: true, data: templateFromRow(row) });
});

// --- Delete a custom template ---
app.delete('/templates/:templateId', (c) => {
  const db = getDb();
  const templateId = c.req.param('templateId');

  const existing = db.query('SELECT * FROM story_templates WHERE id = ?').get(templateId) as any;
  if (!existing) {
    return c.json({ ok: false, error: 'Template not found' }, 404);
  }
  if (existing.is_built_in) {
    return c.json({ ok: false, error: 'Cannot delete built-in templates' }, 400);
  }

  db.query('DELETE FROM story_templates WHERE id = ?').run(templateId);
  return c.json({ ok: true });
});

// --- Create story from template ---
app.post('/:id/stories/from-template', async (c) => {
  const db = getDb();
  const prdId = c.req.param('id');
  const body = (await c.req.json()) as CreateStoryFromTemplateRequest;

  // Verify PRD exists
  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) {
    return c.json({ ok: false, error: 'PRD not found' }, 404);
  }

  // Get the template
  seedBuiltInTemplates();
  const tmplRow = db
    .query('SELECT * FROM story_templates WHERE id = ?')
    .get(body.templateId) as any;
  if (!tmplRow) {
    return c.json({ ok: false, error: 'Template not found' }, 404);
  }

  const template = templateFromRow(tmplRow);
  const variables = body.variables || {};

  // Apply variable substitutions to template fields
  function applyVariables(text: string, vars: Record<string, string>): string {
    return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return vars[key] || match; // Keep placeholder if no substitution provided
    });
  }

  const title = applyVariables(template.titleTemplate, variables);
  const description = applyVariables(template.descriptionTemplate, variables);
  const criteria = template.acceptanceCriteriaTemplates.map((ac: string) =>
    applyVariables(ac, variables),
  );

  // Create the story
  const storyId = nanoid(12);
  const now = Date.now();
  const maxSort = db
    .query('SELECT MAX(sort_order) as mx FROM prd_stories WHERE prd_id = ?')
    .get(prdId) as any;
  const sortOrder = (maxSort?.mx ?? -1) + 1;

  const acJson = JSON.stringify(
    criteria.map((desc: string, idx: number) => ({
      id: nanoid(8),
      description: desc,
      passed: false,
    })),
  );

  db.query(
    `INSERT INTO prd_stories (id, prd_id, title, description, acceptance_criteria, priority,
     depends_on, dependency_reasons, status, attempts, max_attempts, learnings, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '[]', '{}', 'pending', 0, 3, '[]', ?, ?, ?)`,
  ).run(storyId, prdId, title, description, acJson, template.priority, sortOrder, now, now);

  return c.json(
    {
      ok: true,
      data: {
        storyId,
        story: {
          title,
          description,
          acceptanceCriteria: criteria,
          priority: template.priority,
        },
      } as CreateStoryFromTemplateResponse,
    },
    201,
  );
});

export default app;
