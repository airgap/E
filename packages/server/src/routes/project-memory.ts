import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';

const app = new Hono();

// List workspace memories for a given workspace path
app.get('/', (c) => {
  const workspacePath = c.req.query('workspacePath');
  if (!workspacePath) return c.json({ ok: false, error: 'workspacePath required' }, 400);

  const db = getDb();
  const category = c.req.query('category');

  let rows: any[];
  if (category) {
    rows = db
      .query(
        `SELECT * FROM workspace_memories WHERE workspace_path = ? AND category = ? ORDER BY times_seen DESC, updated_at DESC`,
      )
      .all(workspacePath, category);
  } else {
    rows = db
      .query(
        `SELECT * FROM workspace_memories WHERE workspace_path = ? ORDER BY times_seen DESC, updated_at DESC`,
      )
      .all(workspacePath);
  }

  return c.json({
    ok: true,
    data: rows.map(toApiShape),
  });
});

// Create a new memory
app.post('/', async (c) => {
  const body = await c.req.json();
  const { workspacePath, category, key, content, source, confidence } = body;

  if (!workspacePath || !key || !content) {
    return c.json({ ok: false, error: 'workspacePath, key, and content are required' }, 400);
  }

  const db = getDb();

  // Check for existing memory with same workspace+key — merge if auto-extracted
  const existing = db
    .query(`SELECT * FROM workspace_memories WHERE workspace_path = ? AND key = ?`)
    .get(workspacePath, key) as any;

  if (existing) {
    // Reinforce existing memory
    db.query(
      `UPDATE workspace_memories SET content = ?, times_seen = times_seen + 1, confidence = MIN(1.0, confidence + 0.1), updated_at = ? WHERE id = ?`,
    ).run(content, Date.now(), existing.id);
    const updated = db.query(`SELECT * FROM workspace_memories WHERE id = ?`).get(existing.id);
    return c.json({ ok: true, data: toApiShape(updated as any) });
  }

  const id = nanoid();
  const now = Date.now();
  db.query(
    `INSERT INTO workspace_memories (id, workspace_path, category, key, content, source, confidence, times_seen, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    id,
    workspacePath,
    category || 'convention',
    key,
    content,
    source || 'manual',
    confidence ?? 1.0,
    now,
    now,
  );

  return c.json({ ok: true, data: { id } }, 201);
});

// Search memories by content or key
app.get('/search/query', (c) => {
  const workspacePath = c.req.query('workspacePath');
  const q = c.req.query('q');
  if (!workspacePath || !q)
    return c.json({ ok: false, error: 'workspacePath and q required' }, 400);

  const db = getDb();
  const rows = db
    .query(
      `SELECT * FROM workspace_memories WHERE workspace_path = ? AND (key LIKE ? OR content LIKE ?) ORDER BY times_seen DESC, confidence DESC LIMIT 50`,
    )
    .all(workspacePath, `%${q}%`, `%${q}%`);

  return c.json({ ok: true, data: rows.map(toApiShape) });
});

// Get memories formatted for system prompt injection
app.get('/context', (c) => {
  const workspacePath = c.req.query('workspacePath');
  if (!workspacePath) return c.json({ ok: false, error: 'workspacePath required' }, 400);

  const db = getDb();
  // Get high-confidence memories, sorted by relevance
  const rows = db
    .query(
      `SELECT * FROM workspace_memories WHERE workspace_path = ? AND confidence >= 0.3 ORDER BY category, times_seen DESC, confidence DESC LIMIT 100`,
    )
    .all(workspacePath) as any[];

  if (rows.length === 0) {
    return c.json({ ok: true, data: { context: '', count: 0 } });
  }

  // Format for system prompt
  const grouped: Record<string, string[]> = {};
  for (const row of rows) {
    if (!grouped[row.category]) grouped[row.category] = [];
    grouped[row.category].push(`- ${row.key}: ${row.content}`);
  }

  const categoryLabels: Record<string, string> = {
    convention: 'Coding Conventions',
    decision: 'Architecture Decisions',
    preference: 'User Preferences',
    pattern: 'Common Patterns',
    context: 'Workspace Context',
    architecture: 'System Architecture',
    naming: 'Naming Conventions',
    forbidden: 'Forbidden / Avoid',
    testing: 'Testing Conventions',
  };

  let context = '## Workspace Memory\n\n';
  for (const [cat, items] of Object.entries(grouped)) {
    context += `### ${categoryLabels[cat] || cat}\n${items.join('\n')}\n\n`;
  }

  return c.json({ ok: true, data: { context: context.trim(), count: rows.length } });
});

// Get a single memory (MUST come after /search/query and /context to avoid /:id catching them)
app.get('/:id', (c) => {
  const db = getDb();
  const row = db.query(`SELECT * FROM workspace_memories WHERE id = ?`).get(c.req.param('id'));
  if (!row) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: toApiShape(row as any) });
});

