import { nanoid } from 'nanoid';
import { getDb } from '../../db/database';
import type {
  StoryTemplate,
  DependencyGraph,
  DependencyNode,
  DependencyEdge,
  DependencyWarning,
  SprintValidation,
  SprintValidationWarning,
  UserStory,
  StoryEstimate,
  EstimatePrdResponse,
  StoryPriority,
  WorkflowConfig,
} from '@e/shared';

// Re-export shared imports that sub-routes need
export { nanoid } from 'nanoid';
export { getDb } from '../../db/database';
export { callLlm } from '../../services/llm-oneshot';

// Re-export all shared types from @e/shared
export type {
  PRDCreateInput,
  StoryPriority,
  PlanSprintRequest,
  PlanSprintResponse,
  GenerateStoriesRequest,
  GeneratedStory,
  RefineStoryRequest,
  RefinementQuestion,
  DependencyGraph,
  DependencyNode,
  DependencyEdge,
  DependencyWarning,
  StoryDependency,
  AnalyzeDependenciesRequest,
  SprintValidation,
  SprintValidationWarning,
  UserStory,
  ValidateACRequest,
  ValidateACResponse,
  ACCriterionValidation,
  ACValidationIssue,
  EstimateStoryRequest,
  EstimateStoryResponse,
  EstimatePrdRequest,
  EstimatePrdResponse,
  StoryEstimate,
  StorySize,
  EstimateConfidence,
  EstimationFactor,
  SprintPlanRequest,
  SprintPlanResponse,
  SprintRecommendation,
  SprintStoryAssignment,
  PRDCompletenessAnalysis,
  PRDSectionAnalysis,
  PRDSectionName,
  PRDSectionSeverity,
  AnalyzePrdCompletenessRequest,
  AnalyzePrdCompletenessResponse,
  StoryTemplate,
  StoryTemplateCategory,
  CreateTemplateRequest,
  CreateStoryFromTemplateRequest,
  CreateStoryFromTemplateResponse,
  PriorityRecommendation,
  PriorityFactor,
  PriorityRecommendationResponse,
  PriorityRecommendationBulkResponse,
  StandaloneStoryCreateInput,
  WorkflowConfig,
  RefineAllRequest,
  RefineAllResponse,
  StoryRecommendation,
  StoryRecommendationAction,
  SuggestedNewStory,
} from '@e/shared';

export { DEFAULT_WORKFLOW_CONFIG } from '@e/shared';

// --- Row mappers ---

