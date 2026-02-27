#!/usr/bin/env bun
/**
 * E Work MCP Server — Exposes PRD, story, loop, and canvas management as MCP tools.
 *
 * This is a standalone MCP server that communicates via JSON-RPC 2.0 over stdio.
 * It connects directly to E's SQLite database so agents can manipulate the work
 * system without HTTP/CSRF overhead.
 *
 * Canvas data is stored directly in the same SQLite database alongside PRDs
 * and stories — no REST callback needed.
 *
 * Usage: bun packages/server/src/mcp/e-work-server.ts
 *
 * Registered as MCP server "e-work" in E's server on startup.
 */

import { Database } from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';
import { nanoid } from 'nanoid';
import { createInterface } from 'readline';

// ── Database Connection ──

const DB_PATH = Bun.env.E_DB_PATH || join(homedir(), '.e', 'e.db');
let db: Database;

function getDb(): Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA foreign_keys = ON');
  }
  return db;
}

// ── Row Helpers ──

function prdFromRow(row: any) {
  const rawWorkflow = row.workflow_config ? JSON.parse(row.workflow_config) : undefined;
  return {
    id: row.id,
    workspacePath: row.workspace_path,
    name: row.name,
    description: row.description,
    branchName: row.branch_name,
    qualityChecks: JSON.parse(row.quality_checks || '[]'),
    workflowConfig: rawWorkflow && Object.keys(rawWorkflow).length > 0 ? rawWorkflow : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function storyFromRow(row: any) {
  return {
    id: row.id,
    prdId: row.prd_id || null,
    workspacePath: row.workspace_path || undefined,
    title: row.title,
    description: row.description,
    acceptanceCriteria: JSON.parse(row.acceptance_criteria || '[]'),
    priority: row.priority,
    dependsOn: JSON.parse(row.depends_on || '[]'),
    dependencyReasons: JSON.parse(row.dependency_reasons || '{}'),
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    learnings: JSON.parse(row.learnings || '[]'),
    estimate: row.estimate ? JSON.parse(row.estimate) : undefined,
    researchOnly: !!row.research_only,
    // Executor metadata (distributed coordination)
    executorId: row.executor_id || undefined,
    executorType: row.executor_type || undefined,
    machineId: row.machine_id || undefined,
    startedAt: row.started_at || undefined,
    lastHeartbeat: row.last_heartbeat || undefined,
    assignedBranch: row.assigned_branch || undefined,
    leaseExpiresAt: row.lease_expires_at || undefined,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Canvas (direct DB) ──

function canvasPush(body: Record<string, unknown>): { ok: boolean; data?: any; error?: string } {
  const db = getDb();
  const contentType = body.content_type as string;
  const content = body.content as string;
  const title = (body.title as string) || null;
  const canvasId = (body.canvas_id as string) || nanoid(12);
  const conversationId = (body.conversation_id as string) || null;

  if (!contentType || !['html', 'svg', 'mermaid', 'table'].includes(contentType)) {
    return {
      ok: false,
      error: `Invalid content_type: ${contentType}. Must be html, svg, mermaid, or table`,
    };
  }
  if (!content) {
    return { ok: false, error: 'content is required' };
  }
  if (contentType === 'table') {
    try {
      JSON.parse(content);
    } catch {
      return { ok: false, error: 'Table content must be valid JSON array' };
    }
  }

  const now = Date.now();
  const existing = db.query('SELECT id FROM canvases WHERE id = ?').get(canvasId) as any;
  if (existing) {
    db.query(
      'UPDATE canvases SET content_type = ?, content = ?, title = ?, conversation_id = COALESCE(?, conversation_id), updated_at = ? WHERE id = ?',
    ).run(contentType, content, title, conversationId, now, canvasId);
  } else {
    db.query(
      'INSERT INTO canvases (id, conversation_id, content_type, content, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(canvasId, conversationId, contentType, content, title, now, now);
  }

  return {
    ok: true,
    data: { id: canvasId, contentType, content, title, conversationId, lastUpdated: now },
  };
}

function canvasListFromDb(conversationId: string): { ok: boolean; data?: any[]; error?: string } {
  const db = getDb();
  const rows = db
    .query(
      'SELECT id, conversation_id, content_type, content, title, created_at, updated_at FROM canvases WHERE conversation_id = ? ORDER BY updated_at DESC',
    )
    .all(conversationId) as any[];
  const data = rows.map((r: any) => ({
    id: r.id,
    conversationId: r.conversation_id,
    contentType: r.content_type,
    content: r.content,
    title: r.title,
    lastUpdated: r.updated_at,
  }));
  return { ok: true, data };
}

// ── Tool Definitions ──

const TOOLS = [
  // ── PRD Management ──
  {
    name: 'list_prds',
    description:
      'List all PRDs (Product Requirement Documents) for a workspace. Returns id, name, description, story count.',
    inputSchema: {
      type: 'object',
      properties: {
        workspacePath: {
          type: 'string',
          description: 'Absolute path to the workspace directory',
        },
      },
      required: ['workspacePath'],
    },
  },
  {
    name: 'get_prd',
    description: 'Get a PRD by ID, including all its stories.',
    inputSchema: {
      type: 'object',
      properties: {
        prdId: { type: 'string', description: 'The PRD ID' },
      },
      required: ['prdId'],
    },
  },
  {
    name: 'create_prd',
    description:
      'Create a new PRD with optional initial stories. Returns the PRD ID and story IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        workspacePath: {
          type: 'string',
          description: 'Absolute path to the workspace directory',
        },
        name: { type: 'string', description: 'PRD name/title' },
        description: {
          type: 'string',
          description: 'PRD description — goals, context, architecture notes',
        },
        branchName: {
          type: 'string',
          description: 'Optional git branch name for this PRD',
        },
        stories: {
          type: 'array',
          description: 'Optional initial stories to create with the PRD',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Story title' },
              description: { type: 'string', description: 'Detailed story description' },
              acceptanceCriteria: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of acceptance criteria strings',
              },
              priority: {
                type: 'string',
                enum: ['critical', 'high', 'medium', 'low'],
                description: 'Story priority (default: medium)',
              },
            },
            required: ['title', 'acceptanceCriteria'],
          },
        },
      },
      required: ['workspacePath', 'name'],
    },
  },
  {
    name: 'update_prd',
    description:
      'Update PRD metadata (name, description, branchName, workflowConfig). Use workflowConfig to control kanban behavior like whether QA unblocks dependents.',
    inputSchema: {
      type: 'object',
      properties: {
        prdId: { type: 'string', description: 'The PRD ID to update' },
        name: { type: 'string', description: 'New PRD name' },
        description: { type: 'string', description: 'New PRD description' },
        branchName: { type: 'string', description: 'New branch name' },
        workflowConfig: {
          type: 'object',
          description:
            'Kanban workflow config. Set qaUnblocksDependents: true to let stories in QA unblock dependent stories.',
          properties: {
            qaUnblocksDependents: {
              type: 'boolean',
              description:
                'If true, stories in QA status count as "done" for dependency resolution',
            },
          },
        },
      },
      required: ['prdId'],
    },
  },
  {
    name: 'delete_prd',
    description: 'Delete a PRD and all its stories (cascading delete).',
    inputSchema: {
      type: 'object',
      properties: {
        prdId: { type: 'string', description: 'The PRD ID to delete' },
      },
      required: ['prdId'],
    },
  },

  // ── Story Management ──
  {
    name: 'list_stories',
    description:
      'List stories for a workspace. Can filter by PRD, status, or list all. Returns full story objects.',
    inputSchema: {
      type: 'object',
      properties: {
        workspacePath: {
          type: 'string',
          description: 'Absolute path to the workspace directory',
        },
        prdId: {
          type: 'string',
          description: 'Filter to stories in this PRD. Omit for standalone stories.',
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'qa', 'completed', 'failed', 'archived', 'paused'],
          description: 'Filter by status. Omit for all statuses.',
        },
        includeAll: {
          type: 'boolean',
          description: 'If true, return all stories (standalone + PRD-bound) for the workspace.',
        },
      },
      required: ['workspacePath'],
    },
  },
  {
    name: 'create_story',
    description:
      'Create a new story, either standalone (no PRD) or attached to a PRD. Returns the created story.',
    inputSchema: {
      type: 'object',
      properties: {
        workspacePath: {
          type: 'string',
          description: 'Absolute path to the workspace directory (required for standalone stories)',
        },
        prdId: {
          type: 'string',
          description: 'PRD ID to attach this story to. Omit for standalone story.',
        },
        title: { type: 'string', description: 'Story title' },
        description: { type: 'string', description: 'Detailed story description' },
        acceptanceCriteria: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of acceptance criteria strings',
        },
        priority: {
          type: 'string',
          enum: ['critical', 'high', 'medium', 'low'],
          description: 'Story priority (default: medium)',
        },
        dependsOn: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of story IDs this story depends on',
        },
        researchOnly: {
          type: 'boolean',
          description: 'If true, story is for research/discovery only — excluded from loops',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_story',
    description:
      'Update any fields on an existing story: title, description, status, priority, acceptance criteria, dependencies, learnings, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        storyId: { type: 'string', description: 'The story ID to update' },
        prdId: {
          type: 'string',
          description: 'PRD ID if this is a PRD-bound story. Omit for standalone.',
        },
        title: { type: 'string', description: 'New title' },
        description: { type: 'string', description: 'New description' },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'qa', 'completed', 'failed', 'archived', 'paused'],
          description: 'New status',
        },
        priority: {
          type: 'string',
          enum: ['critical', 'high', 'medium', 'low'],
          description: 'New priority',
        },
        acceptanceCriteria: {
          type: 'array',
          items: { type: 'string' },
          description: 'Replace acceptance criteria (array of strings)',
        },
        dependsOn: {
          type: 'array',
          items: { type: 'string' },
          description: 'Replace dependency list (array of story IDs)',
        },
        researchOnly: {
          type: 'boolean',
          description: 'Set research-only flag',
        },
        learnings: {
          type: 'array',
          items: { type: 'string' },
          description: 'Replace learnings list',
        },
      },
      required: ['storyId'],
    },
  },
  {
    name: 'delete_story',
    description: 'Delete a story by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        storyId: { type: 'string', description: 'The story ID to delete' },
        prdId: {
          type: 'string',
          description: 'PRD ID if this is a PRD-bound story. Omit for standalone.',
        },
      },
      required: ['storyId'],
    },
  },
  {
    name: 'reorder_stories',
    description:
      'Set the order of stories by providing an array of story IDs in the desired order. Works for both standalone and PRD-bound stories.',
    inputSchema: {
      type: 'object',
      properties: {
        storyIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Story IDs in the desired order',
        },
      },
      required: ['storyIds'],
    },
  },
  {
    name: 'archive_completed_stories',
    description: 'Archive all completed stories in a workspace or PRD.',
    inputSchema: {
      type: 'object',
      properties: {
        workspacePath: {
          type: 'string',
          description: 'Workspace path for standalone stories',
        },
        prdId: {
          type: 'string',
          description: 'PRD ID for PRD-bound stories',
        },
      },
    },
  },

  // ── Story Completion & Search ──
  {
    name: 'complete_story',
    description:
      'One-shot story completion: marks a story as completed (promoting from qa if applicable), optionally auto-passes all acceptance criteria, and appends learnings. Use this to approve stories that golems moved to QA, or to directly complete stories.',
    inputSchema: {
      type: 'object',
      properties: {
        storyId: { type: 'string', description: 'The story ID to complete' },
        passAllCriteria: {
          type: 'boolean',
          description: 'If true (default), mark all acceptance criteria as passed',
          default: true,
        },
        learnings: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional learnings to append to the story',
        },
        summary: {
          type: 'string',
          description: 'Optional completion summary to prepend to learnings',
        },
      },
      required: ['storyId'],
    },
  },
  {
    name: 'find_stories',
    description:
      'Search stories by title or description text. Returns matching stories without dumping the entire database. Much more efficient than list_stories for finding specific stories.',
    inputSchema: {
      type: 'object',
      properties: {
        workspacePath: {
          type: 'string',
          description: 'Absolute path to the workspace directory',
        },
        query: {
          type: 'string',
          description: 'Search text to match against title and description (case-insensitive)',
        },
        prdId: {
          type: 'string',
          description: 'Optional: restrict search to stories in this PRD',
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'qa', 'completed', 'failed', 'archived', 'paused'],
          description: 'Optional: filter by status',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default: 10)',
          default: 10,
        },
      },
      required: ['workspacePath', 'query'],
    },
  },
  {
    name: 'update_acceptance_criteria',
    description:
      'Batch update acceptance criteria pass/fail states on a story. Allows updating multiple criteria in one call without replacing the criteria text.',
    inputSchema: {
      type: 'object',
      properties: {
        storyId: { type: 'string', description: 'The story ID' },
        updates: {
          type: 'array',
          description: 'Array of criteria updates',
          items: {
            type: 'object',
            properties: {
              criteriaId: { type: 'string', description: 'The acceptance criterion ID' },
              passed: { type: 'boolean', description: 'Whether this criterion passed' },
            },
            required: ['criteriaId', 'passed'],
          },
        },
      },
      required: ['storyId', 'updates'],
    },
  },
  {
    name: 'mark_criteria_passed',
    description:
      'Convenience method to mark acceptance criteria as passed. If no criteriaIds provided, marks ALL criteria as passed.',
    inputSchema: {
      type: 'object',
      properties: {
        storyId: { type: 'string', description: 'The story ID' },
        criteriaIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific criteria IDs to mark as passed. Omit to mark ALL as passed.',
        },
      },
      required: ['storyId'],
    },
  },

  // ── Bulk Operations ──
  {
    name: 'batch_create_stories',
    description:
      'Create multiple stories at once, either standalone or within a PRD. More efficient than creating one at a time. Returns all created story IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        workspacePath: {
          type: 'string',
          description: 'Workspace path (required for standalone stories)',
        },
        prdId: {
          type: 'string',
          description: 'PRD ID to attach stories to. Omit for standalone.',
        },
        stories: {
          type: 'array',
          description: 'Array of stories to create',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              acceptanceCriteria: { type: 'array', items: { type: 'string' } },
              priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
              dependsOn: { type: 'array', items: { type: 'string' } },
              researchOnly: { type: 'boolean' },
            },
            required: ['title'],
          },
        },
      },
      required: ['stories'],
    },
  },
  {
    name: 'batch_update_stories',
    description:
      'Update multiple stories at once. Each entry specifies a storyId and the fields to update.',
    inputSchema: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          description: 'Array of story updates',
          items: {
            type: 'object',
            properties: {
              storyId: { type: 'string' },
              title: { type: 'string' },
              description: { type: 'string' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'qa', 'completed', 'failed', 'archived', 'paused'],
              },
              priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
              acceptanceCriteria: { type: 'array', items: { type: 'string' } },
              dependsOn: { type: 'array', items: { type: 'string' } },
              researchOnly: { type: 'boolean' },
              learnings: { type: 'array', items: { type: 'string' } },
            },
            required: ['storyId'],
          },
        },
      },
      required: ['updates'],
    },
  },

  // ── Loop / Golem Management ──
  {
    name: 'list_loops',
    description: 'List active and recent automation loops (Golem runs).',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['running', 'paused', 'completed', 'failed', 'cancelled', 'idle'],
          description: 'Filter by loop status. Omit for all.',
        },
      },
    },
  },
  {
    name: 'get_loop',
    description: 'Get details of a specific automation loop including current progress.',
    inputSchema: {
      type: 'object',
      properties: {
        loopId: { type: 'string', description: 'The loop ID' },
      },
      required: ['loopId'],
    },
  },

  // ── Canvas Management ──
  {
    name: 'canvas_push',
    description:
      'Push visual content to the Canvas panel. Supports HTML, SVG, Mermaid diagrams, and data tables. Content appears in the Canvas sidebar tab and can be expanded or viewed fullscreen. Use canvas_id to update an existing canvas.',
    inputSchema: {
      type: 'object',
      properties: {
        content_type: {
          type: 'string',
          enum: ['html', 'svg', 'mermaid', 'table'],
          description:
            'Content type: html (rich layouts), svg (vector graphics), mermaid (diagrams/flowcharts), table (JSON array rendered as data grid)',
        },
        content: {
          type: 'string',
          description:
            'The content to render. For html: raw HTML string. For svg: SVG markup. For mermaid: Mermaid diagram syntax. For table: JSON array of objects (each object is a row, keys are column headers).',
        },
        title: {
          type: 'string',
          description: 'Display title for the canvas item',
        },
        canvas_id: {
          type: 'string',
          description: 'Optional ID to update an existing canvas instead of creating a new one',
        },
        conversation_id: {
          type: 'string',
          description:
            'Conversation ID to associate this canvas with. Required for the canvas to appear in the sidebar when that conversation is active.',
        },
      },
      required: ['content_type', 'content'],
    },
  },
  {
    name: 'canvas_list',
    description:
      'List all canvases for a conversation. Returns canvas IDs, titles, content types, and timestamps.',
    inputSchema: {
      type: 'object',
      properties: {
        conversation_id: {
          type: 'string',
          description: 'The conversation ID to list canvases for',
        },
      },
      required: ['conversation_id'],
    },
  },
];

