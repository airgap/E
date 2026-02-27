/**
 * Pattern Detection Service
 *
 * Analyzes conversation history to detect recurring patterns and propose
 * new skills or rules to automate them.
 */

import { getDb } from '../db/database';
import { nanoid } from 'nanoid';
import type {
  PatternDetection,
  PatternType,
  PatternSensitivity,
  LearningLogEntry,
  SkillProposal,
  ProposalType,
} from '@e/shared';

interface Message {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  timestamp: number;
}

interface PatternMatch {
  type: PatternType;
  summary: string;
  description: string;
  messageIds: string[];
  confidence: number;
}

/**
 * Analyze conversation messages for recurring patterns
 */
export async function detectPatterns(
  workspacePath: string,
  conversationId: string,
  sensitivity: PatternSensitivity = 'moderate',
  enabledTypes: PatternType[] = [
    'refactoring',
    'workflow',
    'tool-usage',
    'problem-solving',
    'file-pattern',
    'command-sequence',
  ],
): Promise<PatternDetection[]> {
  const db = getDb();

  // Get recent messages from this conversation
  const messages = db
    .query(
      `SELECT id, conversation_id, role, content, timestamp
       FROM messages
       WHERE conversation_id = ?
       ORDER BY timestamp DESC
       LIMIT 100`,
    )
    .all(conversationId) as Message[];

  if (messages.length < 5) {
    return []; // Not enough data to detect patterns
  }

  // Analyze messages for patterns
  const matches = await analyzeForPatterns(messages, enabledTypes, sensitivity);

  // Update or create pattern records
  const patterns: PatternDetection[] = [];
  const now = Date.now();

  for (const match of matches) {
    // Check if similar pattern already exists
    const existing = db
      .query(
        `SELECT * FROM pattern_detections
         WHERE workspace_path = ? AND pattern_type = ? AND description = ?`,
      )
      .get(workspacePath, match.type, match.description) as any;

    if (existing) {
      // Update existing pattern
      const conversationIds = JSON.parse(existing.conversation_ids);
      if (!conversationIds.includes(conversationId)) {
        conversationIds.push(conversationId);
      }

      db.query(
        `UPDATE pattern_detections
         SET occurrences = occurrences + 1,
             conversation_ids = ?,
             confidence = ?,
             last_seen = ?,
             updated_at = ?
         WHERE id = ?`,
      ).run(
        JSON.stringify(conversationIds),
        Math.min(existing.confidence + 0.1, 1.0),
        now,
        now,
        existing.id,
      );

      patterns.push({
        id: existing.id,
        workspacePath,
        patternType: match.type,
        description: match.description,
        occurrences: existing.occurrences + 1,
        tools: JSON.parse(existing.tools || '[]'),
        examples: JSON.parse(existing.examples || '[]'),
        conversationIds,
        confidence: Math.min(existing.confidence + 0.1, 1.0),
        firstSeen: existing.first_seen,
        lastSeen: now,
        proposalCreated: !!existing.proposal_created,
      });
    } else {
      // Create new pattern
      const id = nanoid();
      db.query(
        `INSERT INTO pattern_detections
         (id, workspace_path, pattern_type, description, occurrences,
          tools, examples, conversation_ids, confidence, first_seen, last_seen,
          proposal_created, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, '[]', '[]', ?, ?, ?, ?, 0, ?, ?)`,
      ).run(
        id,
        workspacePath,
        match.type,
        match.description,
        JSON.stringify([conversationId]),
        match.confidence,
        now,
        now,
        now,
        now,
      );

      patterns.push({
        id,
        workspacePath,
        patternType: match.type,
        description: match.description,
        occurrences: 1,
        tools: [],
        examples: [],
        conversationIds: [conversationId],
        confidence: match.confidence,
        firstSeen: now,
        lastSeen: now,
        proposalCreated: false,
      });
    }
  }

  return patterns;
}