export function prdFromRow(row: any) {
  const rawWorkflow = row.workflow_config ? JSON.parse(row.workflow_config) : undefined;
  return {
    id: row.id,
    workspacePath: row.workspace_path,
    name: row.name,
    description: row.description,
    branchName: row.branch_name,
    qualityChecks: JSON.parse(row.quality_checks || '[]'),
    workflowConfig: rawWorkflow && Object.keys(rawWorkflow).length > 0 ? rawWorkflow : undefined,
    externalRef: row.external_ref ? JSON.parse(row.external_ref) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function storyFromRow(row: any) {
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
    taskId: row.task_id,
    agentId: row.agent_id,
    conversationId: row.conversation_id,
    commitSha: row.commit_sha,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    learnings: JSON.parse(row.learnings || '[]'),
    estimate: row.estimate ? JSON.parse(row.estimate) : undefined,
    priorityRecommendation: row.priority_recommendation
      ? JSON.parse(row.priority_recommendation)
      : undefined,
    researchOnly: !!row.research_only,
    externalRef: row.external_ref ? JSON.parse(row.external_ref) : undefined,
    externalStatus: row.external_status || undefined,
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

export function templateFromRow(row: any): StoryTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    titleTemplate: row.title_template,
    descriptionTemplate: row.description_template,
    acceptanceCriteriaTemplates: JSON.parse(row.acceptance_criteria_templates || '[]'),
    priority: row.priority,
    tags: JSON.parse(row.tags || '[]'),
    isBuiltIn: !!row.is_built_in,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- Topological Sort for Dependency-Aware Ordering ---

/**
 * Computes sort_order values that respect dependency constraints.
 * Stories with no dependencies come first; stories that depend on others
 * are placed after all their dependencies. Within the same dependency depth,
 * original insertion order is preserved as a stable tiebreaker.
 *
 * Uses Kahn's algorithm (BFS topological sort) with stable ordering.
 * Handles cycles gracefully by appending cycle participants at the end.
 *
 * @param items - Array of { id, dependsOn, originalIndex } objects
 * @returns Map from item ID to its computed sort_order
 */
export function computeTopologicalSortOrder(
  items: Array<{ id: string; dependsOn: string[]; originalIndex: number }>,
): Map<string, number> {
  const itemIds = new Set(items.map((i) => i.id));
  const indexById = new Map(items.map((i) => [i.id, i.originalIndex]));

  // Build adjacency: inDegree and adjacency list (only for deps within the set)
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // depId -> [items that depend on it]

  for (const item of items) {
    inDegree.set(item.id, 0);
    dependents.set(item.id, []);
  }

  for (const item of items) {
    for (const depId of item.dependsOn) {
      if (itemIds.has(depId)) {
        inDegree.set(item.id, (inDegree.get(item.id) || 0) + 1);
        dependents.get(depId)!.push(item.id);
      }
    }
  }

  // Kahn's algorithm with stable ordering (sort queue by originalIndex)
  const queue: string[] = [];
  for (const item of items) {
    if (inDegree.get(item.id) === 0) {
      queue.push(item.id);
    }
  }
  // Stable sort: process items with no deps in their original order
  queue.sort((a, b) => (indexById.get(a) || 0) - (indexById.get(b) || 0));

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    const deps = dependents.get(current) || [];
    // Sort dependents by originalIndex for stable tiebreaking
    deps.sort((a, b) => (indexById.get(a) || 0) - (indexById.get(b) || 0));
    for (const depId of deps) {
      const newDeg = (inDegree.get(depId) || 1) - 1;
      inDegree.set(depId, newDeg);
      if (newDeg === 0) {
        queue.push(depId);
        // Re-sort to maintain stable order in the queue
        queue.sort((a, b) => (indexById.get(a) || 0) - (indexById.get(b) || 0));
      }
    }
  }

  // Append any cycle participants (not reached by Kahn's) in original order
  if (sorted.length < items.length) {
    const sortedSet = new Set(sorted);
    const remaining = items
      .filter((i) => !sortedSet.has(i.id))
      .sort((a, b) => a.originalIndex - b.originalIndex);
    for (const item of remaining) {
      sorted.push(item.id);
    }
  }

  // Build sort_order map
  const result = new Map<string, number>();
  for (let i = 0; i < sorted.length; i++) {
    result.set(sorted[i], i);
  }
  return result;
}

/**
 * Reorders all stories within a PRD (or standalone set) so that sort_order
 * respects dependency constraints. Call after bulk story creation or
 * when dependencies change.
 */
export function reorderStoriesByDependencies(db: ReturnType<typeof getDb>, prdId: string): void {
  const rows = db
    .query(
      'SELECT id, depends_on, sort_order FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC',
    )
    .all(prdId) as Array<{ id: string; depends_on: string; sort_order: number }>;

  if (rows.length === 0) return;

  const items = rows.map((r, i) => ({
    id: r.id,
    dependsOn: JSON.parse(r.depends_on || '[]') as string[],
    originalIndex: i,
  }));

  const sortOrderMap = computeTopologicalSortOrder(items);
  const now = Date.now();
  for (const [storyId, order] of sortOrderMap) {
    db.query('UPDATE prd_stories SET sort_order = ?, updated_at = ? WHERE id = ?').run(
      order,
      now,
      storyId,
    );
  }
}

// --- Dependency helpers ---

/**
 * Returns the set of story IDs considered "done" for dependency resolution.
 * When qaUnblocksDependents is true, 'qa' status counts as done alongside 'completed'.
 */
export function getDoneStoryIds(
  stories: UserStory[],
  workflowConfig?: WorkflowConfig,
): Set<string> {
  return new Set(
    stories
      .filter(
        (s) =>
          s.status === 'completed' || (workflowConfig?.qaUnblocksDependents && s.status === 'qa'),
      )
      .map((s) => s.id),
  );
}

// --- Dependency Graph Builder ---

export function buildDependencyGraph(
  stories: UserStory[],
  prdId: string,
  workflowConfig?: WorkflowConfig,
): DependencyGraph {
  const storyMap = new Map(stories.map((s) => [s.id, s]));
  const completedIds = getDoneStoryIds(stories, workflowConfig);

  // Build edges
  const edges: DependencyEdge[] = [];
  const blocksMap = new Map<string, Set<string>>(); // storyId -> set of stories it blocks
  const blockedByMap = new Map<string, Set<string>>(); // storyId -> set of stories blocking it

  for (const s of stories) {
    blocksMap.set(s.id, new Set());
    blockedByMap.set(s.id, new Set());
  }

  for (const story of stories) {
    for (const depId of story.dependsOn) {
      if (storyMap.has(depId)) {
        edges.push({
          from: depId,
          to: story.id,
          reason: story.dependencyReasons?.[depId],
        });
        blocksMap.get(depId)?.add(story.id);
        blockedByMap.get(story.id)?.add(depId);
      }
    }
  }

  // Calculate depth using BFS topological approach
  const depthMap = new Map<string, number>();
  const calculateDepth = (storyId: string, visited: Set<string> = new Set()): number => {
    if (depthMap.has(storyId)) return depthMap.get(storyId)!;
    if (visited.has(storyId)) return 0; // circular dep protection
    visited.add(storyId);

    const deps = blockedByMap.get(storyId) || new Set();
    if (deps.size === 0) {
      depthMap.set(storyId, 0);
      return 0;
    }

    let maxDepth = 0;
    for (const depId of deps) {
      maxDepth = Math.max(maxDepth, calculateDepth(depId, visited) + 1);
    }
    depthMap.set(storyId, maxDepth);
    return maxDepth;
  };

  for (const s of stories) {
    calculateDepth(s.id);
  }

  // Build nodes
  const nodes: DependencyNode[] = stories.map((s) => ({
    storyId: s.id,
    title: s.title,
    status: s.status,
    priority: s.priority,
    blocksCount: blocksMap.get(s.id)?.size || 0,
    blockedByCount: blockedByMap.get(s.id)?.size || 0,
    isReady: Array.from(blockedByMap.get(s.id) || []).every((depId) => completedIds.has(depId)),
    depth: depthMap.get(s.id) || 0,
  }));

  // Check for warnings
  const warnings: DependencyWarning[] = [];

  // Circular dependency detection
  const depsMapForCycle = new Map<string, Set<string>>();
  for (const s of stories) {
    depsMapForCycle.set(s.id, new Set(s.dependsOn.filter((id) => storyMap.has(id))));
  }
  const circularPairs = detectCircularDependencies(depsMapForCycle);
  if (circularPairs.length > 0) {
    const involvedIds = new Set<string>();
    for (const [from, to] of circularPairs) {
      involvedIds.add(from);
      involvedIds.add(to);
    }
    warnings.push({
      type: 'circular',
      message: `Circular dependencies detected involving stories: ${Array.from(involvedIds)
        .map((id) => storyMap.get(id)?.title || id)
        .join(', ')}`,
      storyIds: Array.from(involvedIds),
    });
  }

  // Orphan dependency (depends on a story ID that doesn't exist)
  for (const story of stories) {
    for (const depId of story.dependsOn) {
      if (!storyMap.has(depId)) {
        warnings.push({
          type: 'orphan_dependency',
          message: `Story "${story.title}" depends on non-existent story ID: ${depId}`,
          storyIds: [story.id],
        });
      }
    }
  }

  // Unresolved blockers — only warn for stories actively in progress with unmet deps.
  // Pending stories with unmet deps are just waiting their turn, not a problem.
  for (const story of stories) {
    if (story.status === 'in_progress') {
      const unresolvedDeps = story.dependsOn.filter(
        (depId) => storyMap.has(depId) && !completedIds.has(depId),
      );
      if (unresolvedDeps.length > 0) {
        warnings.push({
          type: 'unresolved_blocker',
          message: `Story "${story.title}" is in progress but blocked by: ${unresolvedDeps.map((id) => storyMap.get(id)?.title || id).join(', ')}`,
          storyIds: [story.id, ...unresolvedDeps],
        });
      }
    }
  }

  return { prdId, nodes, edges, warnings };
}

export function detectCircularDependencies(
  depsMap: Map<string, Set<string>>,
): Array<[string, string]> {
  const circularPairs: Array<[string, string]> = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string, path: string[]): boolean {
    if (inStack.has(node)) {
      // Found a cycle — record the back edge
      const cycleStart = path.indexOf(node);
      for (let i = cycleStart; i < path.length - 1; i++) {
        circularPairs.push([path[i], path[i + 1]]);
      }
      if (path.length > 0) {
        circularPairs.push([path[path.length - 1], node]);
      }
      return true;
    }
    if (visited.has(node)) return false;

    visited.add(node);
    inStack.add(node);

    const deps = depsMap.get(node) || new Set();
    for (const dep of deps) {
      dfs(dep, [...path, node]);
    }

    inStack.delete(node);
    return false;
  }

  for (const node of depsMap.keys()) {
    if (!visited.has(node)) {
      dfs(node, []);
    }
  }

  return circularPairs;
}

export function validateSprintPlan(
  stories: UserStory[],
  workflowConfig?: WorkflowConfig,
): SprintValidation {
  const storyMap = new Map(stories.map((s) => [s.id, s]));
  const completedIds = getDoneStoryIds(stories, workflowConfig);
  const warnings: SprintValidationWarning[] = [];

  // Check for stories included in sprint that have unmet dependencies
  const pendingOrInProgress = stories.filter(
    (s) => s.status === 'pending' || s.status === 'in_progress',
  );

  for (const story of pendingOrInProgress) {
    const unmetDeps = story.dependsOn
      .filter((depId) => storyMap.has(depId))
      .filter((depId) => !completedIds.has(depId));

    if (unmetDeps.length > 0) {
      // Check if the blocking stories are also in the sprint (pending/in_progress)
      const blockingStories = unmetDeps.map((id) => storyMap.get(id)!).filter(Boolean);
      const blockingNotInSprint = blockingStories.filter(
        (bs) => bs.status !== 'pending' && bs.status !== 'in_progress',
      );

      if (blockingNotInSprint.length > 0) {
        warnings.push({
          type: 'missing_dependency',
          message: `Story "${story.title}" depends on stories not in the current sprint: ${blockingNotInSprint.map((s) => s.title).join(', ')}`,
          storyId: story.id,
          storyTitle: story.title,
          blockedByStoryIds: blockingNotInSprint.map((s) => s.id),
          blockedByStoryTitles: blockingNotInSprint.map((s) => s.title),
        });
      }

      // Only warn if the story is actively in progress with unmet deps —
      // pending stories with unmet deps are just waiting their turn, not a problem
      if (story.status === 'in_progress') {
        warnings.push({
          type: 'blocked_story',
          message: `Story "${story.title}" is in progress but blocked by: ${blockingStories.map((s) => s.title).join(', ')}. Ensure these are completed first.`,
          storyId: story.id,
          storyTitle: story.title,
          blockedByStoryIds: blockingStories.map((s) => s.id),
          blockedByStoryTitles: blockingStories.map((s) => s.title),
        });
      }
    }
  }

  // Check for circular dependencies
  const depsMap = new Map<string, Set<string>>();
  for (const s of stories) {
    depsMap.set(s.id, new Set(s.dependsOn.filter((id) => storyMap.has(id))));
  }
  const circularPairs = detectCircularDependencies(depsMap);
  if (circularPairs.length > 0) {
    const involvedIds = new Set<string>();
    for (const [from, to] of circularPairs) {
      involvedIds.add(from);
      involvedIds.add(to);
    }
    for (const storyId of involvedIds) {
      const story = storyMap.get(storyId);
      if (story) {
        warnings.push({
          type: 'circular_dependency',
          message: `Story "${story.title}" is part of a circular dependency chain. This will prevent execution.`,
          storyId: story.id,
          storyTitle: story.title,
        });
      }
    }
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}

export function buildEstimateSummary(
  prdId: string,
  estimates: StoryEstimate[],
): EstimatePrdResponse {
  const totalPoints = estimates.reduce((sum, e) => sum + e.storyPoints, 0);
  const averagePoints = estimates.length > 0 ? totalPoints / estimates.length : 0;
  const smallCount = estimates.filter((e) => e.size === 'small').length;
  const mediumCount = estimates.filter((e) => e.size === 'medium').length;
  const largeCount = estimates.filter((e) => e.size === 'large').length;
  const averageConfidence =
    estimates.length > 0
      ? estimates.reduce((sum, e) => sum + e.confidenceScore, 0) / estimates.length
      : 0;

  return {
    prdId,
    estimates,
    summary: {
      totalPoints,
      averagePoints: Math.round(averagePoints * 10) / 10,
      smallCount,
      mediumCount,
      largeCount,
      averageConfidence: Math.round(averageConfidence),
    },
  };
}

// =============================================
// Story Template Library - Built-in Templates
// =============================================

/** Built-in templates seeded on first load */
export const BUILT_IN_TEMPLATES: Array<Omit<StoryTemplate, 'id' | 'createdAt' | 'updatedAt'>> = [
  {
    name: 'Feature',
    description: 'A new user-facing feature or capability',
    category: 'feature',
    titleTemplate: 'As a {{user_role}}, I want to {{action}} so that {{benefit}}',
    descriptionTemplate:
      'Implement a new feature that allows {{user_role}} to {{action}}.\n\n' +
      '## Context\nDescribe why this feature is needed and how it fits into the larger product.\n\n' +
      '## Scope\n- What is included in this feature\n- What is explicitly out of scope\n\n' +
      '## Technical Notes\nAny implementation guidance, API changes, or architectural considerations.',
    acceptanceCriteriaTemplates: [
      'User can {{primary_action}} from the {{location}} page',
      'System validates {{input}} before processing',
      'Success/error feedback is displayed to the user',
      'Feature is accessible via keyboard navigation',
      'Unit tests cover the core logic with >80% coverage',
    ],
    priority: 'medium',
    tags: ['feature', 'user-facing'],
    isBuiltIn: true,
  },
  {
    name: 'Bug Fix',
    description: 'Fix a defect or unexpected behavior in existing functionality',
    category: 'bug',
    titleTemplate: 'Fix: {{brief_description_of_bug}}',
    descriptionTemplate:
      '## Bug Description\nDescribe the incorrect behavior that users are experiencing.\n\n' +
      '## Steps to Reproduce\n1. Go to {{location}}\n2. Perform {{action}}\n3. Observe {{incorrect_result}}\n\n' +
      '## Expected Behavior\nDescribe what should happen instead.\n\n' +
      '## Actual Behavior\nDescribe what currently happens.\n\n' +
      '## Environment\n- Browser/OS: \n- Version: \n- User role: ',
    acceptanceCriteriaTemplates: [
      'The reported bug no longer occurs when following the reproduction steps',
      'Existing related functionality is not broken (regression check)',
      'A regression test is added to prevent this bug from recurring',
      'The fix works across supported browsers/environments',
    ],
    priority: 'high',
    tags: ['bug', 'fix', 'defect'],
    isBuiltIn: true,
  },
  {
    name: 'Technical Debt',
    description: 'Refactoring, cleanup, or infrastructure improvement',
    category: 'tech_debt',
    titleTemplate: 'Tech Debt: {{area}} - {{improvement}}',
    descriptionTemplate:
      '## Current State\nDescribe the current technical issue or suboptimal implementation.\n\n' +
      '## Problem\nExplain why this technical debt is problematic (performance, maintainability, scalability, etc.).\n\n' +
      '## Proposed Solution\nDescribe the refactoring or improvement to be made.\n\n' +
      '## Impact\n- Code quality: \n- Performance: \n- Developer experience: \n\n' +
      '## Migration Plan\nIf applicable, describe how to migrate existing data or code.',
    acceptanceCriteriaTemplates: [
      'Code is refactored according to the proposed solution',
      'All existing tests continue to pass',
      'No user-facing behavior changes (unless explicitly intended)',
      'Code review confirms improved readability/maintainability',
      'Performance benchmarks show no regression (or improvement if applicable)',
    ],
    priority: 'low',
    tags: ['tech-debt', 'refactor', 'infrastructure'],
    isBuiltIn: true,
  },
  {
    name: 'Research Spike',
    description: 'Time-boxed investigation to reduce uncertainty or evaluate options',
    category: 'spike',
    titleTemplate: 'Spike: Investigate {{topic_or_question}}',
    descriptionTemplate:
      '## Research Question\nWhat specific question(s) need to be answered?\n\n' +
      '## Background\nWhat context led to this research need? What do we already know?\n\n' +
      '## Options to Evaluate\n1. {{option_1}}\n2. {{option_2}}\n3. {{option_3}}\n\n' +
      '## Time Box\nThis spike is limited to {{duration}} of effort.\n\n' +
      '## Success Criteria\nWhat deliverables are expected from this research?',
    acceptanceCriteriaTemplates: [
      'A written summary document with findings is produced',
      'At least {{number}} options are evaluated with pros/cons',
      'A recommendation is made with clear rationale',
      'Identified risks and unknowns are documented',
      'Follow-up stories are created based on findings',
    ],
    priority: 'medium',
    tags: ['spike', 'research', 'investigation'],
    isBuiltIn: true,
  },
];

/** Seed built-in templates if they don't exist */
export function seedBuiltInTemplates(): void {
  const db = getDb();
  const existing = db
    .query('SELECT COUNT(*) as count FROM story_templates WHERE is_built_in = 1')
    .get() as any;
  if (existing.count > 0) return;

  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO story_templates (id, name, description, category, title_template, description_template,
     acceptance_criteria_templates, priority, tags, is_built_in, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  );

  for (const tmpl of BUILT_IN_TEMPLATES) {
    stmt.run(
      nanoid(12),
      tmpl.name,
      tmpl.description,
      tmpl.category,
      tmpl.titleTemplate,
      tmpl.descriptionTemplate,
      JSON.stringify(tmpl.acceptanceCriteriaTemplates),
      tmpl.priority,
      JSON.stringify(tmpl.tags),
      now,
      now,
    );
  }
}