// ── Tool Handlers ──

async function handleToolCall(
  name: string,
  args: Record<string, any>,
): Promise<{ content: any[]; isError?: boolean }> {
  const d = getDb();

  try {
    switch (name) {
      // ── PRD Management ──

      case 'list_prds': {
        const rows = d
          .query('SELECT * FROM prds WHERE workspace_path = ? ORDER BY updated_at DESC')
          .all(args.workspacePath) as any[];

        const prds = rows.map((row) => {
          const storyCount =
            (
              d
                .query('SELECT COUNT(*) as count FROM prd_stories WHERE prd_id = ?')
                .get(row.id) as any
            )?.count ?? 0;
          return { ...prdFromRow(row), storyCount };
        });

        return { content: [{ type: 'text', text: JSON.stringify(prds, null, 2) }] };
      }

      case 'get_prd': {
        const row = d.query('SELECT * FROM prds WHERE id = ?').get(args.prdId) as any;
        if (!row) return error(`PRD not found: ${args.prdId}`);

        const storyRows = d
          .query(
            'SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC',
          )
          .all(args.prdId) as any[];

        const prd = { ...prdFromRow(row), stories: storyRows.map(storyFromRow) };
        return { content: [{ type: 'text', text: JSON.stringify(prd, null, 2) }] };
      }

      case 'create_prd': {
        const prdId = nanoid(12);
        const now = Date.now();

        d.query(
          `INSERT INTO prds (id, workspace_path, name, description, branch_name, quality_checks, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          prdId,
          args.workspacePath,
          args.name,
          args.description || '',
          args.branchName || null,
          JSON.stringify(args.qualityChecks || []),
          now,
          now,
        );

        const storyIds: string[] = [];
        if (args.stories?.length) {
          const storyInsert = d.query(
            `INSERT INTO prd_stories (id, prd_id, title, description, acceptance_criteria, priority, depends_on, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          for (let i = 0; i < args.stories.length; i++) {
            const s = args.stories[i];
            const sid = nanoid(12);
            storyIds.push(sid);
            const criteria = (s.acceptanceCriteria || []).map((desc: string) => ({
              id: nanoid(8),
              description: desc,
              passed: false,
            }));
            storyInsert.run(
              sid,
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
        }

        return {
          content: [{ type: 'text', text: JSON.stringify({ id: prdId, storyIds }) }],
        };
      }

      case 'update_prd': {
        const existing = d.query('SELECT * FROM prds WHERE id = ?').get(args.prdId);
        if (!existing) return error(`PRD not found: ${args.prdId}`);

        const updates: string[] = [];
        const values: any[] = [];
        if (args.name !== undefined) {
          updates.push('name = ?');
          values.push(args.name);
        }
        if (args.description !== undefined) {
          updates.push('description = ?');
          values.push(args.description);
        }
        if (args.branchName !== undefined) {
          updates.push('branch_name = ?');
          values.push(args.branchName);
        }
        if (args.workflowConfig !== undefined) {
          updates.push('workflow_config = ?');
          values.push(JSON.stringify(args.workflowConfig));
        }
        if (updates.length > 0) {
          updates.push('updated_at = ?');
          values.push(Date.now());
          values.push(args.prdId);
          d.query(`UPDATE prds SET ${updates.join(', ')} WHERE id = ?`).run(...values);
        }
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
      }

      case 'delete_prd': {
        d.query('DELETE FROM prd_stories WHERE prd_id = ?').run(args.prdId);
        d.query('DELETE FROM prds WHERE id = ?').run(args.prdId);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
      }

      // ── Story Management ──

      case 'list_stories': {
        let rows: any[];

        if (args.includeAll) {
          // All stories for workspace (standalone + PRD-bound)
          const standalone = d
            .query(
              'SELECT * FROM prd_stories WHERE prd_id IS NULL AND workspace_path = ? ORDER BY sort_order ASC',
            )
            .all(args.workspacePath) as any[];
          const prdBound = d
            .query(
              `SELECT ps.*, p.name as prd_name FROM prd_stories ps
               JOIN prds p ON ps.prd_id = p.id
               WHERE p.workspace_path = ?
               ORDER BY ps.prd_id, ps.sort_order ASC`,
            )
            .all(args.workspacePath) as any[];
          rows = [...standalone, ...prdBound.map((r: any) => ({ ...r, _prdName: r.prd_name }))];
        } else if (args.prdId) {
          rows = d
            .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC')
            .all(args.prdId) as any[];
        } else {
          rows = d
            .query(
              'SELECT * FROM prd_stories WHERE prd_id IS NULL AND workspace_path = ? ORDER BY sort_order ASC',
            )
            .all(args.workspacePath) as any[];
        }

        if (args.status) {
          rows = rows.filter((r: any) => r.status === args.status);
        }

        const stories = rows.map((r: any) => {
          const s = storyFromRow(r);
          if (r._prdName) (s as any).prdName = r._prdName;
          return s;
        });

        return { content: [{ type: 'text', text: JSON.stringify(stories, null, 2) }] };
      }

      case 'create_story': {
        const id = nanoid(12);
        const now = Date.now();
        const prdId = args.prdId || null;
        const workspacePath = args.workspacePath || null;

        // Get max sort_order
        let maxRow: any;
        if (prdId) {
          maxRow = d
            .query('SELECT MAX(sort_order) as max_order FROM prd_stories WHERE prd_id = ?')
            .get(prdId);
        } else {
          maxRow = d
            .query(
              'SELECT MAX(sort_order) as max_order FROM prd_stories WHERE prd_id IS NULL AND workspace_path = ?',
            )
            .get(workspacePath);
        }
        const sortOrder = (maxRow?.max_order ?? -1) + 1;

        const criteria = (args.acceptanceCriteria || []).map((desc: string) => ({
          id: nanoid(6),
          description: desc,
          passed: false,
        }));

        d.query(
          `INSERT INTO prd_stories (
            id, prd_id, workspace_path, title, description, acceptance_criteria,
            priority, depends_on, dependency_reasons, status, research_only,
            attempts, max_attempts, learnings, sort_order, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 'pending', ?, 0, 3, '[]', ?, ?, ?)`,
        ).run(
          id,
          prdId,
          workspacePath,
          args.title,
          args.description || '',
          JSON.stringify(criteria),
          args.priority || 'medium',
          JSON.stringify(args.dependsOn || []),
          args.researchOnly ? 1 : 0,
          sortOrder,
          now,
          now,
        );

        const row = d.query('SELECT * FROM prd_stories WHERE id = ?').get(id) as any;
        return {
          content: [{ type: 'text', text: JSON.stringify(storyFromRow(row), null, 2) }],
        };
      }

      case 'update_story': {
        const { storyId, prdId: _prdId, ...fields } = args;
        const existing = d.query('SELECT * FROM prd_stories WHERE id = ?').get(storyId) as any;
        if (!existing) return error(`Story not found: ${storyId}`);

        const updates: string[] = [];
        const values: any[] = [];

        if (fields.title !== undefined) {
          updates.push('title = ?');
          values.push(fields.title);
        }
        if (fields.description !== undefined) {
          updates.push('description = ?');
          values.push(fields.description);
        }
        if (fields.status !== undefined) {
          updates.push('status = ?');
          values.push(fields.status);
        }
        if (fields.priority !== undefined) {
          updates.push('priority = ?');
          values.push(fields.priority);
        }
        if (fields.acceptanceCriteria !== undefined) {
          const criteria = fields.acceptanceCriteria.map((desc: string) => ({
            id: nanoid(6),
            description: desc,
            passed: false,
          }));
          updates.push('acceptance_criteria = ?');
          values.push(JSON.stringify(criteria));
        }
        if (fields.dependsOn !== undefined) {
          updates.push('depends_on = ?');
          values.push(JSON.stringify(fields.dependsOn));
        }
        if (fields.researchOnly !== undefined) {
          updates.push('research_only = ?');
          values.push(fields.researchOnly ? 1 : 0);
        }
        if (fields.learnings !== undefined) {
          updates.push('learnings = ?');
          values.push(JSON.stringify(fields.learnings));
        }

        if (updates.length > 0) {
          updates.push('updated_at = ?');
          values.push(Date.now());
          values.push(storyId);
          d.query(`UPDATE prd_stories SET ${updates.join(', ')} WHERE id = ?`).run(...values);
        }

        const updated = d.query('SELECT * FROM prd_stories WHERE id = ?').get(storyId) as any;
        return {
          content: [{ type: 'text', text: JSON.stringify(storyFromRow(updated), null, 2) }],
        };
      }

      case 'delete_story': {
        // Remove this story from other stories' dependsOn lists
        const allStories = d.query('SELECT id, depends_on FROM prd_stories').all() as any[];
        for (const s of allStories) {
          const deps = JSON.parse(s.depends_on || '[]');
          if (deps.includes(args.storyId)) {
            const newDeps = deps.filter((d: string) => d !== args.storyId);
            d.query('UPDATE prd_stories SET depends_on = ? WHERE id = ?').run(
              JSON.stringify(newDeps),
              s.id,
            );
          }
        }
        d.query('DELETE FROM prd_stories WHERE id = ?').run(args.storyId);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
      }

      case 'reorder_stories': {
        const { storyIds } = args;
        for (let i = 0; i < storyIds.length; i++) {
          d.query('UPDATE prd_stories SET sort_order = ?, updated_at = ? WHERE id = ?').run(
            i,
            Date.now(),
            storyIds[i],
          );
        }
        return {
          content: [
            { type: 'text', text: JSON.stringify({ ok: true, reordered: storyIds.length }) },
          ],
        };
      }

      case 'archive_completed_stories': {
        let result: any;
        if (args.prdId) {
          result = d
            .query(
              "UPDATE prd_stories SET status = 'archived', updated_at = ? WHERE prd_id = ? AND status = 'completed'",
            )
            .run(Date.now(), args.prdId);
        } else if (args.workspacePath) {
          result = d
            .query(
              "UPDATE prd_stories SET status = 'archived', updated_at = ? WHERE prd_id IS NULL AND workspace_path = ? AND status = 'completed'",
            )
            .run(Date.now(), args.workspacePath);
        } else {
          return error('Either workspacePath or prdId is required');
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: true, archived: result.changes }) }],
        };
      }

      // ── Story Completion & Search ──

      case 'complete_story': {
        const { storyId, passAllCriteria = true, learnings: newLearnings, summary } = args;
        const existing = d.query('SELECT * FROM prd_stories WHERE id = ?').get(storyId) as any;
        if (!existing) return error(`Story not found: ${storyId}`);

        const now = Date.now();
        const updates: string[] = ["status = 'completed'"];
        const values: any[] = [];

        // Auto-pass all acceptance criteria if requested
        if (passAllCriteria) {
          const criteria = JSON.parse(existing.acceptance_criteria || '[]');
          const passedCriteria = criteria.map((c: any) => ({ ...c, passed: true }));
          updates.push('acceptance_criteria = ?');
          values.push(JSON.stringify(passedCriteria));
        }

        // Merge learnings: existing + optional summary + new learnings
        const existingLearnings = JSON.parse(existing.learnings || '[]');
        const mergedLearnings = [...existingLearnings];
        if (summary) mergedLearnings.push(summary);
        if (newLearnings?.length) mergedLearnings.push(...newLearnings);
        if (mergedLearnings.length > existingLearnings.length) {
          updates.push('learnings = ?');
          values.push(JSON.stringify(mergedLearnings));
        }

        updates.push('updated_at = ?');
        values.push(now);
        values.push(storyId);
        d.query(`UPDATE prd_stories SET ${updates.join(', ')} WHERE id = ?`).run(...values);

        const updated = d.query('SELECT * FROM prd_stories WHERE id = ?').get(storyId) as any;
        return {
          content: [{ type: 'text', text: JSON.stringify(storyFromRow(updated), null, 2) }],
        };
      }

      case 'find_stories': {
        const { workspacePath, query, prdId, status, limit = 10 } = args;
        const searchPattern = `%${query}%`;

        let sql: string;
        const params: any[] = [];

        if (prdId) {
          // Search within a specific PRD
          sql = `SELECT * FROM prd_stories WHERE prd_id = ? AND (title LIKE ? OR description LIKE ?)`;
          params.push(prdId, searchPattern, searchPattern);
        } else {
          // Search across workspace: standalone + PRD-bound
          sql = `SELECT ps.* FROM prd_stories ps
                 LEFT JOIN prds p ON ps.prd_id = p.id
                 WHERE (ps.workspace_path = ? OR p.workspace_path = ?)
                 AND (ps.title LIKE ? OR ps.description LIKE ?)`;
          params.push(workspacePath, workspacePath, searchPattern, searchPattern);
        }

        if (status) {
          sql += ` AND ps.status = ?`;
          params.push(status);
        }

        sql += ` ORDER BY ps.updated_at DESC LIMIT ?`;
        params.push(limit);

        const rows = d.query(sql).all(...params) as any[];
        const stories = rows.map(storyFromRow);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ query, matched: stories.length, limit, stories }, null, 2),
            },
          ],
        };
      }

      case 'update_acceptance_criteria': {
        const { storyId, updates: criteriaUpdates } = args;
        const existing = d.query('SELECT * FROM prd_stories WHERE id = ?').get(storyId) as any;
        if (!existing) return error(`Story not found: ${storyId}`);

        const criteria: Array<{ id: string; description: string; passed: boolean }> = JSON.parse(
          existing.acceptance_criteria || '[]',
        );
        const criteriaMap = new Map(criteria.map((c) => [c.id, c]));

        // Validate all criteria IDs exist
        const invalidIds = criteriaUpdates
          .filter((u: any) => !criteriaMap.has(u.criteriaId))
          .map((u: any) => u.criteriaId);
        if (invalidIds.length > 0) {
          return error(`Criteria not found: ${invalidIds.join(', ')}`);
        }

        // Apply updates
        for (const update of criteriaUpdates) {
          const criterion = criteriaMap.get(update.criteriaId);
          if (criterion) criterion.passed = update.passed;
        }

        const updatedCriteria = Array.from(criteriaMap.values());
        const now = Date.now();
        d.query('UPDATE prd_stories SET acceptance_criteria = ?, updated_at = ? WHERE id = ?').run(
          JSON.stringify(updatedCriteria),
          now,
          storyId,
        );

        const updated = d.query('SELECT * FROM prd_stories WHERE id = ?').get(storyId) as any;
        return {
          content: [{ type: 'text', text: JSON.stringify(storyFromRow(updated), null, 2) }],
        };
      }

      case 'mark_criteria_passed': {
        const { storyId, criteriaIds } = args;
        const existing = d.query('SELECT * FROM prd_stories WHERE id = ?').get(storyId) as any;
        if (!existing) return error(`Story not found: ${storyId}`);

        const criteria = JSON.parse(existing.acceptance_criteria || '[]');

        if (criteriaIds?.length) {
          // Validate specified criteria IDs exist
          const criteriaIdSet = new Set(criteria.map((c: any) => c.id));
          const invalidIds = criteriaIds.filter((id: string) => !criteriaIdSet.has(id));
          if (invalidIds.length > 0) {
            return error(`Criteria not found: ${invalidIds.join(', ')}`);
          }
          // Mark only specified criteria as passed
          const targetSet = new Set(criteriaIds);
          for (const c of criteria) {
            if (targetSet.has(c.id)) c.passed = true;
          }
        } else {
          // Mark ALL criteria as passed
          for (const c of criteria) {
            c.passed = true;
          }
        }

        const now = Date.now();
        d.query('UPDATE prd_stories SET acceptance_criteria = ?, updated_at = ? WHERE id = ?').run(
          JSON.stringify(criteria),
          now,
          storyId,
        );

        const updated = d.query('SELECT * FROM prd_stories WHERE id = ?').get(storyId) as any;
        const passedCount = JSON.parse(updated.acceptance_criteria || '[]').filter(
          (c: any) => c.passed,
        ).length;
        const totalCount = JSON.parse(updated.acceptance_criteria || '[]').length;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ...storyFromRow(updated),
                  _summary: `${passedCount}/${totalCount} criteria now passed`,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── Bulk Operations ──

      case 'batch_create_stories': {
        const now = Date.now();
        const prdId = args.prdId || null;
        const workspacePath = args.workspacePath || null;

        // Get current max sort_order
        let maxRow: any;
        if (prdId) {
          maxRow = d
            .query('SELECT MAX(sort_order) as max_order FROM prd_stories WHERE prd_id = ?')
            .get(prdId);
        } else {
          maxRow = d
            .query(
              'SELECT MAX(sort_order) as max_order FROM prd_stories WHERE prd_id IS NULL AND workspace_path = ?',
            )
            .get(workspacePath);
        }
        let sortOrder = (maxRow?.max_order ?? -1) + 1;

        const insert = d.query(
          `INSERT INTO prd_stories (
            id, prd_id, workspace_path, title, description, acceptance_criteria,
            priority, depends_on, dependency_reasons, status, research_only,
            attempts, max_attempts, learnings, sort_order, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 'pending', ?, 0, 3, '[]', ?, ?, ?)`,
        );

        const createdIds: string[] = [];
        for (const s of args.stories) {
          const id = nanoid(12);
          createdIds.push(id);
          const criteria = (s.acceptanceCriteria || []).map((desc: string) => ({
            id: nanoid(6),
            description: desc,
            passed: false,
          }));
          insert.run(
            id,
            prdId,
            workspacePath,
            s.title,
            s.description || '',
            JSON.stringify(criteria),
            s.priority || 'medium',
            JSON.stringify(s.dependsOn || []),
            s.researchOnly ? 1 : 0,
            sortOrder++,
            now,
            now,
          );
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: true, storyIds: createdIds, count: createdIds.length }),
            },
          ],
        };
      }

      case 'batch_update_stories': {
        const results: any[] = [];
        for (const update of args.updates) {
          // Reuse single-update logic inline
          const { storyId, ...fields } = update;
          const existing = d.query('SELECT * FROM prd_stories WHERE id = ?').get(storyId) as any;
          if (!existing) {
            results.push({ storyId, error: 'not found' });
            continue;
          }

          const ups: string[] = [];
          const vals: any[] = [];
          if (fields.title !== undefined) {
            ups.push('title = ?');
            vals.push(fields.title);
          }
          if (fields.description !== undefined) {
            ups.push('description = ?');
            vals.push(fields.description);
          }
          if (fields.status !== undefined) {
            ups.push('status = ?');
            vals.push(fields.status);
          }
          if (fields.priority !== undefined) {
            ups.push('priority = ?');
            vals.push(fields.priority);
          }
          if (fields.acceptanceCriteria !== undefined) {
            const criteria = fields.acceptanceCriteria.map((desc: string) => ({
              id: nanoid(6),
              description: desc,
              passed: false,
            }));
            ups.push('acceptance_criteria = ?');
            vals.push(JSON.stringify(criteria));
          }
          if (fields.dependsOn !== undefined) {
            ups.push('depends_on = ?');
            vals.push(JSON.stringify(fields.dependsOn));
          }
          if (fields.researchOnly !== undefined) {
            ups.push('research_only = ?');
            vals.push(fields.researchOnly ? 1 : 0);
          }
          if (fields.learnings !== undefined) {
            ups.push('learnings = ?');
            vals.push(JSON.stringify(fields.learnings));
          }

          if (ups.length > 0) {
            ups.push('updated_at = ?');
            vals.push(Date.now());
            vals.push(storyId);
            d.query(`UPDATE prd_stories SET ${ups.join(', ')} WHERE id = ?`).run(...vals);
          }
          results.push({ storyId, ok: true });
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ results }) }],
        };
      }

      // ── Loop Management ──

      case 'list_loops': {
        let rows: any[];
        if (args.status) {
          rows = d
            .query('SELECT * FROM loops WHERE status = ? ORDER BY started_at DESC')
            .all(args.status) as any[];
        } else {
          rows = d.query('SELECT * FROM loops ORDER BY started_at DESC LIMIT 20').all() as any[];
        }
        return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
      }

      case 'get_loop': {
        const row = d.query('SELECT * FROM loops WHERE id = ?').get(args.loopId);
        if (!row) return error(`Loop not found: ${args.loopId}`);
        return { content: [{ type: 'text', text: JSON.stringify(row, null, 2) }] };
      }

      // ── Canvas Management ──

      case 'canvas_push': {
        const res = canvasPush({
          content_type: args.content_type,
          content: args.content,
          title: args.title,
          canvas_id: args.canvas_id,
          conversation_id: args.conversation_id,
        });
        if (!res.ok) {
          return error(res.error || 'Canvas push failed');
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  canvasId: res.data.id,
                  contentType: res.data.contentType,
                  title: res.data.title,
                  message: `Canvas "${res.data.title || 'Untitled'}" pushed. Open the Canvas sidebar tab to view it.`,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      case 'canvas_list': {
        const res = canvasListFromDb(args.conversation_id);
        if (!res.ok) {
          return error(res.error || 'Canvas list failed');
        }
        const summary = (res.data || []).map((c: any) => ({
          id: c.id,
          contentType: c.contentType,
          title: c.title || 'Untitled',
          lastUpdated: c.lastUpdated,
        }));
        return {
          content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
        };
      }

      default:
        return error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return error(`Tool execution error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function error(message: string) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

// ── JSON-RPC stdio Protocol ──

function send(obj: any) {
  const json = JSON.stringify(obj);
  process.stdout.write(json + '\n');
}

const rl = createInterface({ input: process.stdin });

rl.on('line', async (line) => {
  let request: any;
  try {
    request = JSON.parse(line);
  } catch {
    return; // Ignore malformed input
  }

  const { id, method, params } = request;

  switch (method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'e-work', version: '1.0.0' },
        },
      });
      break;

    case 'notifications/initialized':
      // Client acknowledgement — no response needed
      break;

    case 'tools/list':
      send({
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS },
      });
      break;

    case 'tools/call': {
      const { name, arguments: args } = params;
      const result = await handleToolCall(name, args || {});
      send({
        jsonrpc: '2.0',
        id,
        result,
      });
      break;
    }

    default:
      send({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
  }
});

// Keep alive until stdin closes
rl.on('close', () => {
  if (db) db.close();
  process.exit(0);
});
