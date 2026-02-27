/**
 * Pattern Detection API Routes
 *
 * Endpoints for pattern detection, learning logs, and skill/rule proposals.
 */

import { Hono } from 'hono';
import {
  detectPatterns,
  shouldProposeSkillOrRule,
  logLearning,
  getLearningLog,
  getDetectedPatterns,
  getProposals,
  markPatternProposed,
} from '../services/pattern-detection';
import { generateProposal, approveProposal, rejectProposal } from '../services/proposal-generator';
import { getDb } from '../db/database';
import { nanoid } from 'nanoid';
import type { PatternSensitivity, PatternType } from '@e/shared';

const app = new Hono();

/**
 * POST /api/pattern-detection/analyze
 * Analyze a conversation for patterns
 */
app.post('/analyze', async (c) => {
  try {
    const body = await c.req.json();
    const { workspacePath, conversationId, sensitivity = 'moderate', enabledTypes } = body;

    if (!workspacePath || !conversationId) {
      return c.json({ ok: false, error: 'workspacePath and conversationId required' }, 400);
    }

    const patterns = await detectPatterns(
      workspacePath,
      conversationId,
      sensitivity as PatternSensitivity,
      enabledTypes as PatternType[],
    );

    return c.json({ ok: true, data: patterns });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: `Failed to analyze patterns: ${msg}` }, 500);
  }
});

/**
 * GET /api/pattern-detection/patterns?workspacePath=...
 * Get all detected patterns for a workspace
 */
app.get('/patterns', async (c) => {
  try {
    const workspacePath = c.req.query('workspacePath');
    if (!workspacePath) {
      return c.json({ ok: false, error: 'workspacePath required' }, 400);
    }

    const patterns = getDetectedPatterns(workspacePath);
    return c.json({ ok: true, data: patterns });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 500);
  }
});

/**
 * POST /api/pattern-detection/propose
 * Generate a skill or rule proposal from a pattern
 */
app.post('/propose', async (c) => {
  try {
    const body = await c.req.json();
    const { patternId, proposalType = 'skill', createNote = true } = body;

    if (!patternId) {
      return c.json({ ok: false, error: 'patternId required' }, 400);
    }

    // Get the pattern
    const db = getDb();
    const pattern = db.query('SELECT * FROM pattern_detections WHERE id = ?').get(patternId) as any;

    if (!pattern) {
      return c.json({ ok: false, error: 'Pattern not found' }, 404);
    }

    // Convert DB row to PatternDetection
    const detectedPattern = {
      id: pattern.id,
      workspacePath: pattern.workspace_path,
      patternType: pattern.pattern_type,
      description: pattern.description,
      occurrences: pattern.occurrences,
      tools: JSON.parse(pattern.tools || '[]'),
      examples: JSON.parse(pattern.examples || '[]'),
      conversationIds: JSON.parse(pattern.conversation_ids || '[]'),
      confidence: pattern.confidence,
      firstSeen: pattern.first_seen,
      lastSeen: pattern.last_seen,
      proposalCreated: !!pattern.proposal_created,
    };

    // Generate proposal
    const proposal = await generateProposal(detectedPattern, proposalType);

    // Create agent note if requested
    if (createNote) {
      const noteId = nanoid();
      const now = Date.now();

      db.query(
        `INSERT INTO agent_notes
         (id, workspace_path, title, content, category, status, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'skill-proposal', 'unread', ?, ?, ?)`,
      ).run(
        noteId,
        pattern.workspace_path,
        `💡 Skill Proposal: ${proposal.name}`,
        `## ${proposal.name}

${proposal.description}

### Pattern Detected

- **Type**: ${detectedPattern.patternType}
- **Description**: ${detectedPattern.description}
- **Occurrences**: ${detectedPattern.occurrences}
- **Confidence**: ${(detectedPattern.confidence * 100).toFixed(0)}%

---

**Proposal ID**: \`${proposal.id}\`

To approve this proposal, use the Pattern Detection panel or call:
\`\`\`
POST /api/pattern-detection/proposals/${proposal.id}/approve
\`\`\`

To review the full content:
\`\`\`
GET /api/pattern-detection/proposals/${proposal.id}
\`\`\`
`,
        JSON.stringify({ proposalId: proposal.id, patternId }),
        now,
        now,
      );

      // Note: skill_proposals table doesn't have note_id column in the new schema
    }

    // Mark pattern as proposed
    markPatternProposed(patternId);

    return c.json({ ok: true, data: proposal });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: `Failed to create proposal: ${msg}` }, 500);
  }
});

/**
 * GET /api/pattern-detection/proposals?workspacePath=...&status=...
 * Get skill/rule proposals
 */
