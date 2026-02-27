import { describe, test, expect, beforeEach, mock, spyOn } from 'bun:test';
import { Database } from 'bun:sqlite';

// ---------------------------------------------------------------------------
// We test the database schema, migrations, and functions by running them
// against real in-memory SQLite databases. No mocking of the DB itself.
//
// For initDatabase() and getDb(), we set E_DB_PATH=':memory:' so the module
// singleton opens an in-memory DB. For migration functions (which are not
// exported), we replicate the SQL logic against fresh in-memory DBs to
// verify correctness.
// ---------------------------------------------------------------------------

// Force the module to use in-memory database
process.env.E_DB_PATH = ':memory:';

// We need a fresh module load each time to avoid singleton contamination
// from other test files. Use require with cache busting.
function loadDatabaseModule() {
  const absPath = '/home/nicole/maude/packages/server/src/db/database.ts';
  delete require.cache[absPath];
  return require(absPath) as {
    getDb: () => Database;
    initDatabase: () => void;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getTableNames(db: Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as any[];
  return rows.map((r: any) => r.name).sort();
}

function getColumnNames(db: Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  return rows.map((r: any) => r.name);
}

function getColumnInfo(db: Database, table: string): any[] {
  return db.prepare(`PRAGMA table_info(${table})`).all() as any[];
}

function getIndexNames(db: Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA index_list(${table})`).all() as any[];
  return rows.map((r: any) => r.name).sort();
}

function getAllIndexNames(db: Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
    .all() as any[];
  return rows.map((r: any) => r.name).sort();
}

/**
 * Create a minimal "pre-migration" database that simulates what an older
 * database looked like before the nullable-prd_id migration. This lets us
 * test that the migration logic works on legacy schemas.
 */
function createLegacyDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA foreign_keys=ON');

  db.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Conversation',
      model TEXT NOT NULL DEFAULT 'claude-sonnet-4-5-20250929',
      system_prompt TEXT,
      workspace_path TEXT,
      plan_mode INTEGER NOT NULL DEFAULT 0,
      plan_file TEXT,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      token_count INTEGER DEFAULT 0,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      active_form TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      owner TEXT,
      blocks TEXT NOT NULL DEFAULT '[]',
      blocked_by TEXT NOT NULL DEFAULT '[]',
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
    );

    CREATE TABLE prds (
      id TEXT PRIMARY KEY,
      workspace_path TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      branch_name TEXT,
      quality_checks TEXT NOT NULL DEFAULT '[]',
      external_ref TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Old schema with prd_id NOT NULL
    CREATE TABLE prd_stories (
      id TEXT PRIMARY KEY,
      prd_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      acceptance_criteria TEXT NOT NULL DEFAULT '[]',
      priority TEXT NOT NULL DEFAULT 'medium',
      depends_on TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      task_id TEXT,
      agent_id TEXT,
      conversation_id TEXT,
      commit_sha TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      learnings TEXT NOT NULL DEFAULT '[]',
      estimate TEXT,
      dependency_reasons TEXT NOT NULL DEFAULT '{}',
      priority_recommendation TEXT,
      research_only INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      workspace_path TEXT,
      external_ref TEXT,
      external_status TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (prd_id) REFERENCES prds(id) ON DELETE CASCADE
    );

    -- Old schema with prd_id NOT NULL
    CREATE TABLE loops (
      id TEXT PRIMARY KEY,
      prd_id TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      config TEXT NOT NULL DEFAULT '{}',
      current_iteration INTEGER NOT NULL DEFAULT 0,
      current_story_id TEXT,
      current_agent_id TEXT,
      started_at INTEGER NOT NULL,
      paused_at INTEGER,
      completed_at INTEGER,
      total_stories_completed INTEGER NOT NULL DEFAULT 0,
      total_stories_failed INTEGER NOT NULL DEFAULT 0,
      total_iterations INTEGER NOT NULL DEFAULT 0,
      iteration_log TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (prd_id) REFERENCES prds(id) ON DELETE CASCADE
    );

    CREATE INDEX idx_prd_stories_prd ON prd_stories(prd_id);
    CREATE INDEX idx_loops_prd ON loops(prd_id);
    CREATE INDEX idx_loops_status ON loops(status);
  `);

  return db;
}

// ---------------------------------------------------------------------------
// getDb() tests
// ---------------------------------------------------------------------------
describe('getDb()', () => {
  test('returns a Database instance', () => {
    const mod = loadDatabaseModule();
    const db = mod.getDb();
    expect(db).toBeInstanceOf(Database);
  });

  test('returns the same instance on repeated calls (singleton)', () => {
    const mod = loadDatabaseModule();
    const db1 = mod.getDb();
    const db2 = mod.getDb();
    expect(db1).toBe(db2);
  });

  test('the returned database is functional', () => {
    const mod = loadDatabaseModule();
    const db = mod.getDb();
    const row = db.query('SELECT 1 + 1 AS result').get() as any;
    expect(row.result).toBe(2);
  });

  test('foreign keys are enabled', () => {
    const mod = loadDatabaseModule();
    const db = mod.getDb();
    const row = db.query('PRAGMA foreign_keys').get() as any;
    expect(row.foreign_keys).toBe(1);
  });

  test('WAL journal mode is set', () => {
    const mod = loadDatabaseModule();
    const db = mod.getDb();
    const row = db.query('PRAGMA journal_mode').get() as any;
    // In-memory databases may report 'memory' or 'wal'
    expect(['wal', 'memory']).toContain(row.journal_mode);
  });
});

// ---------------------------------------------------------------------------
// initDatabase() — table creation
// ---------------------------------------------------------------------------
describe('initDatabase() — tables', () => {
  let db: Database;
  let mod: ReturnType<typeof loadDatabaseModule>;

  beforeEach(() => {
    mod = loadDatabaseModule();
    mod.initDatabase();
    db = mod.getDb();
  });

  const expectedTables = [
    'conversations',
    'messages',
    'tasks',
    'settings',
    'mcp_servers',
    'workspaces',
    'git_snapshots',
    'workspace_memories',
    'prds',
    'prd_stories',
    'loops',
    'story_templates',
    'users',
    'rules_metadata',
    'agent_profiles',
    'artifacts',
    'agent_notes',
    'commentary_history',
    'scheduled_tasks',
    'scheduled_task_executions',
    'webhooks',
    'webhook_executions',
    'cross_session_messages',
    'installed_skills',
  ];

  test('creates all expected tables', () => {
    const tables = getTableNames(db);
    for (const t of expectedTables) {
      expect(tables).toContain(t);
    }
  });

  // Individual table existence tests for clarity
  for (const table of expectedTables) {
    test(`creates the ${table} table`, () => {
      expect(getTableNames(db)).toContain(table);
    });
  }
});

// ---------------------------------------------------------------------------
// initDatabase() — column schemas
// ---------------------------------------------------------------------------
describe('initDatabase() — column schemas', () => {
  let db: Database;

  beforeEach(() => {
    const mod = loadDatabaseModule();
    mod.initDatabase();
    db = mod.getDb();
  });

  test('conversations has all base and migration columns', () => {
    const cols = getColumnNames(db, 'conversations');
    const expected = [
      'id',
      'title',
      'model',
      'system_prompt',
      'workspace_path',
      'plan_mode',
      'plan_file',
      'total_tokens',
      'created_at',
      'updated_at',
      // Migration columns
      'permission_mode',
      'effort',
      'max_budget_usd',
      'max_turns',
      'allowed_tools',
      'disallowed_tools',
      'cli_session_id',
      'compact_summary',
      'workspace_id',
      'user_id',
      'profile_id',
    ];
    for (const col of expected) {
      expect(cols).toContain(col);
    }
  });

  test('conversations.title defaults to "New Conversation"', () => {
    const info = getColumnInfo(db, 'conversations');
    const titleCol = info.find((c: any) => c.name === 'title');
    expect(titleCol.dflt_value).toBe("'New Conversation'");
  });

  test('conversations.plan_mode defaults to 0', () => {
    const info = getColumnInfo(db, 'conversations');
    const col = info.find((c: any) => c.name === 'plan_mode');
    expect(col.dflt_value).toBe('0');
  });

  test('messages has all expected columns', () => {
    const cols = getColumnNames(db, 'messages');
    const expected = [
      'id',
      'conversation_id',
      'role',
      'content',
      'model',
      'token_count',
      'timestamp',
    ];
    for (const col of expected) {
      expect(cols).toContain(col);
    }
  });

  test('tasks has all expected columns', () => {
    const cols = getColumnNames(db, 'tasks');
    const expected = [
      'id',
      'conversation_id',
      'subject',
      'description',
      'active_form',
      'status',
      'owner',
      'blocks',
      'blocked_by',
      'metadata',
      'created_at',
      'updated_at',
    ];
    for (const col of expected) {
      expect(cols).toContain(col);
    }
  });

  test('settings has key and value columns', () => {
    const cols = getColumnNames(db, 'settings');
    expect(cols).toContain('key');
    expect(cols).toContain('value');
    expect(cols).toHaveLength(2);
  });

  test('mcp_servers has all expected columns', () => {
    const cols = getColumnNames(db, 'mcp_servers');
    for (const col of ['name', 'transport', 'command', 'args', 'url', 'env', 'scope', 'status']) {
      expect(cols).toContain(col);
    }
  });

  test('workspaces has all expected columns', () => {
    const cols = getColumnNames(db, 'workspaces');
    for (const col of ['id', 'name', 'path', 'last_opened', 'settings', 'created_at']) {
      expect(cols).toContain(col);
    }
  });

  test('workspaces.path has UNIQUE constraint', () => {
    const now = Date.now();
    db.query(
      `INSERT INTO workspaces (id, name, path, last_opened, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('ws-1', 'First', '/unique/path', now, now);

    expect(() =>
      db
        .query(
          `INSERT INTO workspaces (id, name, path, last_opened, created_at) VALUES (?, ?, ?, ?, ?)`,
        )
        .run('ws-2', 'Second', '/unique/path', now, now),
    ).toThrow();
  });

  test('git_snapshots has all expected columns including message_id migration', () => {
    const cols = getColumnNames(db, 'git_snapshots');
    for (const col of [
      'id',
      'workspace_path',
      'conversation_id',
      'head_sha',
      'stash_sha',
      'reason',
      'has_changes',
      'created_at',
      'message_id',
    ]) {
      expect(cols).toContain(col);
    }
  });

  test('workspace_memories has all expected columns', () => {
    const cols = getColumnNames(db, 'workspace_memories');
    for (const col of [
      'id',
      'workspace_path',
      'category',
      'key',
      'content',
      'source',
      'confidence',
      'times_seen',
      'created_at',
      'updated_at',
    ]) {
      expect(cols).toContain(col);
    }
  });

  test('prds has all expected columns including external_ref', () => {
    const cols = getColumnNames(db, 'prds');
    for (const col of [
      'id',
      'workspace_path',
      'name',
      'description',
      'branch_name',
      'quality_checks',
      'external_ref',
      'created_at',
      'updated_at',
    ]) {
      expect(cols).toContain(col);
    }
  });

  test('prd_stories has all expected columns including migration columns', () => {
    const cols = getColumnNames(db, 'prd_stories');
    for (const col of [
      'id',
      'prd_id',
      'title',
      'description',
      'acceptance_criteria',
      'priority',
      'depends_on',
      'status',
      'task_id',
      'agent_id',
      'conversation_id',
      'commit_sha',
      'attempts',
      'max_attempts',
      'learnings',
      'estimate',
      'dependency_reasons',
      'priority_recommendation',
      'research_only',
      'sort_order',
      'workspace_path',
      'external_ref',
      'external_status',
      'created_at',
      'updated_at',
    ]) {
      expect(cols).toContain(col);
    }
  });

  test('prd_stories.prd_id is nullable (not NOT NULL)', () => {
    const info = getColumnInfo(db, 'prd_stories');
    const prdIdCol = info.find((c: any) => c.name === 'prd_id');
    expect(prdIdCol.notnull).toBe(0);
  });

  test('loops has all expected columns', () => {
    const cols = getColumnNames(db, 'loops');
    for (const col of [
      'id',
      'prd_id',
      'workspace_path',
      'status',
      'config',
      'current_iteration',
      'current_story_id',
      'current_agent_id',
      'started_at',
      'paused_at',
      'completed_at',
      'total_stories_completed',
      'total_stories_failed',
      'total_iterations',
      'iteration_log',
    ]) {
      expect(cols).toContain(col);
    }
  });

  test('story_templates has all expected columns', () => {
    const cols = getColumnNames(db, 'story_templates');
    for (const col of [
      'id',
      'name',
      'description',
      'category',
      'title_template',
      'description_template',
      'acceptance_criteria_templates',
      'priority',
      'tags',
      'is_built_in',
      'created_at',
      'updated_at',
    ]) {
      expect(cols).toContain(col);
    }
  });

  test('users has all expected columns', () => {
    const cols = getColumnNames(db, 'users');
    for (const col of [
      'id',
      'username',
      'password_hash',
      'display_name',
      'is_admin',
      'created_at',
    ]) {
      expect(cols).toContain(col);
    }
  });

  test('rules_metadata has all expected columns', () => {
    const cols = getColumnNames(db, 'rules_metadata');
    for (const col of ['id', 'workspace_path', 'file_path', 'mode', 'created_at', 'updated_at']) {
      expect(cols).toContain(col);
    }
  });

  test('agent_profiles has all expected columns', () => {
    const cols = getColumnNames(db, 'agent_profiles');
    for (const col of [
      'id',
      'name',
      'description',
      'permission_mode',
      'allowed_tools',
      'disallowed_tools',
      'system_prompt',
      'created_at',
      'updated_at',
    ]) {
      expect(cols).toContain(col);
    }
  });

  test('artifacts has all expected columns', () => {
    const cols = getColumnNames(db, 'artifacts');
    for (const col of [
      'id',
      'conversation_id',
      'message_id',
      'type',
      'title',
      'content',
      'metadata',
      'pinned',
      'created_at',
      'updated_at',
    ]) {
      expect(cols).toContain(col);
    }
  });

  test('agent_notes has all expected columns', () => {
    const cols = getColumnNames(db, 'agent_notes');
    for (const col of [
      'id',
      'workspace_path',
      'conversation_id',
      'story_id',
      'title',
      'content',
      'category',
      'status',
      'metadata',
      'created_at',
      'updated_at',
    ]) {
      expect(cols).toContain(col);
    }
  });

  test('commentary_history has all expected columns', () => {
    const cols = getColumnNames(db, 'commentary_history');
    for (const col of [
      'id',
      'workspace_id',
      'conversation_id',
      'text',
      'personality',
      'timestamp',
      'created_at',
    ]) {
      expect(cols).toContain(col);
    }
  });

  test('scheduled_tasks has all expected columns', () => {
    const cols = getColumnNames(db, 'scheduled_tasks');
    for (const col of [
      'id',
      'workspace_id',
      'name',
      'description',
      'cron_expression',
      'interval_minutes',
      'prompt',
      'profile_id',
      'status',
      'retry_on_failure',
      'max_retries',
      'last_run',
      'next_run',
      'created_at',
      'updated_at',
    ]) {
      expect(cols).toContain(col);
    }
  });

  test('webhooks has all expected columns', () => {
    const cols = getColumnNames(db, 'webhooks');
    for (const col of [
      'id',
      'workspace_id',
      'name',
      'description',
      'auth_method',
      'secret',
      'prompt_template',
      'profile_id',
      'status',
      'max_per_minute',
      'created_at',
      'updated_at',
    ]) {
      expect(cols).toContain(col);
    }
  });

  test('cross_session_messages has all expected columns', () => {
    const cols = getColumnNames(db, 'cross_session_messages');
    for (const col of [
      'id',
      'from_conversation_id',
      'to_conversation_id',
      'content',
      'sender_workspace_id',
      'sender_workspace_name',
      'sender_conversation_title',
      'sender_agent_profile',
      'timestamp',
      'delivered',
      'delivered_at',
      'created_at',
    ]) {
      expect(cols).toContain(col);
    }
  });

  test('installed_skills has all expected columns', () => {
    const cols = getColumnNames(db, 'installed_skills');
    for (const col of [
      'id',
      'skill_id',
      'tier',
      'version',
      'pinned_version',
      'installed_path',
      'workspace_path',
      'config',
      'activated',
      'installed_at',
      'updated_at',
    ]) {
      expect(cols).toContain(col);
    }
  });
});

// ---------------------------------------------------------------------------
// initDatabase() — indexes
// ---------------------------------------------------------------------------
describe('initDatabase() — indexes', () => {
  let db: Database;

  beforeEach(() => {
    const mod = loadDatabaseModule();
    mod.initDatabase();
    db = mod.getDb();
  });

  test('messages has conversation+timestamp index', () => {
    const indexes = getIndexNames(db, 'messages');
    expect(indexes).toContain('idx_messages_conversation');
  });

  test('tasks has conversation and status indexes', () => {
    const indexes = getIndexNames(db, 'tasks');
    expect(indexes).toContain('idx_tasks_conversation');
    expect(indexes).toContain('idx_tasks_status');
  });

  test('workspaces has last_opened index', () => {
    const indexes = getIndexNames(db, 'workspaces');
    expect(indexes).toContain('idx_workspaces_last_opened');
  });

  test('git_snapshots has path index', () => {
    const indexes = getIndexNames(db, 'git_snapshots');
    expect(indexes).toContain('idx_git_snapshots_path');
  });

  test('workspace_memories has path and category indexes', () => {
    const indexes = getIndexNames(db, 'workspace_memories');
    expect(indexes).toContain('idx_workspace_memories_path');
    expect(indexes).toContain('idx_workspace_memories_category');
  });

  test('prds has workspace_path index', () => {
    const indexes = getIndexNames(db, 'prds');
    expect(indexes).toContain('idx_prds_workspace_path');
  });

  test('prd_stories has prd and workspace indexes', () => {
    const indexes = getIndexNames(db, 'prd_stories');
    expect(indexes).toContain('idx_prd_stories_prd');
    expect(indexes).toContain('idx_prd_stories_workspace');
  });

  test('loops has prd and status indexes', () => {
    const indexes = getIndexNames(db, 'loops');
    expect(indexes).toContain('idx_loops_prd');
    expect(indexes).toContain('idx_loops_status');
  });

  test('story_templates has category index', () => {
    const indexes = getIndexNames(db, 'story_templates');
    expect(indexes).toContain('idx_story_templates_category');
  });

  test('rules_metadata has unique path index and mode index', () => {
    const indexes = getIndexNames(db, 'rules_metadata');
    expect(indexes).toContain('idx_rules_metadata_path');
    expect(indexes).toContain('idx_rules_metadata_mode');
  });

  test('agent_profiles has name index', () => {
    const indexes = getIndexNames(db, 'agent_profiles');
    expect(indexes).toContain('idx_agent_profiles_name');
  });

  test('artifacts has conversation and pinned indexes', () => {
    const indexes = getIndexNames(db, 'artifacts');
    expect(indexes).toContain('idx_artifacts_conversation');
    expect(indexes).toContain('idx_artifacts_pinned');
  });

  test('agent_notes has workspace, status, and story indexes', () => {
    const indexes = getIndexNames(db, 'agent_notes');
    expect(indexes).toContain('idx_agent_notes_workspace');
    expect(indexes).toContain('idx_agent_notes_status');
    expect(indexes).toContain('idx_agent_notes_story');
  });

  test('commentary_history has workspace, conversation, and timestamp indexes', () => {
    const indexes = getIndexNames(db, 'commentary_history');
    expect(indexes).toContain('idx_commentary_workspace');
    expect(indexes).toContain('idx_commentary_conversation');
    expect(indexes).toContain('idx_commentary_timestamp');
  });

  test('scheduled_tasks has workspace, status, and next_run indexes', () => {
    const indexes = getIndexNames(db, 'scheduled_tasks');
    expect(indexes).toContain('idx_scheduled_tasks_workspace');
    expect(indexes).toContain('idx_scheduled_tasks_status');
    expect(indexes).toContain('idx_scheduled_tasks_next_run');
  });

  test('scheduled_task_executions has task index', () => {
    const indexes = getIndexNames(db, 'scheduled_task_executions');
    expect(indexes).toContain('idx_scheduled_task_executions_task');
  });

  test('webhooks has workspace and status indexes', () => {
    const indexes = getIndexNames(db, 'webhooks');
    expect(indexes).toContain('idx_webhooks_workspace');
    expect(indexes).toContain('idx_webhooks_status');
  });

  test('webhook_executions has webhook and started indexes', () => {
    const indexes = getIndexNames(db, 'webhook_executions');
    expect(indexes).toContain('idx_webhook_executions_webhook');
    expect(indexes).toContain('idx_webhook_executions_started');
  });

  test('cross_session_messages has to_conv, from_conv, and timestamp indexes', () => {
    const indexes = getIndexNames(db, 'cross_session_messages');
    expect(indexes).toContain('idx_cross_session_to_conv');
    expect(indexes).toContain('idx_cross_session_from_conv');
    expect(indexes).toContain('idx_cross_session_timestamp');
  });

  test('installed_skills has skill_id and workspace indexes', () => {
    const indexes = getIndexNames(db, 'installed_skills');
    expect(indexes).toContain('idx_installed_skills_skill_id');
    expect(indexes).toContain('idx_installed_skills_workspace');
  });
});

// ---------------------------------------------------------------------------
// initDatabase() — idempotency
// ---------------------------------------------------------------------------
describe('initDatabase() — idempotency', () => {
  test('calling initDatabase does not throw', () => {
    const mod = loadDatabaseModule();
    expect(() => mod.initDatabase()).not.toThrow();
  });

  test('calling initDatabase twice does not throw', () => {
    const mod = loadDatabaseModule();
    mod.initDatabase();
    expect(() => mod.initDatabase()).not.toThrow();
  });

  test('calling initDatabase three times does not throw', () => {
    const mod = loadDatabaseModule();
    mod.initDatabase();
    mod.initDatabase();
    expect(() => mod.initDatabase()).not.toThrow();
  });

  test('tables still exist after double init', () => {
    const mod = loadDatabaseModule();
    mod.initDatabase();
    mod.initDatabase();
    const db = mod.getDb();
    const tables = getTableNames(db);
    expect(tables).toContain('conversations');
    expect(tables).toContain('messages');
    expect(tables).toContain('settings');
    expect(tables).toContain('prd_stories');
    expect(tables).toContain('installed_skills');
  });

  test('data persists across double init', () => {
    const mod = loadDatabaseModule();
    mod.initDatabase();
    const db = mod.getDb();

    const now = Date.now();
    db.query('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      'idempotent-test',
      'hello',
    );

    mod.initDatabase();

    const row = db.query('SELECT value FROM settings WHERE key = ?').get('idempotent-test') as any;
    expect(row.value).toBe('hello');
  });

  test('indexes still exist after double init', () => {
    const mod = loadDatabaseModule();
    mod.initDatabase();
    mod.initDatabase();
    const db = mod.getDb();

    const allIndexes = getAllIndexNames(db);
    expect(allIndexes).toContain('idx_messages_conversation');
    expect(allIndexes).toContain('idx_prd_stories_prd');
    expect(allIndexes).toContain('idx_loops_status');
  });
});

// ---------------------------------------------------------------------------
// migrateNullablePrdId — tested by simulating a legacy schema
// ---------------------------------------------------------------------------
describe('migrateNullablePrdId', () => {
  test('prd_stories.prd_id becomes nullable after migration', () => {
    const db = createLegacyDb();

    // Verify it starts as NOT NULL
    const before = getColumnInfo(db, 'prd_stories');
    const prdIdBefore = before.find((c: any) => c.name === 'prd_id');
    expect(prdIdBefore.notnull).toBe(1);

    // Run the migration logic (replicated from database.ts since it's not exported)
    const storyInfo = db.prepare('PRAGMA table_info(prd_stories)').all() as any[];
    const prdIdCol = storyInfo.find((c: any) => c.name === 'prd_id');

    if (prdIdCol && prdIdCol.notnull === 1) {
      db.exec('PRAGMA foreign_keys=OFF');
      db.exec('BEGIN TRANSACTION');
      db.exec(`
        CREATE TABLE prd_stories_new (
          id TEXT PRIMARY KEY,
          prd_id TEXT,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          acceptance_criteria TEXT NOT NULL DEFAULT '[]',
          priority TEXT NOT NULL DEFAULT 'medium',
          depends_on TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'pending',
          task_id TEXT,
          agent_id TEXT,
          conversation_id TEXT,
          commit_sha TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 3,
          learnings TEXT NOT NULL DEFAULT '[]',
          estimate TEXT,
          dependency_reasons TEXT NOT NULL DEFAULT '{}',
          priority_recommendation TEXT,
          research_only INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0,
          workspace_path TEXT,
          external_ref TEXT,
          external_status TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (prd_id) REFERENCES prds(id) ON DELETE CASCADE
        );

        INSERT INTO prd_stories_new (
          id, prd_id, title, description, acceptance_criteria, priority,
          depends_on, status, task_id, agent_id, conversation_id, commit_sha,
          attempts, max_attempts, learnings, estimate, dependency_reasons,
          priority_recommendation, research_only, sort_order, workspace_path,
          external_ref, external_status, created_at, updated_at
        )
        SELECT
          id, prd_id, title, description, acceptance_criteria, priority,
          depends_on, status, task_id, agent_id, conversation_id, commit_sha,
          attempts, max_attempts, learnings, estimate, dependency_reasons,
          priority_recommendation, COALESCE(research_only, 0), sort_order,
          workspace_path, external_ref, external_status, created_at, updated_at
        FROM prd_stories;

        DROP TABLE prd_stories;
        ALTER TABLE prd_stories_new RENAME TO prd_stories;
        CREATE INDEX IF NOT EXISTS idx_prd_stories_prd ON prd_stories(prd_id);
      `);
      db.exec('COMMIT');
      db.exec('PRAGMA foreign_keys=ON');
    }

    // Verify it's now nullable
    const after = getColumnInfo(db, 'prd_stories');
    const prdIdAfter = after.find((c: any) => c.name === 'prd_id');
    expect(prdIdAfter.notnull).toBe(0);
  });

  test('migration preserves existing data in prd_stories', () => {
    const db = createLegacyDb();
    const now = Date.now();

    // Insert a PRD and story
    db.query(
      `INSERT INTO prds (id, workspace_path, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('prd-1', '/ws', 'Test PRD', now, now);
    db.query(
      `INSERT INTO prd_stories (id, prd_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('story-1', 'prd-1', 'My Story', now, now);

    // Run migration
    db.exec('PRAGMA foreign_keys=OFF');
    db.exec('BEGIN TRANSACTION');
    db.exec(`
      CREATE TABLE prd_stories_new (
        id TEXT PRIMARY KEY,
        prd_id TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        acceptance_criteria TEXT NOT NULL DEFAULT '[]',
        priority TEXT NOT NULL DEFAULT 'medium',
        depends_on TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending',
        task_id TEXT,
        agent_id TEXT,
        conversation_id TEXT,
        commit_sha TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        learnings TEXT NOT NULL DEFAULT '[]',
        estimate TEXT,
        dependency_reasons TEXT NOT NULL DEFAULT '{}',
        priority_recommendation TEXT,
        research_only INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        workspace_path TEXT,
        external_ref TEXT,
        external_status TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (prd_id) REFERENCES prds(id) ON DELETE CASCADE
      );
      INSERT INTO prd_stories_new (
        id, prd_id, title, description, acceptance_criteria, priority,
        depends_on, status, task_id, agent_id, conversation_id, commit_sha,
        attempts, max_attempts, learnings, estimate, dependency_reasons,
        priority_recommendation, research_only, sort_order, workspace_path,
        external_ref, external_status, created_at, updated_at
      )
      SELECT
        id, prd_id, title, description, acceptance_criteria, priority,
        depends_on, status, task_id, agent_id, conversation_id, commit_sha,
        attempts, max_attempts, learnings, estimate, dependency_reasons,
        priority_recommendation, COALESCE(research_only, 0), sort_order,
        workspace_path, external_ref, external_status, created_at, updated_at
      FROM prd_stories;
      DROP TABLE prd_stories;
      ALTER TABLE prd_stories_new RENAME TO prd_stories;
    `);
    db.exec('COMMIT');
    db.exec('PRAGMA foreign_keys=ON');

    // Verify data survived
    const story = db.query('SELECT * FROM prd_stories WHERE id = ?').get('story-1') as any;
    expect(story).toBeDefined();
    expect(story.title).toBe('My Story');
    expect(story.prd_id).toBe('prd-1');
  });

  test('loops.prd_id becomes nullable after migration', () => {
    const db = createLegacyDb();

    // Verify it starts as NOT NULL
    const before = getColumnInfo(db, 'loops');
    const prdIdBefore = before.find((c: any) => c.name === 'prd_id');
    expect(prdIdBefore.notnull).toBe(1);

    // Run loops migration
    db.exec('PRAGMA foreign_keys=OFF');
    db.exec('BEGIN TRANSACTION');
    db.exec(`
      CREATE TABLE loops_new (
        id TEXT PRIMARY KEY,
        prd_id TEXT,
        workspace_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        config TEXT NOT NULL DEFAULT '{}',
        current_iteration INTEGER NOT NULL DEFAULT 0,
        current_story_id TEXT,
        current_agent_id TEXT,
        started_at INTEGER NOT NULL,
        paused_at INTEGER,
        completed_at INTEGER,
        total_stories_completed INTEGER NOT NULL DEFAULT 0,
        total_stories_failed INTEGER NOT NULL DEFAULT 0,
        total_iterations INTEGER NOT NULL DEFAULT 0,
        iteration_log TEXT NOT NULL DEFAULT '[]',
        FOREIGN KEY (prd_id) REFERENCES prds(id) ON DELETE CASCADE
      );
      INSERT INTO loops_new SELECT * FROM loops;
      DROP TABLE loops;
      ALTER TABLE loops_new RENAME TO loops;
    `);
    db.exec('COMMIT');
    db.exec('PRAGMA foreign_keys=ON');

    // Verify nullable
    const after = getColumnInfo(db, 'loops');
    const prdIdAfter = after.find((c: any) => c.name === 'prd_id');
    expect(prdIdAfter.notnull).toBe(0);
  });

  test('migration is skipped if prd_id is already nullable', () => {
    // Create a DB where prd_stories.prd_id is already nullable
    const db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys=ON');
    db.exec(`
      CREATE TABLE prds (
        id TEXT PRIMARY KEY,
        workspace_path TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE prd_stories (
        id TEXT PRIMARY KEY,
        prd_id TEXT,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (prd_id) REFERENCES prds(id) ON DELETE CASCADE
      );
    `);

    // The check logic from migrateNullablePrdId
    const storyInfo = db.prepare('PRAGMA table_info(prd_stories)').all() as any[];
    const prdIdCol = storyInfo.find((c: any) => c.name === 'prd_id');

    // Should NOT trigger migration since it's already nullable
    expect(prdIdCol.notnull).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// migrateTasksToStories — tested by simulating the migration
// ---------------------------------------------------------------------------
describe('migrateTasksToStories', () => {
  test('migrates tasks to prd_stories with correct field mapping', () => {
    const db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys=ON');

    // Set up minimal schema
    db.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        conversation_id TEXT,
        subject TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        active_form TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        owner TEXT,
        blocks TEXT NOT NULL DEFAULT '[]',
        blocked_by TEXT NOT NULL DEFAULT '[]',
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE prds (
        id TEXT PRIMARY KEY,
        workspace_path TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE prd_stories (
        id TEXT PRIMARY KEY,
        prd_id TEXT,
        workspace_path TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        acceptance_criteria TEXT NOT NULL DEFAULT '[]',
        priority TEXT NOT NULL DEFAULT 'medium',
        depends_on TEXT NOT NULL DEFAULT '[]',
        dependency_reasons TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        task_id TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        learnings TEXT NOT NULL DEFAULT '[]',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (prd_id) REFERENCES prds(id) ON DELETE CASCADE
      );
    `);

    const now = Date.now();
    // Insert tasks to migrate
    db.query(
      `INSERT INTO tasks (id, subject, description, status, blocked_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('task-1', 'Fix bug', 'Fix the login bug', 'completed', '["task-0"]', now, now);
    db.query(
      `INSERT INTO tasks (id, subject, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('task-2', 'Add feature', 'Add dark mode', 'in_progress', now, now);
    db.query(
      `INSERT INTO tasks (id, subject, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('task-3', 'Deleted task', 'Should not migrate', 'deleted', now, now);

    // Run migration logic (replicated from migrateTasksToStories)
    const marker = db
      .query("SELECT value FROM settings WHERE key = 'tasks_migrated_to_stories'")
      .get() as any;

    if (!marker) {
      const tasks = db.query("SELECT * FROM tasks WHERE status != 'deleted'").all() as any[];

      const statusMap: Record<string, string> = {
        pending: 'pending',
        in_progress: 'in_progress',
        completed: 'completed',
      };

      for (const task of tasks) {
        const storyId = `story-for-${task.id}`;
        const status = statusMap[task.status] || 'pending';

        db.query(
          `INSERT INTO prd_stories (
            id, prd_id, workspace_path, title, description, acceptance_criteria,
            priority, depends_on, dependency_reasons, status, task_id,
            attempts, max_attempts, learnings, sort_order, created_at, updated_at
          )
          VALUES (?, NULL, NULL, ?, ?, '[]', 'medium', ?, '{}', ?, ?, 0, 3, '[]', 0, ?, ?)`,
        ).run(
          storyId,
          task.subject,
          task.description || '',
          task.blocked_by || '[]',
          status,
          task.id,
          task.created_at,
          task.updated_at || Date.now(),
        );
      }

      db.query(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('tasks_migrated_to_stories', '1')",
      ).run();
    }

    // Verify stories were created
    const stories = db.query('SELECT * FROM prd_stories ORDER BY task_id').all() as any[];
    expect(stories).toHaveLength(2); // task-3 (deleted) should not be migrated

    const story1 = stories.find((s: any) => s.task_id === 'task-1');
    expect(story1).toBeDefined();
    expect(story1.title).toBe('Fix bug');
    expect(story1.description).toBe('Fix the login bug');
    expect(story1.status).toBe('completed');
    expect(story1.prd_id).toBeNull();
    expect(story1.depends_on).toBe('["task-0"]');

    const story2 = stories.find((s: any) => s.task_id === 'task-2');
    expect(story2).toBeDefined();
    expect(story2.title).toBe('Add feature');
    expect(story2.status).toBe('in_progress');
  });

  test('migration only runs once (gated by settings key)', () => {
    const db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys=ON');

    db.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        blocked_by TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE prds (
        id TEXT PRIMARY KEY,
        workspace_path TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE prd_stories (
        id TEXT PRIMARY KEY,
        prd_id TEXT,
        workspace_path TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        acceptance_criteria TEXT NOT NULL DEFAULT '[]',
        priority TEXT NOT NULL DEFAULT 'medium',
        depends_on TEXT NOT NULL DEFAULT '[]',
        dependency_reasons TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        task_id TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        learnings TEXT NOT NULL DEFAULT '[]',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (prd_id) REFERENCES prds(id) ON DELETE CASCADE
      );
    `);

    // Pre-set the migration marker
    db.query("INSERT INTO settings (key, value) VALUES ('tasks_migrated_to_stories', '1')").run();

    // Insert a task
    const now = Date.now();
    db.query(
      `INSERT INTO tasks (id, subject, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('task-skip', 'Should be skipped', 'Not migrated', 'pending', now, now);

    // Run migration — should be a no-op because marker exists
    const marker = db
      .query("SELECT value FROM settings WHERE key = 'tasks_migrated_to_stories'")
      .get() as any;
    if (!marker) {
      // This block should NOT execute
      const tasks = db.query("SELECT * FROM tasks WHERE status != 'deleted'").all() as any[];
      for (const task of tasks) {
        db.query(
          `INSERT INTO prd_stories (id, prd_id, title, description, status, task_id, created_at, updated_at)
           VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
        ).run(`story-${task.id}`, task.subject, task.description, task.status, task.id, now, now);
      }
    }

    const stories = db.query('SELECT * FROM prd_stories').all() as any[];
    expect(stories).toHaveLength(0);
  });

  test('unknown task status maps to pending', () => {
    const statusMap: Record<string, string> = {
      pending: 'pending',
      in_progress: 'in_progress',
      completed: 'completed',
    };

    expect(statusMap['pending']).toBe('pending');
    expect(statusMap['in_progress']).toBe('in_progress');
    expect(statusMap['completed']).toBe('completed');
    expect(statusMap['some_weird_status'] || 'pending').toBe('pending');
    expect(statusMap['blocked'] || 'pending').toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// Data operations on the real schema
// ---------------------------------------------------------------------------
describe('initDatabase() — data operations', () => {
  let db: Database;

  beforeEach(() => {
    const mod = loadDatabaseModule();
    mod.initDatabase();
    db = mod.getDb();
  });

  test('can insert and query a conversation', () => {
    const now = Date.now();
    db.query(
      `INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('test-conv-1', 'Test', 'claude-sonnet-4-5-20250929', now, now);

    const row = db.query('SELECT * FROM conversations WHERE id = ?').get('test-conv-1') as any;
    expect(row).toBeDefined();
    expect(row.title).toBe('Test');
    expect(row.model).toBe('claude-sonnet-4-5-20250929');
  });

  test('conversation has correct default values', () => {
    const now = Date.now();
    db.query(`INSERT INTO conversations (id, created_at, updated_at) VALUES (?, ?, ?)`).run(
      'test-conv-defaults',
      now,
      now,
    );

    const row = db
      .query('SELECT * FROM conversations WHERE id = ?')
      .get('test-conv-defaults') as any;
    expect(row.title).toBe('New Conversation');
    expect(row.model).toBe('claude-sonnet-4-6');
    expect(row.plan_mode).toBe(0);
    expect(row.total_tokens).toBe(0);
  });

  test('can insert and query messages with foreign key', () => {
    const now = Date.now();
    db.query(
      `INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('test-conv-fk', 'FK Test', 'model', now, now);

    db.query(
      `INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)`,
    ).run('test-msg-1', 'test-conv-fk', 'user', 'Hello', now);

    const msgs = db
      .query('SELECT * FROM messages WHERE conversation_id = ?')
      .all('test-conv-fk') as any[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('Hello');
    expect(msgs[0].role).toBe('user');
  });

  test('foreign key constraint blocks orphan messages', () => {
    expect(() =>
      db
        .query(
          `INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)`,
        )
        .run('orphan-msg', 'nonexistent', 'user', 'Hello', Date.now()),
    ).toThrow();
  });

  test('CASCADE delete removes messages when conversation is deleted', () => {
    const now = Date.now();
    db.query(
      `INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('test-conv-del', 'Del Test', 'model', now, now);
    db.query(
      `INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)`,
    ).run('del-msg-1', 'test-conv-del', 'user', 'Hello', now);

    db.query('DELETE FROM conversations WHERE id = ?').run('test-conv-del');

    const msgs = db
      .query('SELECT * FROM messages WHERE conversation_id = ?')
      .all('test-conv-del') as any[];
    expect(msgs).toHaveLength(0);
  });

  test('CASCADE delete removes prd_stories when prd is deleted', () => {
    const now = Date.now();
    db.query(
      `INSERT INTO prds (id, workspace_path, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('prd-cascade', '/proj', 'Test PRD', now, now);
    db.query(
      `INSERT INTO prd_stories (id, prd_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('story-cascade', 'prd-cascade', 'Story 1', now, now);

    db.query('DELETE FROM prds WHERE id = ?').run('prd-cascade');

    const stories = db
      .query("SELECT * FROM prd_stories WHERE prd_id = 'prd-cascade'")
      .all() as any[];
    expect(stories).toHaveLength(0);
  });

  test('CASCADE delete removes artifacts when conversation is deleted', () => {
    const now = Date.now();
    db.query(
      `INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('conv-art', 'Art Test', 'model', now, now);
    db.query(
      `INSERT INTO artifacts (id, conversation_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('art-1', 'conv-art', 'Plan', 'my plan', now, now);

    db.query('DELETE FROM conversations WHERE id = ?').run('conv-art');

    const arts = db
      .query("SELECT * FROM artifacts WHERE conversation_id = 'conv-art'")
      .all() as any[];
    expect(arts).toHaveLength(0);
  });

  test('can insert and query settings', () => {
    db.query('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      'test-key',
      'test-value',
    );

    const row = db.query('SELECT value FROM settings WHERE key = ?').get('test-key') as any;
    expect(row.value).toBe('test-value');
  });

  test('settings key is unique (INSERT OR REPLACE)', () => {
    db.query('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('dup-key', 'first');
    db.query('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('dup-key', 'second');

    const row = db.query('SELECT value FROM settings WHERE key = ?').get('dup-key') as any;
    expect(row.value).toBe('second');
  });

  test('can insert and query workspaces', () => {
    const now = Date.now();
    db.query(
      `INSERT INTO workspaces (id, name, path, last_opened, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('ws-data-1', 'My Project', '/home/user/project', now, now);

    const row = db.query('SELECT * FROM workspaces WHERE id = ?').get('ws-data-1') as any;
    expect(row.name).toBe('My Project');
    expect(row.path).toBe('/home/user/project');
  });

  test('mcp_servers table accepts inserts with defaults', () => {
    db.query(`INSERT INTO mcp_servers (name, transport) VALUES (?, ?)`).run('test-server', 'stdio');

    const row = db.query('SELECT * FROM mcp_servers WHERE name = ?').get('test-server') as any;
    expect(row.transport).toBe('stdio');
    expect(row.scope).toBe('local');
    expect(row.status).toBe('disconnected');
  });

  test('users table enforces unique username', () => {
    const now = Date.now();
    db.query(`INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)`).run(
      'user-1',
      'alice',
      'hash1',
      now,
    );

    expect(() =>
      db
        .query(`INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)`)
        .run('user-2', 'alice', 'hash2', now),
    ).toThrow();
  });

  test('can insert prd_stories with null prd_id (standalone stories)', () => {
    const now = Date.now();
    db.query(
      `INSERT INTO prd_stories (id, prd_id, title, created_at, updated_at) VALUES (?, NULL, ?, ?, ?)`,
    ).run('standalone-story', 'Standalone task', now, now);

    const story = db.query('SELECT * FROM prd_stories WHERE id = ?').get('standalone-story') as any;
    expect(story).toBeDefined();
    expect(story.prd_id).toBeNull();
    expect(story.title).toBe('Standalone task');
  });

  test('can insert and query git_snapshots', () => {
    const now = Date.now();
    db.query(
      `INSERT INTO git_snapshots (id, workspace_path, head_sha, reason, has_changes, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('snap-1', '/project', 'abc123', 'pre-agent', 1, now);

    const snap = db.query('SELECT * FROM git_snapshots WHERE id = ?').get('snap-1') as any;
    expect(snap.head_sha).toBe('abc123');
    expect(snap.reason).toBe('pre-agent');
    expect(snap.has_changes).toBe(1);
  });

  test('can insert and query agent_profiles', () => {
    const now = Date.now();
    db.query(
      `INSERT INTO agent_profiles (id, name, permission_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('profile-1', 'Code Agent', 'unrestricted', now, now);

    const profile = db.query('SELECT * FROM agent_profiles WHERE id = ?').get('profile-1') as any;
    expect(profile.name).toBe('Code Agent');
    expect(profile.permission_mode).toBe('unrestricted');
  });

  test('can insert and query installed_skills', () => {
    const now = Date.now();
    db.query(
      `INSERT INTO installed_skills (id, skill_id, tier, version, installed_path, activated, installed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('inst-1', 'skill-abc', 'managed', '1.0.0', '/skills/abc', 1, now, now);

    const skill = db.query('SELECT * FROM installed_skills WHERE id = ?').get('inst-1') as any;
    expect(skill.skill_id).toBe('skill-abc');
    expect(skill.tier).toBe('managed');
    expect(skill.activated).toBe(1);
  });

  test('rules_metadata enforces unique workspace_path + file_path', () => {
    const now = Date.now();
    db.query(
      `INSERT INTO rules_metadata (id, workspace_path, file_path, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('rule-1', '/ws', '/ws/.rules', 'active', now, now);

    expect(() =>
      db
        .query(
          `INSERT INTO rules_metadata (id, workspace_path, file_path, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run('rule-2', '/ws', '/ws/.rules', 'active', now, now),
    ).toThrow();
  });

  test('messages ordered by conversation_id and timestamp via index', () => {
    const now = Date.now();
    db.query(
      `INSERT INTO conversations (id, model, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    ).run('conv-order', 'model', now, now);

    db.query(
      `INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)`,
    ).run('msg-3', 'conv-order', 'assistant', 'Third', now + 300);
    db.query(
      `INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)`,
    ).run('msg-1', 'conv-order', 'user', 'First', now + 100);
    db.query(
      `INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)`,
    ).run('msg-2', 'conv-order', 'assistant', 'Second', now + 200);

    const msgs = db
      .query('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC')
      .all('conv-order') as any[];
    expect(msgs).toHaveLength(3);
    expect(msgs[0].content).toBe('First');
    expect(msgs[1].content).toBe('Second');
    expect(msgs[2].content).toBe('Third');
  });

  test('scheduled_tasks CASCADE deletes with workspace', () => {
    const now = Date.now();
    db.query(
      `INSERT INTO workspaces (id, name, path, last_opened, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('ws-sched', 'Sched WS', '/sched/path', now, now);
    db.query(
      `INSERT INTO scheduled_tasks (id, workspace_id, name, prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('sched-1', 'ws-sched', 'Daily check', 'Run tests', now, now);

    db.query('DELETE FROM workspaces WHERE id = ?').run('ws-sched');

    const tasks = db
      .query("SELECT * FROM scheduled_tasks WHERE workspace_id = 'ws-sched'")
      .all() as any[];
    expect(tasks).toHaveLength(0);
  });

  test('webhook_executions CASCADE deletes with webhook', () => {
    const now = Date.now();
    db.query(
      `INSERT INTO workspaces (id, name, path, last_opened, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('ws-wh', 'WH WS', '/wh/path', now, now);
    db.query(
      `INSERT INTO webhooks (id, workspace_id, name, secret, prompt_template, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('wh-1', 'ws-wh', 'Deploy Hook', 'secret123', 'Deploy prompt', now, now);
    db.query(`INSERT INTO webhook_executions (id, webhook_id, started_at) VALUES (?, ?, ?)`).run(
      'wh-exec-1',
      'wh-1',
      now,
    );

    db.query('DELETE FROM webhooks WHERE id = ?').run('wh-1');

    const execs = db
      .query("SELECT * FROM webhook_executions WHERE webhook_id = 'wh-1'")
      .all() as any[];
    expect(execs).toHaveLength(0);
  });

  test('cross_session_messages can store and retrieve messages', () => {
    const now = Date.now();
    db.query(
      `INSERT INTO cross_session_messages (id, from_conversation_id, to_conversation_id, content, sender_workspace_id, timestamp, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('xmsg-1', 'conv-a', 'conv-b', 'Hey there', 'ws-1', now, now);

    const msg = db.query('SELECT * FROM cross_session_messages WHERE id = ?').get('xmsg-1') as any;
    expect(msg.content).toBe('Hey there');
    expect(msg.delivered).toBe(0);
    expect(msg.from_conversation_id).toBe('conv-a');
    expect(msg.to_conversation_id).toBe('conv-b');
  });
});

// ---------------------------------------------------------------------------
// ALTER TABLE migration columns
// ---------------------------------------------------------------------------
describe('ALTER TABLE migrations', () => {
  let db: Database;

  beforeEach(() => {
    const mod = loadDatabaseModule();
    mod.initDatabase();
    db = mod.getDb();
  });

  test('conversations has permission_mode column with default', () => {
    const now = Date.now();
    db.query(`INSERT INTO conversations (id, created_at, updated_at) VALUES (?, ?, ?)`).run(
      'conv-pm',
      now,
      now,
    );
    const row = db
      .query('SELECT permission_mode FROM conversations WHERE id = ?')
      .get('conv-pm') as any;
    expect(row.permission_mode).toBe('default');
  });

  test('conversations has effort column with default', () => {
    const now = Date.now();
    db.query(`INSERT INTO conversations (id, created_at, updated_at) VALUES (?, ?, ?)`).run(
      'conv-eff',
      now,
      now,
    );
    const row = db.query('SELECT effort FROM conversations WHERE id = ?').get('conv-eff') as any;
    expect(row.effort).toBe('high');
  });

  test('prd_stories has research_only column with default 0', () => {
    const now = Date.now();
    db.query(
      `INSERT INTO prd_stories (id, prd_id, title, created_at, updated_at) VALUES (?, NULL, ?, ?, ?)`,
    ).run('story-ro', 'RO Story', now, now);

    const row = db
      .query('SELECT research_only FROM prd_stories WHERE id = ?')
      .get('story-ro') as any;
    expect(row.research_only).toBe(0);
  });

  test('prd_stories has estimate column (nullable)', () => {
    const cols = getColumnNames(db, 'prd_stories');
    expect(cols).toContain('estimate');

    const now = Date.now();
    db.query(
      `INSERT INTO prd_stories (id, prd_id, title, estimate, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?)`,
    ).run('story-est', 'Est Story', '3 points', now, now);

    const row = db.query('SELECT estimate FROM prd_stories WHERE id = ?').get('story-est') as any;
    expect(row.estimate).toBe('3 points');
  });

  test('git_snapshots has message_id column', () => {
    const cols = getColumnNames(db, 'git_snapshots');
    expect(cols).toContain('message_id');
  });

  test('conversations has compact_summary column', () => {
    const cols = getColumnNames(db, 'conversations');
    expect(cols).toContain('compact_summary');
  });

  test('conversations has profile_id column', () => {
    const cols = getColumnNames(db, 'conversations');
    expect(cols).toContain('profile_id');
  });

  test('loops has last_heartbeat column', () => {
    const cols = getColumnNames(db, 'loops');
    expect(cols).toContain('last_heartbeat');
  });
});