/**
 * Analyze messages to find pattern matches
 */
async function analyzeForPatterns(
  messages: Message[],
  enabledTypes: PatternType[],
  sensitivity: PatternSensitivity,
): Promise<PatternMatch[]> {
  const matches: PatternMatch[] = [];

  // Sensitivity determines the confidence threshold
  const confidenceThreshold = {
    conservative: 0.8,
    moderate: 0.6,
    aggressive: 0.4,
  }[sensitivity];

  // Extract assistant messages (agent's actions)
  const assistantMessages = messages.filter((m) => m.role === 'assistant');

  // Pattern 1: Refactoring patterns
  if (enabledTypes.includes('refactoring')) {
    const refactoringMatch = detectRefactoringPattern(assistantMessages);
    if (refactoringMatch && refactoringMatch.confidence >= confidenceThreshold) {
      matches.push(refactoringMatch);
    }
  }

  // Pattern 2: Workflow patterns
  if (enabledTypes.includes('workflow')) {
    const workflowMatch = detectWorkflowPattern(assistantMessages);
    if (workflowMatch && workflowMatch.confidence >= confidenceThreshold) {
      matches.push(workflowMatch);
    }
  }

  // Pattern 3: Tool usage patterns
  if (enabledTypes.includes('tool-usage')) {
    const toolMatch = detectToolUsagePattern(assistantMessages);
    if (toolMatch && toolMatch.confidence >= confidenceThreshold) {
      matches.push(toolMatch);
    }
  }

  // Pattern 4: Problem-solving patterns
  if (enabledTypes.includes('problem-solving')) {
    const problemMatch = detectProblemSolvingPattern(assistantMessages);
    if (problemMatch && problemMatch.confidence >= confidenceThreshold) {
      matches.push(problemMatch);
    }
  }

  // Pattern 5: File pattern patterns
  if (enabledTypes.includes('file-pattern')) {
    const fileMatch = detectFilePatternPattern(assistantMessages);
    if (fileMatch && fileMatch.confidence >= confidenceThreshold) {
      matches.push(fileMatch);
    }
  }

  // Pattern 6: Command sequence patterns
  if (enabledTypes.includes('command-sequence')) {
    const cmdMatch = detectCommandSequencePattern(assistantMessages);
    if (cmdMatch && cmdMatch.confidence >= confidenceThreshold) {
      matches.push(cmdMatch);
    }
  }

  return matches;
}

/**
 * Detect refactoring patterns (e.g., extracting functions, renaming variables)
 */
function detectRefactoringPattern(messages: Message[]): PatternMatch | null {
  const refactoringKeywords = [
    'extract',
    'refactor',
    'rename',
    'reorganize',
    'restructure',
    'simplify',
    'consolidate',
    'modularize',
  ];

  const matchingMessages = messages.filter((m) => {
    const content = m.content.toLowerCase();
    return refactoringKeywords.some((kw) => content.includes(kw));
  });

  if (matchingMessages.length < 2) return null;

  // Look for common refactoring actions
  const extractionPattern = matchingMessages.filter((m) =>
    /extract.*(?:function|method|component|variable)/i.test(m.content),
  );
  const renamingPattern = matchingMessages.filter((m) =>
    /rename.*(?:to|from|variable|function|class)/i.test(m.content),
  );

  if (extractionPattern.length >= 2) {
    return {
      type: 'refactoring',
      summary: 'Extracting reusable functions/components',
      description: `Detected ${extractionPattern.length} instances of extracting code into reusable functions or components. This suggests a pattern of improving code modularity.`,
      messageIds: extractionPattern.map((m) => m.id),
      confidence: Math.min(extractionPattern.length / 3, 1.0),
    };
  }

  if (renamingPattern.length >= 2) {
    return {
      type: 'refactoring',
      summary: 'Improving naming clarity',
      description: `Detected ${renamingPattern.length} instances of renaming variables, functions, or classes for better clarity.`,
      messageIds: renamingPattern.map((m) => m.id),
      confidence: Math.min(renamingPattern.length / 3, 1.0),
    };
  }

  return null;
}

