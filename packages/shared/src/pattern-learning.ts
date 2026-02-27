/**
 * Pattern Learning & Self-Improving Skills Types
 *
 * Types for detecting recurring patterns, tracking learning, and
 * auto-generating skills and rules based on agent behavior.
 */

import type { SkillCategory } from './skills.js';

/**
 * Sensitivity level for pattern detection
 */
export type PatternSensitivity = 'aggressive' | 'moderate' | 'conservative';

/**
 * Type of proposal (skill or rule)
 */
export type ProposalType = 'skill' | 'rule';

/**
 * Type of pattern detected
 */
export type PatternType =
  | 'refactoring' // Repeated code transformations
  | 'workflow' // Repeated sequence of operations
  | 'tool-usage' // Repeated tool call patterns
  | 'problem-solving' // Repeated solution to similar problems
  | 'file-pattern' // Repeated file operations
  | 'command-sequence' // Repeated bash commands
  | 'debugging' // Repeated debugging patterns
  | 'testing' // Repeated testing patterns
  | 'documentation' // Repeated documentation patterns
  | 'code-generation' // Repeated code generation patterns
  | 'other';

/**
 * A detected recurring pattern in agent behavior
 */
export interface PatternDetection {
  id: string;
  workspacePath: string;
  /** Type of pattern detected */
  patternType: PatternType;
  /** Human-readable description of the pattern */
  description: string;
  /** Number of times this pattern has occurred */
  occurrences: number;
  /** Tools involved in this pattern */
  tools: string[];
  /** Examples of when this pattern occurred */
  examples: PatternExample[];
  /** Confidence score (0-1) that this is a valid pattern */
  confidence: number;
  /** Timestamp when pattern was first detected */
  firstSeen: number;
  /** Timestamp when pattern was last seen */
  lastSeen: number;
  /** Whether a proposal has been created */
  proposalCreated: boolean;
  /** Conversation IDs where pattern occurred */
  conversationIds: string[];
}

/**
 * An example occurrence of a pattern
 */
export interface PatternExample {
  /** Timestamp of occurrence */
  timestamp: number;
  /** Message ID where pattern occurred */
  messageId: string;
  /** Brief description of what happened */
  description: string;
  /** Tool calls involved */
  toolCalls?: string[];
  /** Code snippets or relevant context */
  context?: string;
}

/**
 * Learning log entry tracking what the agent has learned
 */
export interface LearningLogEntry {
  id: string;
  workspacePath: string;
  /** Log message */
  message: string;
  /** Type of learning event */
  eventType: string;
  /** Related entity ID (pattern, proposal, etc.) */
  relatedId?: string;
  /** Additional metadata */
  metadata: Record<string, any>;
  /** Timestamp */
  timestamp: number;
}

/**
 * Skill proposal metadata for agent notes
 */
export interface SkillProposal {
  id: string;
  /** Pattern ID that triggered this proposal */
  patternId: string;
  /** Workspace path */
  workspacePath: string;
  /** Proposed skill type: 'skill' or 'rule' */
  proposalType: 'skill' | 'rule';
  /** Skill/rule name */
  name: string;
  /** Description */
  description: string;
  /** Generated skill content (SKILL.md or rule .md) */
  content: string;
  /** Additional metadata */
  metadata: Record<string, any>;
  /** Status of proposal */
  status: 'pending' | 'approved' | 'rejected';
  /** Path where skill/rule was installed if approved */
  installedPath?: string;
  /** Created timestamp */
  createdAt: number;
  /** Updated timestamp */
  updatedAt?: number;
}

/**
 * Configuration for pattern detection in a workspace
 */
export interface PatternLearningSettings {
  /** Enable/disable pattern detection */
  enabled: boolean;
  /** Sensitivity level */
  sensitivity: PatternSensitivity;
  /** Minimum occurrences before suggesting a pattern */
  minimumOccurrences: number;
  /** Minimum confidence threshold (0-1) */
  confidenceThreshold: number;
  /** Auto-create proposals when patterns detected */
  autoCreateProposals: boolean;
  /** Specific pattern types to detect */
  enabledPatternTypes: PatternType[];
}

/**
 * Default pattern detection configuration
 */
export const DEFAULT_PATTERN_LEARNING_SETTINGS: PatternLearningSettings = {
  enabled: true,
  sensitivity: 'moderate',
  minimumOccurrences: 3,
  confidenceThreshold: 0.7,
  autoCreateProposals: true,
  enabledPatternTypes: [
    'refactoring',
    'workflow',
    'tool-usage',
    'problem-solving',
    'file-pattern',
    'command-sequence',
  ],
};

/**
 * Sensitivity presets
 */
export const PATTERN_SENSITIVITY_PRESETS: Record<
  PatternSensitivity,
  Pick<PatternLearningSettings, 'minimumOccurrences' | 'confidenceThreshold'>
> = {
  aggressive: {
    minimumOccurrences: 2,
    confidenceThreshold: 0.5,
  },
  moderate: {
    minimumOccurrences: 3,
    confidenceThreshold: 0.7,
  },
  conservative: {
    minimumOccurrences: 5,
    confidenceThreshold: 0.85,
  },
};

/**
 * Skill suggestion from registry search
 */
export interface SkillCapabilityGap {
  /** Description of the capability gap */
  description: string;
  /** Suggested skill IDs from registry */
  suggestedSkills: string[];
  /** Confidence in suggestions (0-1) */
  confidence: number;
  /** When the gap was detected */
  detectedAt: number;
}

/**
 * Request to approve a skill/rule proposal
 */
export interface ApproveProposalRequest {
  /** Tier: 'managed' or 'workspace' */
  tier: 'managed' | 'workspace';
  /** Workspace path */
  workspacePath: string;
  /** Optional custom name */
  name?: string;
  /** Optional custom content */
  content?: string;
}

/**
 * Record of tool usage for pattern detection
 */
export interface ToolUsageRecord {
  /** Unique ID */
  id: string;
  /** Workspace path */
  workspacePath: string;
  /** Conversation ID */
  conversationId: string;
  /** Message ID */
  messageId: string;
  /** Tool name */
  toolName: string;
  /** Tool inputs (JSON stringified) */
  inputs: string;
  /** Tool result (JSON stringified) */
  result?: string;
  /** Whether the tool call succeeded */
  success: boolean;
  /** Timestamp */
  timestamp: number;
}
