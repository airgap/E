import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { createTestDb } from '../../test-helpers';
import type { PermissionRule, PermissionMode, TerminalCommandPolicy } from '@e/shared';

// Create an in-memory DB and mock the database module before importing the SUT.
const testDb = createTestDb();
mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

import {
  evaluateRules,
  extractToolInputForMatching,
  shouldRequireApproval,
  loadPermissionRules,
  savePermissionRule,
  deletePermissionRule,
  ensurePermissionRulesTable,
  loadTerminalCommandPolicy,
  type RuleDecision,
} from '../permission-rules';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRule(
  overrides: Partial<PermissionRule> & { type: PermissionRule['type']; tool: string },
): PermissionRule {
  return {
    id: `rule-${Math.random().toString(36).slice(2, 8)}`,
    scope: 'global',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// evaluateRules
// ---------------------------------------------------------------------------

describe('evaluateRules', () => {
  // --- Basic matching ---

  test('returns "default" when there are no rules', () => {
    expect(evaluateRules([], 'Bash', 'ls')).toBe('default');
  });

  test('returns "default" when no rule matches the tool name', () => {
    const rules = [makeRule({ type: 'allow', tool: 'Write' })];
    expect(evaluateRules(rules, 'Bash', 'ls')).toBe('default');
  });

  test('matches an exact tool name', () => {
    const rules = [makeRule({ type: 'allow', tool: 'Bash' })];
    expect(evaluateRules(rules, 'Bash', 'ls')).toBe('allow');
  });

  test('wildcard tool "*" matches any tool', () => {
    const rules = [makeRule({ type: 'deny', tool: '*' })];
    expect(evaluateRules(rules, 'Read')).toBe('deny');
    expect(evaluateRules(rules, 'Bash', 'ls')).toBe('deny');
  });

  // --- Pattern matching ---

  test('matches a rule with an exact pattern', () => {
    const rules = [makeRule({ type: 'deny', tool: 'Bash', pattern: 'rm -rf /' })];
    expect(evaluateRules(rules, 'Bash', 'rm -rf /')).toBe('deny');
  });

  test('does not match when pattern differs', () => {
    const rules = [makeRule({ type: 'deny', tool: 'Bash', pattern: 'rm -rf /' })];
    expect(evaluateRules(rules, 'Bash', 'ls')).toBe('default');
  });

  test('matches a prefix glob pattern (trailing *)', () => {
    const rules = [makeRule({ type: 'allow', tool: 'Bash', pattern: 'git *' })];
    expect(evaluateRules(rules, 'Bash', 'git push')).toBe('allow');
    expect(evaluateRules(rules, 'Bash', 'git status')).toBe('allow');
  });

  test('does not match prefix glob when input lacks prefix', () => {
    const rules = [makeRule({ type: 'allow', tool: 'Bash', pattern: 'git *' })];
    expect(evaluateRules(rules, 'Bash', 'npm install')).toBe('default');
  });

  test('glob "*" as pattern matches any input', () => {
    const rules = [makeRule({ type: 'ask', tool: 'Write', pattern: '*' })];
    expect(evaluateRules(rules, 'Write', '/any/path/file.ts')).toBe('ask');
  });

  test('glob with mid-string wildcard matches across slashes', () => {
    // The glob implementation uses .* so * matches any chars including /
    const rules = [makeRule({ type: 'allow', tool: 'Write', pattern: '/src/*.ts' })];
    expect(evaluateRules(rules, 'Write', '/src/index.ts')).toBe('allow');
    expect(evaluateRules(rules, 'Write', '/src/deep/index.ts')).toBe('allow');
    expect(evaluateRules(rules, 'Write', '/other/index.ts')).toBe('default');
  });

  test('pattern rule requires toolInput; skips if missing', () => {
    const rules = [makeRule({ type: 'allow', tool: 'Bash', pattern: 'ls' })];
    expect(evaluateRules(rules, 'Bash')).toBe('default');
    expect(evaluateRules(rules, 'Bash', undefined)).toBe('default');
  });

  // --- Glob matching with regex special characters ---

  test('escapes regex special chars in pattern', () => {
    const rules = [makeRule({ type: 'allow', tool: 'Write', pattern: '/path/file.ts' })];
    // The "." should be literal, not a regex wildcard
    expect(evaluateRules(rules, 'Write', '/path/file.ts')).toBe('allow');
    expect(evaluateRules(rules, 'Write', '/path/fileXts')).toBe('default');
  });

  test('handles pattern with brackets and parens', () => {
    const rules = [makeRule({ type: 'allow', tool: 'Write', pattern: '/path/(test).ts' })];
    expect(evaluateRules(rules, 'Write', '/path/(test).ts')).toBe('allow');
  });

  // --- Priority: deny > ask > allow ---

  test('deny with pattern beats allow without pattern', () => {
    const rules = [
      makeRule({ type: 'allow', tool: 'Bash' }),
      makeRule({ type: 'deny', tool: 'Bash', pattern: 'rm *' }),
    ];
    expect(evaluateRules(rules, 'Bash', 'rm -rf /')).toBe('deny');
  });

  test('deny without pattern beats ask and allow', () => {
    const rules = [
      makeRule({ type: 'allow', tool: 'Bash' }),
      makeRule({ type: 'ask', tool: 'Bash' }),
      makeRule({ type: 'deny', tool: 'Bash' }),
    ];
    expect(evaluateRules(rules, 'Bash', 'ls')).toBe('deny');
  });

  test('ask beats allow when no deny', () => {
    const rules = [
      makeRule({ type: 'allow', tool: 'Bash' }),
      makeRule({ type: 'ask', tool: 'Bash' }),
    ];
    expect(evaluateRules(rules, 'Bash', 'ls')).toBe('ask');
  });

  test('ask with pattern beats ask without pattern (both resolve to ask)', () => {
    const rules = [
      makeRule({ type: 'ask', tool: 'Bash' }),
      makeRule({ type: 'ask', tool: 'Bash', pattern: 'git *' }),
    ];
    // Both match, but specific ask with pattern is found first -> ask
    expect(evaluateRules(rules, 'Bash', 'git push')).toBe('ask');
  });

  test('deny with pattern takes priority over ask with pattern', () => {
    const rules = [
      makeRule({ type: 'ask', tool: 'Bash', pattern: 'git *' }),
      makeRule({ type: 'deny', tool: 'Bash', pattern: 'git push*' }),
    ];
    expect(evaluateRules(rules, 'Bash', 'git push --force')).toBe('deny');
  });

  test('allow returned when only allow rules match', () => {
    const rules = [
      makeRule({ type: 'allow', tool: 'Read' }),
      makeRule({ type: 'allow', tool: 'Read', pattern: '/src/*' }),
    ];
    expect(evaluateRules(rules, 'Read', '/src/index.ts')).toBe('allow');
  });

  // --- Multiple tools ---

  test('rules for different tools are independent', () => {
    const rules = [
      makeRule({ type: 'deny', tool: 'Bash' }),
      makeRule({ type: 'allow', tool: 'Write' }),
    ];
    expect(evaluateRules(rules, 'Bash', 'ls')).toBe('deny');
    expect(evaluateRules(rules, 'Write', '/tmp/x')).toBe('allow');
  });

  // --- Wildcard tool with pattern ---

  test('wildcard tool with pattern matches specific tool input', () => {
    const rules = [makeRule({ type: 'deny', tool: '*', pattern: '/etc/*' })];
    expect(evaluateRules(rules, 'Write', '/etc/passwd')).toBe('deny');
    expect(evaluateRules(rules, 'Read', '/etc/hosts')).toBe('deny');
    expect(evaluateRules(rules, 'Write', '/home/user/file')).toBe('default');
  });

  // --- Tool name glob matching ---

  test('glob pattern in tool name', () => {
    const rules = [makeRule({ type: 'allow', tool: 'mcp__github__*' })];
    expect(evaluateRules(rules, 'mcp__github__create_issue')).toBe('allow');
    expect(evaluateRules(rules, 'mcp__filesystem__read')).toBe('default');
  });
});

// ---------------------------------------------------------------------------
// extractToolInputForMatching
// ---------------------------------------------------------------------------

describe('extractToolInputForMatching', () => {
  test('Bash extracts command', () => {
    expect(extractToolInputForMatching('Bash', { command: 'ls -la' })).toBe('ls -la');
  });

  test('Bash returns undefined when command is empty', () => {
    expect(extractToolInputForMatching('Bash', { command: '' })).toBeUndefined();
  });

  test('Bash returns undefined when command is missing', () => {
    expect(extractToolInputForMatching('Bash', {})).toBeUndefined();
  });

  test('Write extracts file_path', () => {
    expect(extractToolInputForMatching('Write', { file_path: '/src/x.ts', content: 'hi' })).toBe(
      '/src/x.ts',
    );
  });

  test('Read extracts file_path', () => {
    expect(extractToolInputForMatching('Read', { file_path: '/src/x.ts' })).toBe('/src/x.ts');
  });

  test('Edit extracts file_path', () => {
    expect(
      extractToolInputForMatching('Edit', {
        file_path: '/src/x.ts',
        old_string: 'a',
        new_string: 'b',
      }),
    ).toBe('/src/x.ts');
  });

  test('Write/Read/Edit falls back to path if file_path is missing', () => {
    expect(extractToolInputForMatching('Write', { path: '/alt/path.ts' })).toBe('/alt/path.ts');
    expect(extractToolInputForMatching('Read', { path: '/alt/path.ts' })).toBe('/alt/path.ts');
    expect(extractToolInputForMatching('Edit', { path: '/alt/path.ts' })).toBe('/alt/path.ts');
  });

  test('Write/Read/Edit returns undefined when neither file_path nor path exists', () => {
    expect(extractToolInputForMatching('Write', {})).toBeUndefined();
    expect(extractToolInputForMatching('Read', {})).toBeUndefined();
    expect(extractToolInputForMatching('Edit', {})).toBeUndefined();
  });

  test('Glob extracts pattern', () => {
    expect(extractToolInputForMatching('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts');
  });

  test('Grep extracts pattern', () => {
    expect(extractToolInputForMatching('Grep', { pattern: 'import.*' })).toBe('import.*');
  });

  test('Glob returns undefined when pattern missing', () => {
    expect(extractToolInputForMatching('Glob', {})).toBeUndefined();
  });

  test('Grep returns undefined when pattern missing', () => {
    expect(extractToolInputForMatching('Grep', {})).toBeUndefined();
  });

  test('NotebookEdit extracts notebook_path', () => {
    expect(
      extractToolInputForMatching('NotebookEdit', { notebook_path: '/nb.ipynb', new_source: '' }),
    ).toBe('/nb.ipynb');
  });

  test('NotebookEdit returns undefined when notebook_path missing', () => {
    expect(extractToolInputForMatching('NotebookEdit', {})).toBeUndefined();
  });

  test('WebFetch extracts url', () => {
    expect(
      extractToolInputForMatching('WebFetch', { url: 'https://example.com', prompt: 'p' }),
    ).toBe('https://example.com');
  });

  test('WebFetch returns undefined when url missing', () => {
    expect(extractToolInputForMatching('WebFetch', {})).toBeUndefined();
  });

  test('WebSearch extracts query', () => {
    expect(extractToolInputForMatching('WebSearch', { query: 'bun test' })).toBe('bun test');
  });

  test('WebSearch returns undefined when query missing', () => {
    expect(extractToolInputForMatching('WebSearch', {})).toBeUndefined();
  });

  // Default / unknown tool fallback chain

  test('unknown tool falls back to command', () => {
    expect(extractToolInputForMatching('CustomTool', { command: 'do-stuff' })).toBe('do-stuff');
  });

  test('unknown tool falls back to file_path', () => {
    expect(extractToolInputForMatching('CustomTool', { file_path: '/x.ts' })).toBe('/x.ts');
  });

  test('unknown tool falls back to path', () => {
    expect(extractToolInputForMatching('CustomTool', { path: '/y.ts' })).toBe('/y.ts');
  });

  test('unknown tool falls back to query', () => {
    expect(extractToolInputForMatching('CustomTool', { query: 'search' })).toBe('search');
  });

  test('unknown tool returns undefined when nothing matches', () => {
    expect(extractToolInputForMatching('CustomTool', { foo: 'bar' })).toBeUndefined();
  });

  test('unknown tool follows fallback priority: command > file_path > path > query', () => {
    expect(
      extractToolInputForMatching('CustomTool', {
        command: 'cmd',
        file_path: 'fp',
        path: 'p',
        query: 'q',
      }),
    ).toBe('cmd');
    expect(
      extractToolInputForMatching('CustomTool', { file_path: 'fp', path: 'p', query: 'q' }),
    ).toBe('fp');
    expect(extractToolInputForMatching('CustomTool', { path: 'p', query: 'q' })).toBe('p');
  });
});

// ---------------------------------------------------------------------------
// shouldRequireApproval
// ---------------------------------------------------------------------------

describe('shouldRequireApproval', () => {
  const noRules: PermissionRule[] = [];
  const autoPolicy: TerminalCommandPolicy = 'auto';

  // --- Per-tool rules override everything ---

  test('explicit allow rule overrides permission mode', () => {
    const rules = [makeRule({ type: 'allow', tool: 'Bash' })];
    expect(shouldRequireApproval('Bash', { command: 'rm -rf /' }, rules, 'safe', 'auto')).toBe(
      'allow',
    );
  });

  test('explicit deny rule overrides permission mode', () => {
    const rules = [makeRule({ type: 'deny', tool: 'Bash' })];
    expect(shouldRequireApproval('Bash', { command: 'ls' }, rules, 'unrestricted', 'auto')).toBe(
      'deny',
    );
  });

  test('explicit ask rule overrides unrestricted mode', () => {
    const rules = [makeRule({ type: 'ask', tool: 'Write' })];
    expect(
      shouldRequireApproval('Write', { file_path: '/x.ts' }, rules, 'unrestricted', 'auto'),
    ).toBe('ask');
  });

  // --- Terminal command policy ---

  test('terminal policy "off" denies Bash when no rules match', () => {
    expect(shouldRequireApproval('Bash', { command: 'ls' }, noRules, 'unrestricted', 'off')).toBe(
      'deny',
    );
  });

  test('terminal policy "turbo" allows Bash when no rules match', () => {
    expect(shouldRequireApproval('Bash', { command: 'rm -rf /' }, noRules, 'safe', 'turbo')).toBe(
      'allow',
    );
  });

  test('terminal policy "custom" falls through to permission mode', () => {
    // In safe mode, Bash is a dangerous tool -> ask
    expect(shouldRequireApproval('Bash', { command: 'ls' }, noRules, 'safe', 'custom')).toBe('ask');
  });

  test('terminal policy "auto" falls through to permission mode', () => {
    expect(shouldRequireApproval('Bash', { command: 'ls' }, noRules, 'safe', 'auto')).toBe('ask');
  });

  test('terminal policy only applies to Bash tool', () => {
    // Write is not Bash, so terminal policy "off" is irrelevant
    expect(
      shouldRequireApproval('Write', { file_path: '/x.ts' }, noRules, 'unrestricted', 'off'),
    ).toBe('allow');
  });

  // --- Permission mode: unrestricted ---

  test('unrestricted mode allows all tools', () => {
    expect(
      shouldRequireApproval('Write', { file_path: '/x.ts' }, noRules, 'unrestricted', autoPolicy),
    ).toBe('allow');
    expect(
      shouldRequireApproval('Read', { file_path: '/x.ts' }, noRules, 'unrestricted', autoPolicy),
    ).toBe('allow');
    expect(
      shouldRequireApproval('Bash', { command: 'rm -rf /' }, noRules, 'unrestricted', autoPolicy),
    ).toBe('allow');
    expect(
      shouldRequireApproval(
        'NotebookEdit',
        { notebook_path: '/nb.ipynb' },
        noRules,
        'unrestricted',
        autoPolicy,
      ),
    ).toBe('allow');
  });

  // --- Permission mode: plan ---

  test('plan mode denies write tools', () => {
    expect(
      shouldRequireApproval('Write', { file_path: '/x.ts' }, noRules, 'plan', autoPolicy),
    ).toBe('deny');
    expect(shouldRequireApproval('Edit', { file_path: '/x.ts' }, noRules, 'plan', autoPolicy)).toBe(
      'deny',
    );
    expect(shouldRequireApproval('Bash', { command: 'ls' }, noRules, 'plan', autoPolicy)).toBe(
      'deny',
    );
    expect(
      shouldRequireApproval(
        'NotebookEdit',
        { notebook_path: '/nb.ipynb' },
        noRules,
        'plan',
        autoPolicy,
      ),
    ).toBe('deny');
  });

  test('plan mode allows read-only tools', () => {
    expect(shouldRequireApproval('Read', { file_path: '/x.ts' }, noRules, 'plan', autoPolicy)).toBe(
      'allow',
    );
    expect(shouldRequireApproval('Glob', { pattern: '**/*.ts' }, noRules, 'plan', autoPolicy)).toBe(
      'allow',
    );
    expect(shouldRequireApproval('Grep', { pattern: 'foo' }, noRules, 'plan', autoPolicy)).toBe(
      'allow',
    );
    expect(
      shouldRequireApproval(
        'WebFetch',
        { url: 'https://example.com' },
        noRules,
        'plan',
        autoPolicy,
      ),
    ).toBe('allow');
    expect(shouldRequireApproval('WebSearch', { query: 'test' }, noRules, 'plan', autoPolicy)).toBe(
      'allow',
    );
  });

  // --- Permission mode: fast ---

  test('fast mode auto-approves safe tools', () => {
    const safeTools: Array<[string, Record<string, unknown>]> = [
      ['Read', { file_path: '/x.ts' }],
      ['Glob', { pattern: '*.ts' }],
      ['Grep', { pattern: 'foo' }],
      ['WebFetch', { url: 'https://example.com' }],
      ['WebSearch', { query: 'test' }],
    ];
    for (const [tool, input] of safeTools) {
      expect(shouldRequireApproval(tool, input, noRules, 'fast', autoPolicy)).toBe('allow');
    }
  });

  test('fast mode asks for dangerous tools', () => {
    expect(
      shouldRequireApproval('Write', { file_path: '/x.ts' }, noRules, 'fast', autoPolicy),
    ).toBe('ask');
    expect(shouldRequireApproval('Edit', { file_path: '/x.ts' }, noRules, 'fast', autoPolicy)).toBe(
      'ask',
    );
    expect(shouldRequireApproval('Bash', { command: 'ls' }, noRules, 'fast', autoPolicy)).toBe(
      'ask',
    );
    expect(
      shouldRequireApproval(
        'NotebookEdit',
        { notebook_path: '/nb.ipynb' },
        noRules,
        'fast',
        autoPolicy,
      ),
    ).toBe('ask');
  });

  // --- Permission mode: safe (default) ---

  test('safe mode asks for dangerous tools', () => {
    const dangerousTools: Array<[string, Record<string, unknown>]> = [
      ['Write', { file_path: '/x.ts' }],
      ['Edit', { file_path: '/x.ts' }],
      ['Bash', { command: 'ls' }],
      ['NotebookEdit', { notebook_path: '/nb.ipynb' }],
    ];
    for (const [tool, input] of dangerousTools) {
      expect(shouldRequireApproval(tool, input, noRules, 'safe', autoPolicy)).toBe('ask');
    }
  });

  test('safe mode allows safe tools', () => {
    expect(shouldRequireApproval('Read', { file_path: '/x.ts' }, noRules, 'safe', autoPolicy)).toBe(
      'allow',
    );
    expect(shouldRequireApproval('Glob', { pattern: '*.ts' }, noRules, 'safe', autoPolicy)).toBe(
      'allow',
    );
    expect(shouldRequireApproval('Grep', { pattern: 'foo' }, noRules, 'safe', autoPolicy)).toBe(
      'allow',
    );
  });

  test('safe mode allows unknown non-dangerous tools', () => {
    expect(
      shouldRequireApproval('SomeUnknownTool', { foo: 'bar' }, noRules, 'safe', autoPolicy),
    ).toBe('allow');
  });

  // --- Combined: rule overrides terminal policy ---

  test('explicit allow rule for Bash overrides terminal policy "off"', () => {
    const rules = [makeRule({ type: 'allow', tool: 'Bash' })];
    expect(shouldRequireApproval('Bash', { command: 'ls' }, rules, 'safe', 'off')).toBe('allow');
  });

  test('explicit deny rule for Bash overrides terminal policy "turbo"', () => {
    const rules = [makeRule({ type: 'deny', tool: 'Bash' })];
    expect(shouldRequireApproval('Bash', { command: 'ls' }, rules, 'unrestricted', 'turbo')).toBe(
      'deny',
    );
  });
});

// ---------------------------------------------------------------------------
// DB-dependent tests: ensurePermissionRulesTable, savePermissionRule,
// loadPermissionRules, deletePermissionRule, loadTerminalCommandPolicy
// ---------------------------------------------------------------------------

describe('ensurePermissionRulesTable', () => {
  beforeEach(() => {
    // Drop the table so we can test creation
    try {
      testDb.exec('DROP TABLE IF EXISTS permission_rules');
    } catch {}
  });

  test('creates the permission_rules table', () => {
    ensurePermissionRulesTable();

    // Verify the table exists by running a query
    const rows = testDb
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='permission_rules'")
      .all();
    expect(rows).toHaveLength(1);
  });

  test('is idempotent (can be called multiple times)', () => {
    ensurePermissionRulesTable();
    ensurePermissionRulesTable();

    const rows = testDb
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='permission_rules'")
      .all();
    expect(rows).toHaveLength(1);
  });

  test('table has expected columns', () => {
    ensurePermissionRulesTable();

    const info = testDb.query('PRAGMA table_info(permission_rules)').all() as Array<{
      name: string;
      type: string;
    }>;
    const colNames = info.map((c) => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('scope');
    expect(colNames).toContain('workspace_path');
    expect(colNames).toContain('conversation_id');
    expect(colNames).toContain('data');
    expect(colNames).toContain('created_at');
  });
});

describe('savePermissionRule', () => {
  beforeEach(() => {
    testDb.exec('DROP TABLE IF EXISTS permission_rules');
  });

  test('creates table and inserts a global rule', () => {
    const rule: PermissionRule = {
      id: 'r1',
      type: 'allow',
      tool: 'Read',
      scope: 'global',
    };

    savePermissionRule(rule);

    const rows = testDb.query('SELECT * FROM permission_rules WHERE id = ?').all('r1') as Array<{
      id: string;
      scope: string;
      data: string;
      workspace_path: string | null;
      conversation_id: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].scope).toBe('global');
    expect(rows[0].workspace_path).toBeNull();
    expect(rows[0].conversation_id).toBeNull();
    expect(JSON.parse(rows[0].data)).toEqual(rule);
  });

  test('saves a project-scoped rule with workspace_path', () => {
    const rule: PermissionRule = {
      id: 'r2',
      type: 'deny',
      tool: 'Bash',
      pattern: 'rm *',
      scope: 'project',
    };

    savePermissionRule(rule, '/home/user/project');

    const row = testDb.query('SELECT * FROM permission_rules WHERE id = ?').get('r2') as {
      workspace_path: string;
    };
    expect(row.workspace_path).toBe('/home/user/project');
  });

  test('saves a session-scoped rule with conversation_id', () => {
    const rule: PermissionRule = {
      id: 'r3',
      type: 'ask',
      tool: 'Write',
      scope: 'session',
    };

    savePermissionRule(rule, undefined, 'conv-123');

    const row = testDb.query('SELECT * FROM permission_rules WHERE id = ?').get('r3') as {
      conversation_id: string;
    };
    expect(row.conversation_id).toBe('conv-123');
  });

  test('upserts (updates) existing rule on conflict', () => {
    const rule: PermissionRule = {
      id: 'r4',
      type: 'allow',
      tool: 'Read',
      scope: 'global',
    };

    savePermissionRule(rule);

    // Update the rule
    const updatedRule: PermissionRule = {
      id: 'r4',
      type: 'deny',
      tool: 'Read',
      scope: 'global',
    };

    savePermissionRule(updatedRule);

    const rows = testDb.query('SELECT * FROM permission_rules WHERE id = ?').all('r4') as Array<{
      data: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].data).type).toBe('deny');
  });
});

describe('deletePermissionRule', () => {
  beforeEach(() => {
    testDb.exec('DROP TABLE IF EXISTS permission_rules');
  });

  test('deletes an existing rule by id', () => {
    const rule: PermissionRule = {
      id: 'del-1',
      type: 'allow',
      tool: 'Read',
      scope: 'global',
    };
    savePermissionRule(rule);

    deletePermissionRule('del-1');

    const rows = testDb.query('SELECT * FROM permission_rules WHERE id = ?').all('del-1');
    expect(rows).toHaveLength(0);
  });

  test('does not throw when deleting a non-existent rule', () => {
    ensurePermissionRulesTable();
    expect(() => deletePermissionRule('nonexistent')).not.toThrow();
  });

  test('does not affect other rules', () => {
    const rule1: PermissionRule = { id: 'del-2a', type: 'allow', tool: 'Read', scope: 'global' };
    const rule2: PermissionRule = { id: 'del-2b', type: 'deny', tool: 'Bash', scope: 'global' };
    savePermissionRule(rule1);
    savePermissionRule(rule2);

    deletePermissionRule('del-2a');

    const remaining = testDb.query('SELECT * FROM permission_rules').all();
    expect(remaining).toHaveLength(1);
    expect((remaining[0] as { id: string }).id).toBe('del-2b');
  });
});

describe('loadPermissionRules', () => {
  beforeEach(() => {
    testDb.exec('DROP TABLE IF EXISTS permission_rules');
    ensurePermissionRulesTable();
  });

  test('returns empty array when no rules exist', () => {
    const rules = loadPermissionRules();
    expect(rules).toEqual([]);
  });

  test('loads global rules', () => {
    const rule: PermissionRule = { id: 'load-1', type: 'allow', tool: 'Read', scope: 'global' };
    savePermissionRule(rule);

    const rules = loadPermissionRules();
    expect(rules).toHaveLength(1);
    expect(rules[0]).toEqual(rule);
  });

  test('loads project-scoped rules when workspacePath is provided', () => {
    const globalRule: PermissionRule = {
      id: 'load-g1',
      type: 'allow',
      tool: 'Read',
      scope: 'global',
    };
    const projectRule: PermissionRule = {
      id: 'load-p1',
      type: 'deny',
      tool: 'Bash',
      pattern: 'rm *',
      scope: 'project',
    };

    savePermissionRule(globalRule);
    savePermissionRule(projectRule, '/home/user/project');

    const rules = loadPermissionRules(undefined, '/home/user/project');
    expect(rules).toHaveLength(2);
    expect(rules.map((r) => r.id)).toContain('load-g1');
    expect(rules.map((r) => r.id)).toContain('load-p1');
  });

  test('does not load project rules for different workspace', () => {
    const projectRule: PermissionRule = {
      id: 'load-p2',
      type: 'deny',
      tool: 'Bash',
      scope: 'project',
    };
    savePermissionRule(projectRule, '/home/user/other-project');

    const rules = loadPermissionRules(undefined, '/home/user/project');
    expect(rules.map((r) => r.id)).not.toContain('load-p2');
  });

  test('loads session-scoped rules when conversationId is provided', () => {
    const sessionRule: PermissionRule = {
      id: 'load-s1',
      type: 'ask',
      tool: 'Write',
      scope: 'session',
    };
    savePermissionRule(sessionRule, undefined, 'conv-abc');

    const rules = loadPermissionRules('conv-abc');
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe('load-s1');
  });

  test('does not load session rules for different conversation', () => {
    const sessionRule: PermissionRule = {
      id: 'load-s2',
      type: 'ask',
      tool: 'Write',
      scope: 'session',
    };
    savePermissionRule(sessionRule, undefined, 'conv-other');

    const rules = loadPermissionRules('conv-abc');
    expect(rules.map((r) => r.id)).not.toContain('load-s2');
  });

  test('loads rules in order: global -> project -> session', () => {
    const globalRule: PermissionRule = {
      id: 'order-g',
      type: 'allow',
      tool: 'Read',
      scope: 'global',
    };
    const projectRule: PermissionRule = {
      id: 'order-p',
      type: 'deny',
      tool: 'Bash',
      scope: 'project',
    };
    const sessionRule: PermissionRule = {
      id: 'order-s',
      type: 'ask',
      tool: 'Write',
      scope: 'session',
    };

    savePermissionRule(globalRule);
    savePermissionRule(projectRule, '/workspace');
    savePermissionRule(sessionRule, undefined, 'conv-123');

    const rules = loadPermissionRules('conv-123', '/workspace');
    expect(rules).toHaveLength(3);
    // Global comes first, then project, then session
    expect(rules[0].id).toBe('order-g');
    expect(rules[1].id).toBe('order-p');
    expect(rules[2].id).toBe('order-s');
  });

  test('loads multiple rules within the same scope in insertion order', () => {
    const r1: PermissionRule = { id: 'multi-1', type: 'allow', tool: 'Read', scope: 'global' };
    const r2: PermissionRule = { id: 'multi-2', type: 'deny', tool: 'Write', scope: 'global' };
    const r3: PermissionRule = { id: 'multi-3', type: 'ask', tool: 'Bash', scope: 'global' };

    savePermissionRule(r1);
    savePermissionRule(r2);
    savePermissionRule(r3);

    const rules = loadPermissionRules();
    expect(rules).toHaveLength(3);
    expect(rules.map((r) => r.id)).toEqual(['multi-1', 'multi-2', 'multi-3']);
  });

  test('skips rows with invalid JSON in data column gracefully', () => {
    // Insert a row with bad JSON directly
    testDb
      .query(
        `INSERT INTO permission_rules (id, scope, workspace_path, conversation_id, data, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('bad-json', 'global', null, null, '{invalid-json', Date.now());

    const validRule: PermissionRule = {
      id: 'good-json',
      type: 'allow',
      tool: 'Read',
      scope: 'global',
    };
    savePermissionRule(validRule);

    const rules = loadPermissionRules();
    // The bad JSON row should be silently skipped
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe('good-json');
  });
});

describe('loadTerminalCommandPolicy', () => {
  beforeEach(() => {
    // Clear settings
    testDb.exec('DELETE FROM settings');
  });

  test('returns "auto" when no setting exists', () => {
    expect(loadTerminalCommandPolicy()).toBe('auto');
  });

  test('returns "off" when setting is "off"', () => {
    testDb
      .query("INSERT INTO settings (key, value) VALUES ('terminalCommandPolicy', ?)")
      .run(JSON.stringify('off'));
    expect(loadTerminalCommandPolicy()).toBe('off');
  });

  test('returns "turbo" when setting is "turbo"', () => {
    testDb
      .query("INSERT INTO settings (key, value) VALUES ('terminalCommandPolicy', ?)")
      .run(JSON.stringify('turbo'));
    expect(loadTerminalCommandPolicy()).toBe('turbo');
  });

  test('returns "custom" when setting is "custom"', () => {
    testDb
      .query("INSERT INTO settings (key, value) VALUES ('terminalCommandPolicy', ?)")
      .run(JSON.stringify('custom'));
    expect(loadTerminalCommandPolicy()).toBe('custom');
  });

  test('returns "auto" when setting is "auto"', () => {
    testDb
      .query("INSERT INTO settings (key, value) VALUES ('terminalCommandPolicy', ?)")
      .run(JSON.stringify('auto'));
    expect(loadTerminalCommandPolicy()).toBe('auto');
  });

  test('returns "auto" for an unrecognised value', () => {
    testDb
      .query("INSERT INTO settings (key, value) VALUES ('terminalCommandPolicy', ?)")
      .run(JSON.stringify('banana'));
    expect(loadTerminalCommandPolicy()).toBe('auto');
  });

  test('returns "auto" when JSON parse fails', () => {
    testDb
      .query("INSERT INTO settings (key, value) VALUES ('terminalCommandPolicy', ?)")
      .run('{bad json');
    expect(loadTerminalCommandPolicy()).toBe('auto');
  });
});