/**
 * Detect tool usage patterns
 */
function detectToolUsagePattern(messages: Message[]): PatternMatch | null {
  const toolUseMessages = messages.filter((m) => m.content.includes('tool_use'));
  if (toolUseMessages.length < 2) return null;

  return {
    type: 'tool-usage',
    summary: 'Repeated tool usage pattern',
    description: `Detected ${toolUseMessages.length} instances of similar tool usage patterns.`,
    messageIds: toolUseMessages.slice(0, 5).map((m) => m.id),
    confidence: Math.min(toolUseMessages.length / 3, 1.0),
  };
}

/**
 * Detect problem-solving patterns
 */
function detectProblemSolvingPattern(messages: Message[]): PatternMatch | null {
  const debugKeywords = ['debug', 'fix', 'error', 'bug', 'issue', 'solve'];

  const matchingMessages = messages.filter((m) => {
    const content = m.content.toLowerCase();
    return debugKeywords.some((kw) => content.includes(kw));
  });

  if (matchingMessages.length < 2) return null;

  return {
    type: 'problem-solving',
    summary: 'Systematic problem-solving approach',
    description: `Detected ${matchingMessages.length} instances of systematic problem-solving.`,
    messageIds: matchingMessages.slice(0, 5).map((m) => m.id),
    confidence: Math.min(matchingMessages.length / 3, 1.0),
  };
}

/**
 * Detect file pattern patterns
 */
function detectFilePatternPattern(messages: Message[]): PatternMatch | null {
  const fileKeywords = ['create', 'edit', 'write', 'file', 'directory'];

  const matchingMessages = messages.filter((m) => {
    const content = m.content.toLowerCase();
    return fileKeywords.some((kw) => content.includes(kw));
  });

  if (matchingMessages.length < 2) return null;

  return {
    type: 'file-pattern',
    summary: 'Repeated file operations',
    description: `Detected ${matchingMessages.length} instances of similar file operations.`,
    messageIds: matchingMessages.slice(0, 5).map((m) => m.id),
    confidence: Math.min(matchingMessages.length / 3, 1.0),
  };
}

/**
 * Detect command sequence patterns
 */
function detectCommandSequencePattern(messages: Message[]): PatternMatch | null {
  const cmdMessages = messages.filter((m) => /bash|command|execute/i.test(m.content));
  if (cmdMessages.length < 2) return null;

  return {
    type: 'command-sequence',
    summary: 'Repeated command sequences',
    description: `Detected ${cmdMessages.length} instances of similar command sequences.`,
    messageIds: cmdMessages.slice(0, 5).map((m) => m.id),
    confidence: Math.min(cmdMessages.length / 3, 1.0),
  };
}

/**
 * Detect workflow patterns (repeated multi-step processes)
 */
function detectWorkflowPattern(messages: Message[]): PatternMatch | null {
  // Look for sequences of tool uses that form a workflow
  const toolUseMessages = messages.filter((m) => m.content.includes('tool_use'));

  if (toolUseMessages.length < 3) return null;

  // Simple heuristic: if we see similar sequences of tool calls
  // This is a simplified version - a real implementation would parse tool calls
  const hasWorkflowPattern = toolUseMessages.length >= 3;

  if (hasWorkflowPattern) {
    return {
      type: 'workflow',
      summary: 'Repeated multi-step workflow',
      description: `Detected a recurring workflow pattern with ${toolUseMessages.length} tool interactions.`,
      messageIds: toolUseMessages.slice(0, 5).map((m) => m.id),
      confidence: Math.min(toolUseMessages.length / 5, 1.0),
    };
  }

  return null;
}

/**
 * Check if a pattern should trigger a proposal
 */
