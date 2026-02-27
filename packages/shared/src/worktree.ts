// ---------------------------------------------------------------------------
// Worktree types — shared between server and client
// ---------------------------------------------------------------------------

/** Information about a single git worktree. */
export interface WorktreeInfo {
  /** Absolute filesystem path to the worktree. */
  path: string;
  /** Branch checked out in this worktree (e.g. "story/add-auth"). */
  branch: string | null;
  /** HEAD commit SHA. */
  head: string;
  /** Story ID extracted from branch name (null for non-story branches). */
  storyId: string | null;
  /** Whether this is the main (bare) worktree. */
  isMain: boolean;
  /** Whether the worktree is locked (git worktree lock). */
  isLocked: boolean;
  /** Whether the worktree has uncommitted changes. */
  isDirty: boolean;
}

/** Options for creating a new worktree. */
export interface WorktreeCreateOptions {
  /** Absolute path to the workspace/repo root. */
  workspacePath: string;
  /** Story ID — used to derive worktree path and branch name. */
  storyId: string;
  /** Base branch/ref to create the worktree from. Defaults to HEAD. */
  baseBranch?: string;
}

/** Structured result wrapper for all worktree operations. */
export interface WorktreeResult<T> {
  /** Whether the operation succeeded. */
  ok: boolean;
  /** Result data on success. */
  data?: T;
  /** Error message on failure. */
  error?: string;
  /** List of dirty files (for remove rejection). */
  dirtyFiles?: string[];
}

/** Validation result for a worktree. */
export interface WorktreeValidation {
  /** Whether the worktree is valid. */
  valid: boolean;
  /** Whether the worktree directory exists. */
  dirExists: boolean;
  /** Whether HEAD is a valid ref. */
  headValid: boolean;
  /** Whether the branch is intact. */
  branchIntact: boolean;
}

// ---------------------------------------------------------------------------
// Worktree database record types
// ---------------------------------------------------------------------------

/** Valid status values for a worktree database record. */
export type WorktreeStatus =
  | 'active'
  | 'merging'
  | 'merged'
  | 'conflict'
  | 'abandoned'
  | 'cleanup_pending';

/** All valid worktree statuses as a readonly array for runtime validation. */
export const WORKTREE_STATUSES: readonly WorktreeStatus[] = [
  'active',
  'merging',
  'merged',
  'conflict',
  'abandoned',
  'cleanup_pending',
] as const;

// ---------------------------------------------------------------------------
// Merge types — used by the worktree merge service
// ---------------------------------------------------------------------------

/** Result of a merge operation. */
export interface MergeResult {
  /** Whether the merge succeeded. */
  ok: boolean;
  /** Merge commit SHA on success. */
  commitSha?: string;
  /** Error message on failure. */
  error?: string;
  /** List of files with conflicts (on conflict). */
  conflictingFiles?: string[];
  /** Current worktree status after the operation. */
  status?: WorktreeStatus | string;
  /** Detailed operation log with timestamps. */
  operationLog: MergeOperationLogEntry[];
}

/** Options for a merge operation. */
export interface MergeOptions {
  /** Story ID to merge. */
  storyId: string;
  /** If true, skip quality checks (e.g. for retry after manual resolution). */
  skipQualityCheck?: boolean;
}

/** A single log entry for a merge operation step. */
export interface MergeOperationLogEntry {
  /** ISO 8601 timestamp of when the step occurred. */
  timestamp: string;
  /** Name of the operation step (e.g. 'pre-check:clean', 'rebase', 'merge:ff-only'). */
  operation: string;
  /** Whether the step succeeded. */
  success: boolean;
  /** Optional detail message. */
  detail?: string;
}

// ---------------------------------------------------------------------------
// Worktree database record types (cont.)
// ---------------------------------------------------------------------------

/** Persistent database record for a worktree-to-story assignment. */
export interface WorktreeRecord {
  /** Unique ID (nanoid(12)). */
  id: string;
  /** Story ID this worktree is assigned to (unique). */
  story_id: string;
  /** Optional PRD ID the story belongs to. */
  prd_id: string | null;
  /** Absolute path to the workspace/repo root. */
  workspace_path: string;
  /** Absolute path to the worktree directory (unique). */
  worktree_path: string;
  /** Git branch name (unique), e.g. "story/abc123". */
  branch_name: string;
  /** Base branch the worktree was created from, if any. */
  base_branch: string | null;
  /** Commit SHA of HEAD at the time the worktree was created. */
  base_commit: string | null;
  /** Current status of the worktree. */
  status: WorktreeStatus;
  /** Unix timestamp (ms) when the record was created. */
  created_at: number;
  /** Unix timestamp (ms) when the record was last updated. */
  updated_at: number;
}