// Update a memory
app.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const db = getDb();

  const existing = db.query(`SELECT * FROM workspace_memories WHERE id = ?`).get(id) as any;
  if (!existing) return c.json({ ok: false, error: 'Not found' }, 404);

  // Save version before updating
  saveVersion(db, existing);

  const updates: string[] = [];
  const values: any[] = [];

  for (const field of ['category', 'key', 'content', 'confidence'] as const) {
    if (body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(body[field]);
    }
  }

  if (updates.length === 0) return c.json({ ok: false, error: 'No fields to update' }, 400);

  updates.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);

  db.query(`UPDATE workspace_memories SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  return c.json({ ok: true });
});

// Delete a memory
app.delete('/:id', (c) => {
  const db = getDb();
  const result = db.query(`DELETE FROM workspace_memories WHERE id = ?`).run(c.req.param('id'));
  if (result.changes === 0) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true });
});

// LLM-powered extraction from conversation messages
app.post('/extract-llm', async (c) => {
  const body = await c.req.json();
  const { workspacePath, messages } = body;

  if (!workspacePath || !messages || !Array.isArray(messages)) {
    return c.json({ ok: false, error: 'workspacePath and messages[] required' }, 400);
  }

  try {
    const { extractMemoriesFromConversation } = await import('../services/memory-extractor');
    const extracted = await extractMemoriesFromConversation(messages);

    const db = getDb();
    const created: string[] = [];

    for (const mem of extracted) {
      const existing = db
        .query(`SELECT * FROM workspace_memories WHERE workspace_path = ? AND key = ?`)
        .get(workspacePath, mem.key) as any;

      if (existing) {
        // Reinforce existing memory, save old version
        saveVersion(db, existing);
        db.query(
          `UPDATE workspace_memories SET content = ?, confidence = MIN(1.0, confidence + 0.1), times_seen = times_seen + 1, updated_at = ? WHERE id = ?`,
        ).run(mem.content, Date.now(), existing.id);
      } else {
        const id = nanoid();
        const now = Date.now();
        db.query(
          `INSERT INTO workspace_memories (id, workspace_path, category, key, content, source, confidence, times_seen, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'auto', ?, 1, ?, ?)`,
        ).run(id, workspacePath, mem.category, mem.key, mem.content, mem.confidence, now, now);
        created.push(id);
      }
    }

    return c.json({ ok: true, data: { extracted: extracted.length, created: created.length } });
  } catch (err) {
    return c.json(
      {
        ok: false,
        error: `LLM extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      500,
    );
  }
});