export function shouldProposeSkillOrRule(
  pattern: PatternDetection,
  minOccurrences: number = 3,
): boolean {
  return (
    pattern.occurrences >= minOccurrences && !pattern.proposalCreated && pattern.confidence >= 0.6
  );
}

/**
 * Log a learning insight
 */
export function logLearning(
  workspacePath: string,
  message: string,
  eventType: string,
  relatedId?: string,
  metadata: Record<string, unknown> = {},
): LearningLogEntry {
  const db = getDb();
  const id = nanoid();
  const now = Date.now();

  db.query(
    `INSERT INTO learning_log
     (id, workspace_path, message, event_type, related_id, metadata, timestamp, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    workspacePath,
    message,
    eventType,
    relatedId || null,
    JSON.stringify(metadata),
    now,
    now,
  );

  return {
    id,
    workspacePath,
    message,
    eventType,
    relatedId,
    metadata,
    timestamp: now,
  };
}

/**
 * Get learning log entries for a workspace
 */
export function getLearningLog(workspacePath: string, limit: number = 50): LearningLogEntry[] {
  const db = getDb();
  const rows = db
    .query(
      `SELECT * FROM learning_log
       WHERE workspace_path = ?
       ORDER BY timestamp DESC
       LIMIT ?`,
    )
    .all(workspacePath, limit) as any[];

  return rows.map((row) => ({
    id: row.id,
    workspacePath: row.workspace_path,
    message: row.message,
    eventType: row.event_type,
    relatedId: row.related_id,
    metadata: JSON.parse(row.metadata || '{}'),
    timestamp: row.timestamp,
  }));
}

/**
 * Get all detected patterns for a workspace
 */
export function getDetectedPatterns(workspacePath: string): PatternDetection[] {
  const db = getDb();
  const rows = db
    .query(
      `SELECT * FROM pattern_detections
       WHERE workspace_path = ?
       ORDER BY confidence DESC, occurrences DESC
       LIMIT 50`,
    )
    .all(workspacePath) as any[];

  return rows.map((row) => ({
    id: row.id,
    workspacePath: row.workspace_path,
    patternType: row.pattern_type,
    description: row.description,
    occurrences: row.occurrences,
    tools: JSON.parse(row.tools || '[]'),
    examples: JSON.parse(row.examples || '[]'),
    conversationIds: JSON.parse(row.conversation_ids || '[]'),
    confidence: row.confidence,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    proposalCreated: !!row.proposal_created,
  }));
}

/**
 * Get skill/rule proposals for a workspace
 */
export function getProposals(workspacePath: string, status?: string): SkillProposal[] {
  const db = getDb();
  let query = `SELECT * FROM skill_proposals WHERE workspace_path = ?`;
  const params: any[] = [workspacePath];

  if (status) {
    query += ` AND status = ?`;
    params.push(status);
  }

  query += ` ORDER BY created_at DESC LIMIT 50`;

  const rows = db.query(query).all(...params) as any[];

  return rows.map((row) => ({
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
  }));
}

/**
 * Mark pattern as having a proposal
 */
export function markPatternProposed(patternId: string): void {
  const db = getDb();
  db.query(`UPDATE pattern_detections SET proposal_created = 1, updated_at = ? WHERE id = ?`).run(
    Date.now(),
    patternId,
  );
}

/**
 * Record a tool usage for pattern detection analysis
 */
export function recordToolUsage(
  conversationId: string,
  toolName: string,
  input: Record<string, unknown>,
  workspacePath?: string,
): void {
  const db = getDb();
  const id = nanoid(12);
  const timestamp = Date.now();

  // Normalize inputs for pattern matching
  const normalizedInput = JSON.stringify(input);

  db.query(
    `INSERT INTO tool_usage_records (id, conversation_id, workspace_path, tool_name, input, normalized_input, timestamp, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    conversationId,
    workspacePath || null,
    toolName,
    JSON.stringify(input),
    normalizedInput,
    timestamp,
    timestamp,
  );
}
