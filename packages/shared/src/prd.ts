// --- PRD Types ---

export type StoryStatus =
  | 'pending'
  | 'in_progress'
  | 'qa'
  | 'completed'
  | 'failed'
  | 'failed_timeout'
  | 'skipped'
  | 'archived';

/** Per-PRD workflow configuration controlling kanban behavior */
export interface WorkflowConfig {
  /**
   * If true, stories in 'qa' status count as "done" for dependency resolution,
   * allowing dependent stories to proceed without waiting for full completion.
   * Default: true (QA unblocks dependents so golems can keep working).
   */
  qaUnblocksDependents: boolean;
}

/** Default workflow config — QA unblocks dependents so golems keep working */
export const DEFAULT_WORKFLOW_CONFIG: WorkflowConfig = {
  qaUnblocksDependents: true,
};

export type StoryPriority = 'critical' | 'high' | 'medium' | 'low';

export interface AcceptanceCriterion {
  id: string;
  description: string;
  passed: boolean;
}

/** Supported external issue tracker providers */
export type ExternalProvider = 'jira' | 'linear' | 'asana';

/** Reference to an external issue tracker (Jira, Linear, Asana, etc.) */
export interface ExternalRef {
  provider: ExternalProvider;
  externalId: string; // e.g. "PROJ-123", Linear UUID, Asana GID
  externalUrl: string; // link back to the issue/epic
  syncedAt: number;
  syncDirection?: 'pull' | 'push' | 'bidirectional';
}

/** Normalized issue shape from any external provider */
export interface ExternalIssue {
  externalId: string;
  externalUrl: string;
  provider: ExternalProvider;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  status: string; // raw status from provider (e.g. "To Do", "In Progress")
  statusCategory: 'todo' | 'in_progress' | 'done';
  priority: string; // raw priority from provider
  priorityNormalized: StoryPriority;
  assignee?: string;
  labels: string[];
  projectKey: string;
  projectName: string;
  updatedAt: number;
}

/** Configuration for connecting to an external provider */
export interface ExternalProviderConfig {
  provider: ExternalProvider;
  apiKey: string;
  email?: string; // Jira: email for Basic auth
  baseUrl?: string; // Jira: instance URL (e.g. https://myorg.atlassian.net)
  teamId?: string; // Linear: team ID
  workspaceGid?: string; // Asana: workspace GID
}

/** A project/board from an external provider (for the project picker UI) */
export interface ExternalProject {
  id: string;
  name: string;
  provider: ExternalProvider;
  issueCount?: number;
}

/** Request to import issues from an external provider */
export interface ImportExternalIssuesRequest {
  provider: ExternalProvider;
  projectKey: string;
  workspacePath: string;
  issueIds?: string[]; // specific issues; omit to import all open
  prdId?: string; // attach to PRD instead of standalone
}

/** Result of importing external issues */
export interface ImportExternalIssuesResult {
  imported: number;
  skipped: number;
  storyIds: string[];
  errors: string[];
}