app.get('/proposals', async (c) => {
  try {
    const workspacePath = c.req.query('workspacePath');
    const status = c.req.query('status');

    if (!workspacePath) {
      return c.json({ ok: false, error: 'workspacePath required' }, 400);
    }

    const proposals = getProposals(workspacePath, status);
    return c.json({ ok: true, data: proposals });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 500);
  }
});

/**
 * GET /api/pattern-detection/proposals/:id
 * Get a specific proposal
 */
app.get('/proposals/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const db = getDb();

    const row = db.query('SELECT * FROM skill_proposals WHERE id = ?').get(id) as any;

    if (!row) {
      return c.json({ ok: false, error: 'Proposal not found' }, 404);
    }

    const proposal = {
      id: row.id,
      workspacePath: row.workspace_path,
      patternId: row.pattern_id,
      proposalType: row.proposal_type,
      status: row.status,
      name: row.name,
      description: row.description,
      content: row.content,
      metadata: JSON.parse(row.metadata || '{}'),
      installedPath: row.installed_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    return c.json({ ok: true, data: proposal });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 500);
  }
});

/**
 * POST /api/pattern-detection/proposals/:id/approve
 * Approve and install a proposal
 */
app.post('/proposals/:id/approve', async (c) => {
  try {
    const id = c.req.param('id');
    const result = await approveProposal(id);

    if (result.success) {
      return c.json({ ok: true, data: { path: result.path } });
    } else {
      return c.json({ ok: false, error: result.error }, 400);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 500);
  }
});

/**
 * POST /api/pattern-detection/proposals/:id/reject
 * Reject a proposal
 */
app.post('/proposals/:id/reject', async (c) => {
  try {
    const id = c.req.param('id');
    const result = await rejectProposal(id);

    if (result.success) {
      return c.json({ ok: true });
    } else {
      return c.json({ ok: false, error: 'Failed to reject proposal' }, 400);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 500);
  }
});

/**
 * POST /api/pattern-detection/learning-log
 * Add a learning log entry
 */
app.post('/learning-log', async (c) => {
  try {
    const body = await c.req.json();
    const { workspacePath, message, eventType, relatedId, metadata = {} } = body;

    if (!workspacePath || !message || !eventType) {
      return c.json(
        {
          ok: false,
          error: 'workspacePath, message, and eventType required',
        },
        400,
      );
    }

    const entry = logLearning(workspacePath, message, eventType, relatedId, metadata);

    return c.json({ ok: true, data: entry });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 500);
  }
});

/**
 * GET /api/pattern-detection/learning-log?workspacePath=...
 * Get learning log entries
 */
app.get('/learning-log', async (c) => {
  try {
    const workspacePath = c.req.query('workspacePath');
    const limit = parseInt(c.req.query('limit') || '50', 10);

    if (!workspacePath) {
      return c.json({ ok: false, error: 'workspacePath required' }, 400);
    }

    const entries = getLearningLog(workspacePath, limit);
    return c.json({ ok: true, data: entries });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 500);
  }
});

/**
 * POST /api/pattern-detection/check-and-propose
 * Check patterns and auto-propose if thresholds are met
 */
app.post('/check-and-propose', async (c) => {
  try {
    const body = await c.req.json();
    const { workspacePath, minOccurrences = 3, autoCreateNotes = true } = body;

    if (!workspacePath) {
      return c.json({ ok: false, error: 'workspacePath required' }, 400);
    }

    const patterns = getDetectedPatterns(workspacePath);
    const proposalsMade = [];

    for (const pattern of patterns) {
      if (shouldProposeSkillOrRule(pattern, minOccurrences)) {
        // Generate proposal
        const proposal = await generateProposal(pattern, 'skill');

        // Create agent note if requested
        if (autoCreateNotes) {
          const db = getDb();
          const noteId = nanoid();
          const now = Date.now();

          db.query(
            `INSERT INTO agent_notes
             (id, workspace_path, title, content, category, status, metadata, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'skill-proposal', 'unread', ?, ?, ?)`,
          ).run(
            noteId,
            workspacePath,
            `💡 Skill Proposal: ${proposal.name}`,
            `## ${proposal.name}

${proposal.description}

**Proposal ID**: \`${proposal.id}\`
`,
            JSON.stringify({ proposalId: proposal.id, patternId: pattern.id }),
            now,
            now,
          );

          // Note: skill_proposals table doesn't have note_id column in the new schema
        }

        markPatternProposed(pattern.id);
        proposalsMade.push(proposal);
      }
    }

    return c.json({ ok: true, data: { proposalsMade, count: proposalsMade.length } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 500);
  }
});

export { app as patternDetectionRoutes };