// LLM-powered extraction from git commits
app.post('/extract-commits', async (c) => {
  const body = await c.req.json();
  const { workspacePath, commits } = body;

  if (!workspacePath || !commits || !Array.isArray(commits)) {
    return c.json({ ok: false, error: 'workspacePath and commits[] required' }, 400);
  }

  try {
    const { extractMemoriesFromCommits } = await import('../services/memory-extractor');
    const extracted = await extractMemoriesFromCommits(commits);

    const db = getDb();
    const created: string[] = [];

    for (const mem of extracted) {
      const existing = db
        .query(`SELECT * FROM workspace_memories WHERE workspace_path = ? AND key = ?`)
        .get(workspacePath, mem.key) as any;

      if (existing) {
        saveVersion(db, existing);
        db.query(
          `UPDATE workspace_memories SET content = ?, confidence = MIN(1.0, confidence + 0.05), times_seen = times_seen + 1, updated_at = ? WHERE id = ?`,
        ).run(mem.content, Date.now(), existing.id);
      } else {
        const id = nanoid();
        const now = Date.now();
        db.query(
          `INSERT INTO workspace_memories (id, workspace_path, category, key, content, source, confidence, times_seen, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'auto', ?, 1, ?, ?)`,
        ).run(id, workspacePath, mem.category, mem.key, mem.content, mem.confidence, now, now);
        created.push(id);
      }
    }

    return c.json({ ok: true, data: { extracted: extracted.length, created: created.length } });
  } catch (err) {
    return c.json(
      {
        ok: false,
        error: `Commit extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      500,
    );
  }
});

// Get version history for a memory
app.get('/versions/:id', (c) => {
  const memoryId = c.req.param('id');
  const db = getDb();

  ensureVersionsTable(db);

  const rows = db
    .query(
      `SELECT * FROM workspace_memory_versions WHERE memory_id = ? ORDER BY saved_at DESC LIMIT 20`,
    )
    .all(memoryId) as any[];

  return c.json({
    ok: true,
    data: rows.map((r: any) => ({
      id: r.id,
      memoryId: r.memory_id,
      content: r.content,
      confidence: r.confidence,
      category: r.category,
      savedAt: r.saved_at,
    })),
  });
});

// Bulk extract endpoint — receives conversation text and extracts memories
app.post('/extract', async (c) => {
  const body = await c.req.json();
  const { workspacePath, messages } = body;

  if (!workspacePath || !messages || !Array.isArray(messages)) {
    return c.json({ ok: false, error: 'workspacePath and messages[] required' }, 400);
  }

  const extracted = extractMemories(messages);
  const db = getDb();
  const created: string[] = [];

  for (const mem of extracted) {
    // Check if this memory already exists
    const existing = db
      .query(`SELECT * FROM workspace_memories WHERE workspace_path = ? AND key = ?`)
      .get(workspacePath, mem.key) as any;

    if (existing) {
      // Reinforce
      db.query(
        `UPDATE workspace_memories SET times_seen = times_seen + 1, confidence = MIN(1.0, confidence + 0.05), updated_at = ? WHERE id = ?`,
      ).run(Date.now(), existing.id);
    } else {
      const id = nanoid();
      const now = Date.now();
      db.query(
        `INSERT INTO workspace_memories (id, workspace_path, category, key, content, source, confidence, times_seen, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'auto', ?, 1, ?, ?)`,
      ).run(id, workspacePath, mem.category, mem.key, mem.content, mem.confidence, now, now);
      created.push(id);
    }
  }

  return c.json({ ok: true, data: { extracted: extracted.length, created: created.length } });
});

function toApiShape(row: any) {
  return {
    id: row.id,
    workspacePath: row.workspace_path,
    category: row.category,
    key: row.key,
    content: row.content,
    source: row.source,
    confidence: row.confidence,
    timesSeen: row.times_seen,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Simple pattern-based memory extraction from conversation messages
function extractMemories(
  messages: Array<{ role: string; content: string }>,
): Array<{ category: string; key: string; content: string; confidence: number }> {
  const memories: Array<{ category: string; key: string; content: string; confidence: number }> =
    [];
  const fullText = messages.map((m) => m.content).join('\n');

  // Detect coding conventions
  const conventionPatterns = [
    {
      pattern: /(?:always|we|prefer|convention|standard)\s+use\s+(\w+[\w\s]*\w+)/gi,
      category: 'convention',
      confidence: 0.6,
    },
    {
      pattern: /(?:naming convention|naming style)[\s:]+(\w+[\w\s]*\w+)/gi,
      category: 'convention',
      confidence: 0.7,
    },
    {
      pattern: /(?:use|using|prefer)\s+(single|double)\s+quotes/gi,
      category: 'convention',
      confidence: 0.7,
    },
    {
      pattern: /(?:indent|indentation)\s+(?:with|using|is)\s+(\d+\s+spaces?|tabs?)/gi,
      category: 'convention',
      confidence: 0.7,
    },
  ];

  // Detect architecture decisions
  const decisionPatterns = [
    {
      pattern: /(?:decided|chose|we're using|switched to|migrated? to)\s+(\w+[\w\s/.-]*\w+)/gi,
      category: 'decision',
      confidence: 0.6,
    },
    {
      pattern: /(?:architecture|pattern)[\s:]+(\w+[\w\s]*\w+)/gi,
      category: 'decision',
      confidence: 0.5,
    },
  ];

  // Detect preferences
  const preferencePatterns = [
    {
      pattern: /(?:don'?t|never|avoid|do not)\s+(?:use|add|include)\s+(\w+[\w\s]*\w+)/gi,
      category: 'preference',
      confidence: 0.6,
    },
    {
      pattern: /(?:always|make sure to|remember to)\s+(\w+[\w\s]*\w+)/gi,
      category: 'preference',
      confidence: 0.5,
    },
  ];

  const allPatterns = [...conventionPatterns, ...decisionPatterns, ...preferencePatterns];

  for (const { pattern, category, confidence } of allPatterns) {
    let match;
    while ((match = pattern.exec(fullText)) !== null) {
      const value = match[1].trim();
      if (value.length > 3 && value.length < 200) {
        memories.push({
          category,
          key: value.slice(0, 80),
          content: match[0].trim(),
          confidence,
        });
      }
    }
  }

  // Deduplicate by key
  const seen = new Set<string>();
  return memories.filter((m) => {
    const k = m.key.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── Version history helpers ──────────────────────────────────────────────

function ensureVersionsTable(db: ReturnType<typeof getDb>) {
  db.query(
    `CREATE TABLE IF NOT EXISTS workspace_memory_versions (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      content TEXT NOT NULL,
      confidence REAL,
      category TEXT,
      saved_at INTEGER NOT NULL
    )`,
  ).run();
}

function saveVersion(db: ReturnType<typeof getDb>, existing: any) {
  ensureVersionsTable(db);
  const versionId = nanoid();
  db.query(
    `INSERT INTO workspace_memory_versions (id, memory_id, content, confidence, category, saved_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    versionId,
    existing.id,
    existing.content,
    existing.confidence,
    existing.category,
    Date.now(),
  );
}

export { app as workspaceMemoryRoutes };