export interface UserStory {
  id: string;
  prdId: string | null; // null = standalone story (no PRD parent)
  workspacePath?: string; // for standalone stories; PRD stories get this from PRD
  title: string;
  description: string;
  acceptanceCriteria: AcceptanceCriterion[];
  priority: StoryPriority;
  dependsOn: string[]; // story IDs this story depends on
  dependencyReasons: Record<string, string>; // storyId -> reason for dependency
  status: StoryStatus;
  taskId?: string; // linked E task ID (legacy, from task migration)
  agentId?: string; // agent that last worked on this
  conversationId?: string; // conversation created for this story
  commitSha?: string; // git commit after successful implementation
  attempts: number; // how many times the loop tried this story
  maxAttempts: number; // configurable per-story retry limit
  learnings: string[]; // accumulated learnings from attempts
  estimate?: StoryEstimate; // AI or manual complexity/effort estimate
  priorityRecommendation?: PriorityRecommendation; // AI-suggested priority with explanation
  researchOnly: boolean; // if true, story is research/discovery — excluded from implementation loops
  externalRef?: ExternalRef; // link to Jira/Linear/Asana issue
  externalStatus?: string; // raw status string from external tool
  // --- Executor metadata (distributed coordination) ---
  executorId?: string; // ID of the executor currently working on this story
  executorType?: string; // type of executor (e.g. "local-worktree", "remote-ssh")
  machineId?: string; // machine/VM identifier where the executor is running
  startedAt?: number; // timestamp when execution started
  lastHeartbeat?: number; // timestamp of last heartbeat from executor
  assignedBranch?: string; // git branch assigned for this story's work
  leaseExpiresAt?: number; // timestamp when the lease expires without heartbeat renewal
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

/** Input for creating a standalone story (no PRD) */
export interface StandaloneStoryCreateInput {
  workspacePath: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
  priority?: StoryPriority;
  dependsOn?: string[];
  researchOnly?: boolean;
}

export interface PRD {
  id: string;
  workspacePath: string;
  name: string;
  description: string;
  branchName?: string;
  stories: UserStory[];
  qualityChecks: QualityCheckConfig[];
  workflowConfig?: WorkflowConfig; // kanban workflow behavior (QA unblocking, etc.)
  externalRef?: ExternalRef; // link to Jira Epic / Linear Project / Asana Project
  createdAt: number;
  updatedAt: number;
}

export interface PRDCreateInput {
  workspacePath: string;
  name: string;
  description: string;
  branchName?: string;
  stories: Array<{
    title: string;
    description: string;
    acceptanceCriteria: string[];
    priority?: StoryPriority;
    dependsOn?: string[];
  }>;
  qualityChecks?: QualityCheckConfig[];
}

// --- Quality Check Types ---

export type QualityCheckType = 'typecheck' | 'lint' | 'test' | 'build' | 'custom' | 'placeholder';

export interface QualityCheckConfig {
  id: string;
  type: QualityCheckType;
  name: string;
  command: string; // e.g. "npm run typecheck", "bun run check"
  timeout: number; // ms
  required: boolean; // if true, failing this check fails the story
  enabled: boolean;
}

export interface QualityCheckResult {
  checkId: string;
  checkName: string;
  checkType: QualityCheckType;
  passed: boolean;
  output: string;
  duration: number;
  exitCode: number;
  /** Story ID if this check was run in a worktree context */
  storyId?: string;
  /** True if the check was killed due to timeout (exitCode is unreliable in this case) */
  timedOut?: boolean;
}

// --- Loop Orchestrator Types ---

export type LoopStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'completed_with_failures'
  | 'failed'
  | 'cancelled';

export interface LoopConfig {
  maxIterations: number; // max total iterations across all stories
  maxAttemptsPerStory: number; // max fresh-start attempts per story (each gets fix-up sub-attempts)
  maxFixUpAttempts: number; // fix-up sub-attempts per fresh start before reverting (default 2)
  model: string;
  effort: string;
  autoCommit: boolean; // commit after each successful story
  autoSnapshot: boolean; // create git snapshot before each story
  pauseOnFailure: boolean; // pause the loop when a story fails
  qualityChecks: QualityCheckConfig[];
  systemPromptOverride?: string;
  /** Max stories to dispatch concurrently via worktrees (default 1 = serial). */
  maxParallel?: number;
  /** Auto-merge story branches back to base on completion (default true). */
  autoMerge?: boolean;
}

export interface LoopState {
  id: string;
  prdId: string | null; // null = standalone loop (no PRD)
  workspacePath: string;
  status: LoopStatus;
  config: LoopConfig;
  currentIteration: number;
  currentStoryId: string | null;
  currentAgentId: string | null;
  startedAt: number;
  pausedAt?: number;
  completedAt?: number;
  totalStoriesCompleted: number;
  totalStoriesFailed: number;
  totalIterations: number;
  iterationLog: IterationLogEntry[];
  lastHeartbeat?: number;
  /** Story IDs currently being dispatched in parallel (empty when maxParallel=1). */
  activeStoryIds?: string[];
}

export interface IterationLogEntry {
  iteration: number;
  storyId: string;
  storyTitle: string;
  action: 'started' | 'quality_check' | 'passed' | 'failed' | 'committed' | 'skipped' | 'learning';
  detail: string;
  timestamp: number;
  qualityResults?: QualityCheckResult[];
}

// --- Sprint Planning Types ---

export type PlanMode = 'chat' | 'generate' | 'chat-generate';

/** Controls how Claude handles story edits during planning.
 *  - locked:   Claude discusses stories in plain text only
 *  - propose:  Claude outputs structured edit blocks for user approval
 *  - unlocked: Claude outputs structured edit blocks that are auto-applied
 */
export type EditMode = 'locked' | 'propose' | 'unlocked';

export interface PlanSprintRequest {
  mode: PlanMode;
  editMode: EditMode;
  userPrompt?: string; // optional user guidance
  model?: string; // override model
}

export interface PlanSprintResponse {
  conversationId: string;
  prdId: string;
  mode: PlanMode;
  editMode: EditMode;
}

// --- Story Generation Types ---

export interface GenerateStoriesRequest {
  description: string; // PRD description or high-level requirements text
  context?: string; // optional additional context (project info, constraints)
  count?: number; // target number of stories (default: 5-10)
}

export interface GeneratedStory {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: StoryPriority;
}

export interface GenerateStoriesResponse {
  stories: GeneratedStory[];
  prdId: string;
}

// --- Story Refinement Types ---

export interface RefinementQuestion {
  id: string;
  question: string;
  context: string; // why this question matters
  suggestedAnswers?: string[]; // optional suggestions
}

export interface RefineStoryRequest {
  storyId: string;
  answers?: Array<{ questionId: string; answer: string }>; // answers to previous questions
}

export interface RefineStoryResponse {
  storyId: string;
  questions: RefinementQuestion[]; // 2-5 clarifying questions
  qualityScore: number; // 0-100, how well-defined the story is
  qualityExplanation: string; // what was unclear
  meetsThreshold: boolean; // true if quality >= 80
  updatedStory?: {
    title: string;
    description: string;
    acceptanceCriteria: string[];
    priority: StoryPriority;
  };
  improvements?: string[]; // list of what was improved and how
}

// --- Dependency Types ---

export type DependencyType = 'blocks' | 'blocked_by';

/** A directional dependency edge between two stories */
export interface StoryDependency {
  fromStoryId: string; // this story...
  toStoryId: string; // ...depends on / blocks this story
  type: DependencyType; // relationship direction
  reason?: string; // why this dependency exists
  autoDetected: boolean; // was this found by AI analysis?
}

/** Full dependency graph for a PRD */
export interface DependencyGraph {
  prdId: string;
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  warnings: DependencyWarning[];
}

export interface DependencyNode {
  storyId: string;
  title: string;
  status: StoryStatus;
  priority: StoryPriority;
  /** Number of stories this one blocks (downstream dependents) */
  blocksCount: number;
  /** Number of stories blocking this one (upstream dependencies) */
  blockedByCount: number;
  /** Whether all upstream dependencies are satisfied (completed) */
  isReady: boolean;
  /** Depth in the dependency chain (0 = no dependencies) */
  depth: number;
}

export interface DependencyEdge {
  from: string; // story ID that blocks
  to: string; // story ID that is blocked
  reason?: string;
}

export interface DependencyWarning {
  type: 'circular' | 'missing_dependency' | 'unresolved_blocker' | 'orphan_dependency';
  message: string;
  storyIds: string[];
}

/** Request for AI-powered dependency analysis */
export interface AnalyzeDependenciesRequest {
  /** If true, replace existing auto-detected dependencies. Manual ones are preserved. */
  replaceAutoDetected?: boolean;
}

/** Response from dependency analysis */
export interface AnalyzeDependenciesResponse {
  prdId: string;
  dependencies: StoryDependency[];
  graph: DependencyGraph;
}

/** Sprint plan validation result */
export interface SprintValidation {
  valid: boolean;
  warnings: SprintValidationWarning[];
}

export interface SprintValidationWarning {
  type: 'missing_dependency' | 'blocked_story' | 'circular_dependency';
  message: string;
  storyId: string;
  storyTitle: string;
  blockedByStoryIds?: string[];
  blockedByStoryTitles?: string[];
}

// --- Acceptance Criteria Validation Types ---

/** Severity of a validation issue found in a criterion */
export type ACValidationSeverity = 'error' | 'warning' | 'info';

/** Category of the validation issue */
export type ACValidationCategory =
  | 'vague'
  | 'unmeasurable'
  | 'untestable'
  | 'too_broad'
  | 'ambiguous'
  | 'missing_detail';

/** A single validation issue for one acceptance criterion */
export interface ACValidationIssue {
  criterionIndex: number;
  criterionText: string;
  severity: ACValidationSeverity;
  category: ACValidationCategory;
  message: string;
  suggestedReplacement?: string;
}

/** Validation result for a single criterion */
export interface ACCriterionValidation {
  index: number;
  text: string;
  isValid: boolean;
  issues: ACValidationIssue[];
  suggestedReplacement?: string;
}

/** Request to validate acceptance criteria */
export interface ValidateACRequest {
  storyId: string;
  criteria: string[]; // the criteria text to validate
  storyTitle?: string;
  storyDescription?: string;
}

/** Response from AC validation */
export interface ValidateACResponse {
  storyId: string;
  overallScore: number; // 0-100 quality score for all criteria
  allValid: boolean;
  criteria: ACCriterionValidation[];
  summary: string; // brief overall assessment
}

/** Override justification when user dismisses a warning */
export interface ACOverride {
  criterionIndex: number;
  justification: string;
}

// --- Story Estimation Types ---

/** Complexity size for a story */
export type StorySize = 'small' | 'medium' | 'large';

/** Confidence level for an estimate */
export type EstimateConfidence = 'low' | 'medium' | 'high';

/** A single factor that influenced the estimate */
export interface EstimationFactor {
  factor: string; // e.g. "Multiple API integrations required"
  impact: 'increases' | 'decreases' | 'neutral';
  weight: 'minor' | 'moderate' | 'major';
}

/** The full estimation result for a story */
export interface StoryEstimate {
  storyId: string;
  size: StorySize;
  storyPoints: number; // Fibonacci: 1, 2, 3, 5, 8, 13
  confidence: EstimateConfidence;
  confidenceScore: number; // 0-100 numeric confidence
  factors: EstimationFactor[];
  reasoning: string; // Brief explanation of the estimate
  suggestedBreakdown?: string[]; // For large stories, suggest sub-tasks
  isManualOverride: boolean; // Whether the user overrode the AI estimate
}

/** Request to estimate a story */
export interface EstimateStoryRequest {
  storyId: string;
  /** Optional: provide story details if not loading from DB */
  storyTitle?: string;
  storyDescription?: string;
  criteria?: string[];
}

/** Response from story estimation */
export interface EstimateStoryResponse {
  storyId: string;
  estimate: StoryEstimate;
}

/** Request to estimate all stories in a PRD */
export interface EstimatePrdRequest {
  /** If true, re-estimate stories that already have estimates */
  reEstimate?: boolean;
}

/** Response from bulk PRD estimation */
export interface EstimatePrdResponse {
  prdId: string;
  estimates: StoryEstimate[];
  summary: {
    totalPoints: number;
    averagePoints: number;
    smallCount: number;
    mediumCount: number;
    largeCount: number;
    averageConfidence: number;
  };
}

// --- Sprint Planning Recommendation Types ---

/** A single sprint in a recommended plan */
export interface SprintRecommendation {
  sprintNumber: number;
  stories: SprintStoryAssignment[];
  totalPoints: number;
  rationale: string; // Why these stories were grouped together
}

/** A story assigned to a specific sprint */
export interface SprintStoryAssignment {
  storyId: string;
  title: string;
  storyPoints: number;
  priority: StoryPriority;
  reason: string; // Why this story is in this sprint
}

/** Request to generate sprint plan recommendations */
export interface SprintPlanRequest {
  /** Sprint capacity in story points (required) */
  capacity: number;
  /** Optional: use 'points' (default) or 'count' for capacity mode */
  capacityMode?: 'points' | 'count';
}

/** Response from sprint plan recommendation */
export interface SprintPlanResponse {
  prdId: string;
  sprints: SprintRecommendation[];
  totalPoints: number;
  totalSprints: number;
  unassignedStories: Array<{
    storyId: string;
    title: string;
    reason: string; // Why it couldn't be assigned (e.g., no estimate, already completed)
  }>;
  summary: string; // Overall rationale for the plan
}

// --- PRD Completeness Analysis Types ---

/** Severity of a missing/weak section in a PRD */
export type PRDSectionSeverity = 'critical' | 'warning' | 'info';

/** Standard PRD sections that should be present */
export type PRDSectionName =
  | 'goals'
  | 'scope'
  | 'success_metrics'
  | 'constraints'
  | 'user_personas'
  | 'requirements'
  | 'assumptions'
  | 'risks'
  | 'timeline'
  | 'dependencies';

/** Analysis of a single PRD section */
export interface PRDSectionAnalysis {
  section: PRDSectionName;
  label: string; // Human-readable section name
  present: boolean; // Whether the section is detected
  severity: PRDSectionSeverity; // How critical the missing/weak section is
  score: number; // 0-100 score for this section's quality
  feedback: string; // Explanation of what's missing or weak
  questions: string[]; // Suggested questions to fill gaps
}

/** Full PRD completeness analysis result */
export interface PRDCompletenessAnalysis {
  prdId: string;
  overallScore: number; // 0-100 percentage completeness
  overallLabel: string; // e.g. "Excellent", "Good", "Needs Work"
  sections: PRDSectionAnalysis[];
  summary: string; // Brief overall assessment
  suggestedQuestions: string[]; // Top questions to fill critical gaps
  analyzedAt: number; // Timestamp of analysis
}

/** Request to analyze PRD completeness */
export interface AnalyzePrdCompletenessRequest {
  /** If provided, only analyze specific sections */
  sections?: PRDSectionName[];
}

/** Response from PRD completeness analysis */
export interface AnalyzePrdCompletenessResponse {
  prdId: string;
  analysis: PRDCompletenessAnalysis;
}

// --- Story Template Types ---

/** Category of a story template */
export type StoryTemplateCategory = 'feature' | 'bug' | 'tech_debt' | 'spike' | 'custom';

/** A reusable story template with pre-filled sections and guidance */
export interface StoryTemplate {
  id: string;
  name: string;
  description: string;
  category: StoryTemplateCategory;
  titleTemplate: string; // Template title with placeholders e.g. "[Feature] {{feature_name}}"
  descriptionTemplate: string; // Template description with placeholder guidance
  acceptanceCriteriaTemplates: string[]; // Pre-filled AC examples for this story type
  priority: StoryPriority;
  tags: string[];
  isBuiltIn: boolean; // true = system template, false = user-created
  createdAt: number;
  updatedAt: number;
}

/** Request to create a custom template */
export interface CreateTemplateRequest {
  name: string;
  description: string;
  category: StoryTemplateCategory;
  titleTemplate: string;
  descriptionTemplate: string;
  acceptanceCriteriaTemplates: string[];
  priority?: StoryPriority;
  tags?: string[];
}

/** Request to create a story from a template */
export interface CreateStoryFromTemplateRequest {
  templateId: string;
  /** Variable substitutions for template placeholders */
  variables?: Record<string, string>;
}

/** Response after creating a story from a template */
export interface CreateStoryFromTemplateResponse {
  storyId: string;
  story: {
    title: string;
    description: string;
    acceptanceCriteria: string[];
    priority: StoryPriority;
  };
}

// --- Priority Recommendation Types ---

/** A single factor that influenced the priority recommendation */
export interface PriorityFactor {
  factor: string; // e.g. "Blocks 3 other stories"
  category: 'dependency' | 'risk' | 'scope' | 'user_impact';
  impact: 'increases' | 'decreases' | 'neutral';
  weight: 'minor' | 'moderate' | 'major';
}

/** The full priority recommendation for a story */
export interface PriorityRecommendation {
  storyId: string;
  suggestedPriority: StoryPriority;
  currentPriority: StoryPriority;
  confidence: number; // 0-100
  factors: PriorityFactor[];
  explanation: string; // Human-readable explanation for the priority
  isManualOverride: boolean; // Whether the user overrode the AI recommendation
}

/** Response from priority recommendation for a single story */
export interface PriorityRecommendationResponse {
  storyId: string;
  recommendation: PriorityRecommendation;
}

/** Response from bulk priority recommendation for all stories in a PRD */
export interface PriorityRecommendationBulkResponse {
  prdId: string;
  recommendations: PriorityRecommendation[];
  summary: {
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    changedCount: number; // How many stories had their priority changed from current
  };
}

// --- Effort vs Value Matrix Types ---

/** Quadrant classification in the effort-value matrix */
export type MatrixQuadrant = 'quick_wins' | 'major_projects' | 'fill_ins' | 'low_priority';

/** A story positioned in the effort-value matrix */
export interface MatrixStoryPosition {
  storyId: string;
  title: string;
  status: StoryStatus;
  priority: StoryPriority;
  /** Effort score 0-100 (derived from story estimates) */
  effortScore: number;
  /** Value score 0-100 (derived from priority and acceptance criteria impact) */
  valueScore: number;
  /** Computed quadrant based on effort/value scores */
  quadrant: MatrixQuadrant;
  /** Story points from estimate (if available) */
  storyPoints: number | null;
  /** Story size from estimate (if available) */
  size: StorySize | null;
  /** Whether position has been manually adjusted by the user */
  isManualPosition: boolean;
}

/** Full matrix data for a PRD */
export interface EffortValueMatrix {
  prdId: string;
  stories: MatrixStoryPosition[];
  /** Summary counts per quadrant */
  quadrantCounts: Record<MatrixQuadrant, number>;
  /** Total stories in the matrix (excludes stories without enough data) */
  totalPlotted: number;
  /** Stories excluded due to missing data */
  excludedStories: Array<{
    storyId: string;
    title: string;
    reason: string;
  }>;
}

// --- Stream Events for Loop ---

export interface StreamLoopEvent {
  type: 'loop_event';
  loopId: string;
  event:
    | 'started'
    | 'iteration_start'
    | 'iteration_end'
    | 'story_started'
    | 'story_completed'
    | 'story_failed'
    | 'quality_check'
    | 'paused'
    | 'resumed'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'learning'
    | 'golem_thought'
    | 'worktree_created'
    | 'worktree_merge_started'
    | 'worktree_merge_completed'
    | 'worktree_merge_conflict';
  data: {
    storyId?: string;
    storyTitle?: string;
    iteration?: number;
    conversationId?: string;
    qualityResult?: QualityCheckResult;
    learning?: string;
    message?: string;
    /** When a story fails, indicates whether retries remain (true) or it's permanent (false) */
    willRetry?: boolean;
    /** Golem thought: describes what the golem is currently doing/thinking */
    thought?: string;
    /** Golem phase: high-level phase of the current activity */
    phase?: GolemPhase;
    /** Golem mood: emotional state derived from recent outcomes */
    mood?: GolemMood;
    /** Current attempt number for the active story */
    attempt?: number;
    /** Max attempts for the active story */
    maxAttempts?: number;
    /** Fix-up sub-attempt number (if in fix-up mode) */
    fixUpAttempt?: number;
    /** Max fix-up sub-attempts */
    maxFixUpAttempts?: number;
    /** Worktree path (for worktree_* events) */
    worktreePath?: string;
    /** Branch name (for worktree_* events) */
    branchName?: string;
    /** Merge commit SHA (for worktree_merge_completed) */
    commitSha?: string;
    /** Conflicting files (for worktree_merge_conflict) */
    conflictingFiles?: string[];
    /** Number of concurrent stories currently running (for parallel dispatch) */
    activeStories?: number;
    /** Max parallel stories configured */
    maxParallel?: number;
  };
}

/** High-level phases the golem goes through during work */
export type GolemPhase =
  | 'idle'
  | 'selecting_story'
  | 'backlog_empty'
  | 'preparing'
  | 'snapshot'
  | 'pre_check'
  | 'spawning_agent'
  | 'implementing'
  | 'quality_checking'
  | 'committing'
  | 'recording_learnings'
  | 'fixing_up'
  | 'reverting'
  | 'celebrating'
  | 'resting';

/** Emotional state of the golem, derived from recent outcomes */
export type GolemMood =
  | 'neutral'
  | 'focused'
  | 'determined'
  | 'excited'
  | 'proud'
  | 'frustrated'
  | 'worried'
  | 'relieved';

// --- PRD-Wide Refinement Types ---

/** Recommended action for a story during PRD-wide refinement */
export type StoryRecommendationAction =
  | 'keep'
  | 'update'
  | 'split'
  | 'merge'
  | 'remove'
  | 'already_done';

/** A single story recommendation from PRD-wide refinement */
export interface StoryRecommendation {
  storyId: string;
  storyTitle: string;
  action: StoryRecommendationAction;
  reason: string;
  suggestedChanges?: {
    title?: string;
    description?: string;
    acceptanceCriteria?: string[];
    priority?: StoryPriority;
  };
  mergeWith?: string[]; // story IDs to merge with
}

/** A suggested new story discovered during PRD-wide refinement */
export interface SuggestedNewStory {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: StoryPriority;
  reason: string; // why this gap exists
}

/** Request for PRD-wide refinement */
export interface RefineAllRequest {
  statuses?: string[]; // which statuses to include, default ['pending', 'in_progress', 'failed']
  includeCodeScan?: boolean; // whether to scan codebase for context (default true)
}

/** Response from PRD-wide refinement */
export interface RefineAllResponse {
  prdId: string;
  summary: string; // overall assessment
  storyRecommendations: StoryRecommendation[];
  suggestedNewStories: SuggestedNewStory[];
}
