import { Database } from 'bun:sqlite';

/**
 * Create an in-memory SQLite database with the same schema as production.
 */
export function createTestDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Conversation',
      model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
      system_prompt TEXT,
      workspace_path TEXT,
      workspace_id TEXT,
      plan_mode INTEGER NOT NULL DEFAULT 0,
      plan_file TEXT,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      permission_mode TEXT DEFAULT 'safe',
      effort TEXT,
      max_budget_usd REAL,
      max_turns INTEGER,
      allowed_tools TEXT,
      disallowed_tools TEXT,
      cli_session_id TEXT,
      compact_summary TEXT,
      user_id TEXT,
      profile_id TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      token_count INTEGER,
      timestamp INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      subject TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      active_form TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      owner TEXT,
      blocks TEXT NOT NULL DEFAULT '[]',
      blocked_by TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      name TEXT PRIMARY KEY,
      transport TEXT NOT NULL DEFAULT 'stdio',
      command TEXT,
      args TEXT DEFAULT '[]',
      url TEXT,
      env TEXT DEFAULT '{}',
      scope TEXT NOT NULL DEFAULT 'project',
      status TEXT NOT NULL DEFAULT 'disconnected'
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS git_snapshots (
      id TEXT PRIMARY KEY,
      workspace_path TEXT NOT NULL,
      conversation_id TEXT,
      head_sha TEXT NOT NULL,
      stash_sha TEXT,
      reason TEXT NOT NULL DEFAULT 'pre-agent',
      has_changes INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      message_id TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_memories (
      id TEXT PRIMARY KEY,
      workspace_path TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'convention',
      key TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      confidence REAL NOT NULL DEFAULT 1.0,
      times_seen INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS prds (
      id TEXT PRIMARY KEY,
      workspace_path TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      branch_name TEXT,
      quality_checks TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS prd_stories (
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
      sort_order INTEGER NOT NULL DEFAULT 0,
      workspace_path TEXT,
      external_ref TEXT,
      external_status TEXT,
      research_only INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (prd_id) REFERENCES prds(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS loops (
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
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS story_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'feature',
      title_template TEXT NOT NULL DEFAULT '',
      description_template TEXT NOT NULL DEFAULT '',
      acceptance_criteria_templates TEXT NOT NULL DEFAULT '[]',
      priority TEXT NOT NULL DEFAULT 'medium',
      tags TEXT NOT NULL DEFAULT '[]',
      is_built_in INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_story_templates_category ON story_templates(category)');

  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, timestamp)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_conv ON tasks(conversation_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_git_snapshots_path ON git_snapshots(workspace_path)');
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_workspace_memories_path ON workspace_memories(workspace_path)',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_workspace_memories_category ON workspace_memories(workspace_path, category)',
  );
  db.exec('CREATE INDEX IF NOT EXISTS idx_prds_workspace_path ON prds(workspace_path)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_prd_stories_prd ON prd_stories(prd_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_loops_prd ON loops(prd_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_loops_status ON loops(status)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS worktrees (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL UNIQUE,
      prd_id TEXT,
      workspace_path TEXT NOT NULL,
      worktree_path TEXT NOT NULL UNIQUE,
      branch_name TEXT NOT NULL UNIQUE,
      base_branch TEXT,
      base_commit TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_worktrees_workspace ON worktrees(workspace_path, status)',
  );
  db.exec('CREATE INDEX IF NOT EXISTS idx_worktrees_status ON worktrees(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_worktrees_story ON worktrees(story_id)');

  return db;
}
