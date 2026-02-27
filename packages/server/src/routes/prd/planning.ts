import { Hono } from 'hono';
import { nanoid, getDb, storyFromRow, callLlm } from './helpers';
import type {
  StoryPriority,
  PlanSprintRequest,
  PlanSprintResponse,
  SprintPlanRequest,
  SprintPlanResponse,
  SprintRecommendation,
  SprintStoryAssignment,
  PriorityRecommendation,
  PriorityFactor,
  PriorityRecommendationResponse,
  PriorityRecommendationBulkResponse,
} from './helpers';

const app = new Hono();

// --- Sprint Planning ---

// Create a planning conversation for a PRD
app.post('/:id/plan', async (c) => {
  const db = getDb();
  const prdId = c.req.param('id');
  const body = (await c.req.json()) as PlanSprintRequest;

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const stories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(prdId) as any[];

  // Build project memory context
  let memoryContext = '';
  try {
    const memRows = db
      .query(
        `SELECT * FROM workspace_memories WHERE workspace_path = ? AND confidence >= 0.3 ORDER BY category, times_seen DESC LIMIT 50`,
      )
      .all(prdRow.workspace_path) as any[];
    if (memRows.length > 0) {
      const grouped: Record<string, string[]> = {};
      for (const m of memRows) {
        if (!grouped[m.category]) grouped[m.category] = [];
        grouped[m.category].push(`- ${m.key}: ${m.content}`);
      }
      const labels: Record<string, string> = {
        convention: 'Coding Conventions',
        decision: 'Architecture Decisions',
        preference: 'User Preferences',
        pattern: 'Common Patterns',
        context: 'Project Context',
      };
      memoryContext = '\n\n## Project Memory\n';
      for (const [cat, items] of Object.entries(grouped)) {
        memoryContext += `\n### ${labels[cat] || cat}\n${items.join('\n')}\n`;
      }
    }
  } catch {
    /* no project memory */
  }

  // Build stories context
  let storiesContext = '';
  if (stories.length > 0) {
    storiesContext = `\n\n## Current Stories (${stories.length})\n`;
    for (const s of stories) {
      const mapped = storyFromRow(s);
      const criteria = mapped.acceptanceCriteria
        .map((ac: any) => `  - ${ac.description}`)
        .join('\n');
      storiesContext += `\n### ${mapped.title} [${mapped.status}] (${mapped.priority}) {id: ${mapped.id}}\n`;
      if (mapped.description) storiesContext += `${mapped.description}\n`;
      if (criteria) storiesContext += `Acceptance Criteria:\n${criteria}\n`;
    }
  } else {
    storiesContext =
      '\n\n## Current Stories\nNo stories yet — this PRD needs stories to be planned.\n';
  }

  // Build edit instructions based on editMode (locked / propose / unlocked)
  const editMode = body.editMode || 'locked';
  const storyEditBlock = `
To add a new story:
<story-add>
title: Story title here
description: Detailed description of the story
priority: medium
criteria:
- First acceptance criterion
- Second acceptance criterion
</story-add>

To edit an existing story (use the story id from the list above):
<story-edit id="STORY_ID">
title: Updated title
description: Updated description
priority: high
criteria:
- Updated criterion 1
- Updated criterion 2
</story-edit>

To remove a story:
<story-remove id="STORY_ID">
reason: Explanation of why this story should be removed
</story-remove>

You may include multiple blocks in a single response alongside your normal discussion text.
Always explain your reasoning before or after the structured blocks.`;

  let editInstructions: string;
  if (editMode === 'propose') {
    editInstructions = `\n\n## Story Edit Format
When you want to suggest adding, editing, or removing stories, use these structured blocks.
The user will see each suggestion and can choose to apply it.
${storyEditBlock}`;
  } else if (editMode === 'unlocked') {
    editInstructions = `\n\n## Story Edit Format
When you want to add, edit, or remove stories, use these structured blocks.
Your changes will be applied automatically.
${storyEditBlock}`;
  } else {
    editInstructions = `\n\n## Instructions
Discuss stories and planning in a readable format. The user will manually add stories to the PRD based on your suggestions.
Do not use any special structured markup — just discuss naturally.`;
  }

  // Build system prompt
  const systemPrompt = `You are helping plan a sprint for a software project.

## PRD: ${prdRow.name}
${prdRow.description || '(No description provided)'}
${storiesContext}${memoryContext}${editInstructions}

Focus on breaking down work into well-scoped, independent user stories with clear acceptance criteria.
Consider dependencies between stories and suggest a priority ordering.
Each story should be implementable in a single focused session.`;

  // Create the planning conversation
  const conversationId = nanoid();
  const now = Date.now();
  const model = body.model || 'sonnet';

  db.query(
    `INSERT INTO conversations (id, title, model, system_prompt, workspace_path, plan_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    conversationId,
    `[Plan] ${prdRow.name}`,
    model,
    systemPrompt,
    prdRow.workspace_path,
    now,
    now,
  );

  const response: PlanSprintResponse = {
    conversationId,
    prdId,
    mode: body.mode,
    editMode,
  };

  return c.json({ ok: true, data: response }, 201);
});

// --- Sprint Plan Recommendations ---

// Generate AI-recommended sprint assignments for all stories in a PRD
app.post('/:id/sprint-plan', async (c) => {
  const db = getDb();
  const prdId = c.req.param('id');
  const body = (await c.req.json()) as SprintPlanRequest;

  // Validate capacity
  const capacity = body.capacity;
  const capacityMode = body.capacityMode || 'points';
  if (!capacity || typeof capacity !== 'number' || capacity <= 0) {
    return c.json({ ok: false, error: 'capacity must be a positive number' }, 400);
  }

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const stories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(prdId) as any[];

  if (stories.length === 0) {
    return c.json({ ok: false, error: 'No stories in this PRD' }, 400);
  }

  const mappedStories = stories.map(storyFromRow);

  // Separate stories into plannable vs. unassignable
  const completedOrSkipped = mappedStories.filter(
    (s) => s.status === 'completed' || s.status === 'skipped',
  );
  const pendingStories = mappedStories.filter(
    (s) => s.status !== 'completed' && s.status !== 'skipped',
  );
  const unestimated = pendingStories.filter((s) => !s.estimate);
  const estimatedPending = pendingStories.filter((s) => s.estimate);

  // Build the unassigned list for stories we can't plan
  const unassignedStories: SprintPlanResponse['unassignedStories'] = [];

  for (const s of completedOrSkipped) {
    unassignedStories.push({
      storyId: s.id,
      title: s.title,
      reason: `Already ${s.status}`,
    });
  }
  for (const s of unestimated) {
    unassignedStories.push({
      storyId: s.id,
      title: s.title,
      reason: 'No estimate — estimate the story first',
    });
  }

  if (estimatedPending.length === 0) {
    return c.json({
      ok: true,
      data: {
        prdId,
        sprints: [],
        totalPoints: 0,
        totalSprints: 0,
        unassignedStories,
        summary: 'No pending estimated stories to plan.',
      } satisfies SprintPlanResponse,
    });
  }

  // Build context for AI
  const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

  // Build a list of stories for the AI to plan
  let storiesContext = '';
  for (const s of estimatedPending) {
    const deps = s.dependsOn || [];
    const depTitles = deps
      .map((depId: string) => {
        const dep = mappedStories.find((ms) => ms.id === depId);
        return dep ? `"${dep.title}" (${dep.status})` : depId;
      })
      .join(', ');
    const criteria = s.acceptanceCriteria.map((ac: any) => `  - ${ac.description}`).join('\n');

    storiesContext += `
### Story: ${s.title}
- ID: ${s.id}
- Priority: ${s.priority}
- Story Points: ${s.estimate!.storyPoints}
- Size: ${s.estimate!.size}
- Status: ${s.status}
- Dependencies: ${deps.length > 0 ? depTitles : 'None'}
${s.description ? `- Description: ${s.description}` : ''}
${criteria ? `- Acceptance Criteria:\n${criteria}` : ''}
`;
  }

  // Get project memory for context
  let memoryContext = '';
  try {
    const memories = db
      .query(
        'SELECT category, key, content FROM workspace_memories WHERE workspace_path = ? ORDER BY category, key',
      )
      .all(prdRow.workspace_path) as any[];
    if (memories.length > 0) {
      memoryContext = '\n\n## Project Context\n';
      for (const m of memories.slice(0, 10)) {
        memoryContext += `- [${m.category}] ${m.key}: ${m.content}\n`;
      }
    }
  } catch {
    /* no project memory */
  }

  const systemPrompt = `You are a sprint planning expert helping to assign user stories to sprints optimally.

## Rules
1. Sprint capacity: ${capacity} ${capacityMode === 'count' ? 'stories' : 'story points'} per sprint
2. Respect dependency ordering: If story A depends on story B, B must be in an earlier sprint (or the same sprint if B is already completed)
3. Schedule high-priority and critical stories in earlier sprints when possible
4. Balance sprint workload — try to fill sprints close to capacity but never exceed it
5. Group related stories together when it makes sense (e.g., stories that share the same feature area)
6. Consider story dependencies completed in earlier sprints as resolved

## PRD: ${prdRow.name}
${prdRow.description || '(No description)'}

## Stories to Plan
${storiesContext}
${memoryContext}

You MUST respond with ONLY a valid JSON object. No markdown, no explanation, no code fences.

{
  "sprints": [
    {
      "sprintNumber": 1,
      "storyIds": ["id1", "id2"],
      "storyReasons": {
        "id1": "Why this specific story is placed in this sprint",
        "id2": "Why this specific story is placed in this sprint"
      },
      "rationale": "Why these stories were grouped in this sprint"
    }
  ],
  "summary": "Overall explanation of the sprint plan strategy"
}

IMPORTANT:
- Every story ID from the input MUST appear in exactly one sprint
- Never exceed sprint capacity (${capacity} ${capacityMode === 'count' ? 'stories' : 'points'})
- A story's dependencies must be in earlier sprints or already completed
- Prioritize critical/high priority stories in earlier sprints
- Provide clear rationale for each sprint grouping
- Provide a specific reason for EACH story explaining why it was placed in that particular sprint
- sprintNumber starts at 1 and increments sequentially`;

  const userPrompt = `Plan sprints for these ${estimatedPending.length} stories with a capacity of ${capacity} ${capacityMode === 'count' ? 'stories' : 'story points'} per sprint. Respect dependencies and prioritize critical/high-priority items first.`;

  try {
    const rawResponse = await callLlm({ system: systemPrompt, user: userPrompt });

    // Parse JSON response
    let rawText = rawResponse.trim();
    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return c.json(
        { ok: false, error: 'Failed to parse AI sprint plan response as JSON. Try again.' },
        502,
      );
    }

    // Build the story lookup for validation
    const storyMap = new Map(estimatedPending.map((s) => [s.id, s]));

    // Validate and build sprint recommendations
    const sprints: SprintRecommendation[] = [];
    const assignedIds = new Set<string>();
    let overallTotalPoints = 0;

    if (!Array.isArray(parsed.sprints)) {
      return c.json({ ok: false, error: 'AI response missing sprints array. Try again.' }, 502);
    }

    for (const ps of parsed.sprints) {
      const sprintNum = typeof ps.sprintNumber === 'number' ? ps.sprintNumber : sprints.length + 1;
      const storyIds: string[] = Array.isArray(ps.storyIds) ? ps.storyIds : [];
      const storyReasons: Record<string, string> = ps.storyReasons || {};

      const sprintStories: SprintStoryAssignment[] = [];
      let sprintPoints = 0;

      for (const sid of storyIds) {
        const story = storyMap.get(sid);
        if (!story || assignedIds.has(sid)) continue;

        assignedIds.add(sid);
        const pts = story.estimate?.storyPoints ?? 0;
        sprintPoints += pts;
        overallTotalPoints += pts;

        // Use AI-provided per-story reason if available, otherwise generate a descriptive fallback
        const aiReason = storyReasons[sid];
        const fallbackReason = `${story.priority} priority, ${pts}pts${story.dependsOn?.length ? `, depends on ${story.dependsOn.length} story(ies)` : ''}`;

        sprintStories.push({
          storyId: sid,
          title: story.title,
          storyPoints: pts,
          priority: story.priority,
          reason: aiReason || fallbackReason,
        });
      }

      if (sprintStories.length > 0) {
        sprints.push({
          sprintNumber: sprintNum,
          stories: sprintStories,
          totalPoints: sprintPoints,
          rationale: (ps.rationale || `Sprint ${sprintNum} stories`).trim(),
        });
      }
    }

    // Add any stories the AI missed to additional sprints
    for (const s of estimatedPending) {
      if (!assignedIds.has(s.id)) {
        const pts = s.estimate?.storyPoints ?? 0;

        // Find a sprint with room, or create a new one
        let placed = false;
        for (const sprint of sprints) {
          const sprintCap = capacityMode === 'count' ? sprint.stories.length : sprint.totalPoints;
          const storyWeight = capacityMode === 'count' ? 1 : pts;
          if (sprintCap + storyWeight <= capacity) {
            sprint.stories.push({
              storyId: s.id,
              title: s.title,
              storyPoints: pts,
              priority: s.priority,
              reason: 'Added to fill remaining capacity',
            });
            sprint.totalPoints += pts;
            overallTotalPoints += pts;
            placed = true;
            break;
          }
        }

        if (!placed) {
          // Create a new sprint
          overallTotalPoints += pts;
          sprints.push({
            sprintNumber: sprints.length + 1,
            stories: [
              {
                storyId: s.id,
                title: s.title,
                storyPoints: pts,
                priority: s.priority,
                reason: 'Added to overflow sprint',
              },
            ],
            totalPoints: pts,
            rationale: 'Overflow sprint for remaining stories',
          });
        }
      }
    }

    // Renumber sprints sequentially
    sprints.forEach((s, i) => {
      s.sprintNumber = i + 1;
    });

    const response: SprintPlanResponse = {
      prdId,
      sprints,
      totalPoints: overallTotalPoints,
      totalSprints: sprints.length,
      unassignedStories,
      summary: (
        parsed.summary ||
        `Planned ${estimatedPending.length} stories across ${sprints.length} sprints.`
      ).trim(),
    };

    return c.json({ ok: true, data: response });
  } catch (err) {
    return c.json({ ok: false, error: `Sprint planning failed: ${(err as Error).message}` }, 500);
  }
});

// Save a manually adjusted sprint plan (user can move stories between sprints)
app.put('/:id/sprint-plan', async (c) => {
  const db = getDb();
  const prdId = c.req.param('id');
  const body = await c.req.json();

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId);
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  // Validate the body has the right shape
  if (!body.sprints || !Array.isArray(body.sprints)) {
    return c.json({ ok: false, error: 'sprints array required' }, 400);
  }

  const stories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(prdId) as any[];
  const mappedStories = stories.map(storyFromRow);
  const storyMap = new Map(mappedStories.map((s) => [s.id, s]));

  // Rebuild the sprint plan from the adjusted input
  const sprints: SprintRecommendation[] = [];
  let totalPoints = 0;

  for (const ps of body.sprints) {
    const sprintStories: SprintStoryAssignment[] = [];
    let sprintPoints = 0;

    for (const sa of ps.stories || []) {
      const story = storyMap.get(sa.storyId);
      if (!story) continue;

      const pts = story.estimate?.storyPoints ?? sa.storyPoints ?? 0;
      sprintPoints += pts;
      totalPoints += pts;

      sprintStories.push({
        storyId: sa.storyId,
        title: story.title,
        storyPoints: pts,
        priority: story.priority,
        reason: sa.reason || 'Manually assigned',
      });
    }

    if (sprintStories.length > 0) {
      sprints.push({
        sprintNumber: sprints.length + 1,
        stories: sprintStories,
        totalPoints: sprintPoints,
        rationale: ps.rationale || `Sprint ${sprints.length + 1} (manually adjusted)`,
      });
    }
  }

  const response: SprintPlanResponse = {
    prdId,
    sprints,
    totalPoints,
    totalSprints: sprints.length,
    unassignedStories: body.unassignedStories || [],
    summary: body.summary || `Manually adjusted plan with ${sprints.length} sprints.`,
  };

  return c.json({ ok: true, data: response });
});

// --- Priority Recommendation ---

// Recommend priority for a single story using AI
app.post('/:prdId/stories/:storyId/priority', async (c) => {
  const db = getDb();
  const prdId = c.req.param('prdId');
  const storyId = c.req.param('storyId');

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const storyRow = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id = ?')
    .get(storyId, prdId) as any;
  if (!storyRow) return c.json({ ok: false, error: 'Story not found' }, 404);

  const story = storyFromRow(storyRow);

  // Build context: all stories in the PRD for dependency and scope analysis
  const allStories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC')
    .all(prdId) as any[];
  const mappedStories = allStories.map(storyFromRow);

  // Build project memory context
  let memoryContext = '';
  try {
    const memRows = db
      .query(
        `SELECT * FROM workspace_memories WHERE workspace_path = ? AND confidence >= 0.3 ORDER BY category, times_seen DESC LIMIT 20`,
      )
      .all(prdRow.workspace_path) as any[];
    if (memRows.length > 0) {
      const grouped: Record<string, string[]> = {};
      for (const m of memRows) {
        if (!grouped[m.category]) grouped[m.category] = [];
        grouped[m.category].push(`- ${m.key}: ${m.content}`);
      }
      const labels: Record<string, string> = {
        convention: 'Coding Conventions',
        decision: 'Architecture Decisions',
        preference: 'User Preferences',
        pattern: 'Common Patterns',
        context: 'Project Context',
      };
      memoryContext = '\n\n## Project Memory\n';
      for (const [cat, items] of Object.entries(grouped)) {
        memoryContext += `\n### ${labels[cat] || cat}\n${items.join('\n')}\n`;
      }
    }
  } catch {
    /* no project memory */
  }

  // Build dependency context
  let dependencyContext = '';
  const blocksStories = mappedStories.filter((s) => s.dependsOn?.includes(storyId));
  const blockedByStories = (story.dependsOn || [])
    .map((depId: string) => mappedStories.find((s) => s.id === depId))
    .filter(Boolean);

  if (blocksStories.length > 0 || blockedByStories.length > 0) {
    dependencyContext = '\n\n## Dependency Information\n';
    if (blocksStories.length > 0) {
      dependencyContext += `This story BLOCKS ${blocksStories.length} other story(ies):\n`;
      for (const s of blocksStories) {
        dependencyContext += `- "${s.title}" (${s.status})\n`;
      }
    }
    if (blockedByStories.length > 0) {
      dependencyContext += `This story is BLOCKED BY ${blockedByStories.length} other story(ies):\n`;
      for (const s of blockedByStories) {
        dependencyContext += `- "${s.title}" (${s.status})\n`;
      }
    }
  }

  // Build sibling stories context
  let siblingContext = '\n\n## Other Stories in this PRD\n';
  const otherStories = mappedStories.filter((s) => s.id !== storyId);
  for (const s of otherStories) {
    const acCount = s.acceptanceCriteria?.length || 0;
    const depsCount = s.dependsOn?.length || 0;
    const blocksCount = mappedStories.filter((ms) => ms.dependsOn?.includes(s.id)).length;
    siblingContext += `- ${s.title} (priority: ${s.priority}, status: ${s.status}, ${acCount} criteria, blocks: ${blocksCount}, blocked by: ${depsCount})\n`;
  }

  const criteriaText = story.acceptanceCriteria.map((ac: any) => `- ${ac.description}`).join('\n');

  const systemPrompt = `You are an expert product manager specializing in story prioritization. Your task is to recommend a priority level for a user story based on business value, risk factors, dependencies, and user impact.

PRIORITY LEVELS:
- **critical**: Must be done immediately. Blocks critical functionality, security vulnerabilities, data loss risks, or is a prerequisite for many other stories.
- **high**: Important and should be scheduled soon. Significant user impact, blocks other stories, addresses key business requirements, or has substantial risk.
- **medium**: Standard priority. Normal feature work, moderate user impact, few dependencies.
- **low**: Nice to have. Minor improvements, cosmetic changes, tech debt that doesn't block other work, low user impact.

FACTORS TO EVALUATE:

1. **Blocking Dependencies** (category: dependency)
   - How many stories does this story block? (more blocks = higher priority)
   - Is this story on the critical path?
   - Are there circular dependency risks?

2. **Risk Keywords** (category: risk)
   - Look for risk indicators: "security", "performance", "data loss", "migration", "breaking change", "deadline", "compliance", "authentication", "authorization"
   - Infrastructure/foundation stories that other work depends on
   - Stories with unclear requirements or high uncertainty

3. **Scope** (category: scope)
   - Number of acceptance criteria (more criteria may indicate larger scope)
   - Complexity of the story description
   - Whether the story involves cross-cutting concerns
   - Estimated effort (if available)

4. **User Impact** (category: user_impact)
   - Does this affect core user workflows?
   - How many users would be affected?
   - Is this user-facing or internal/infrastructure?
   - Does this address user pain points or feature requests?

You MUST respond with ONLY a valid JSON object. No markdown, no explanation, no code fences.

{
  "suggestedPriority": "critical" | "high" | "medium" | "low",
  "confidence": <number 0-100>,
  "factors": [
    {
      "factor": "<description of the factor>",
      "category": "dependency" | "risk" | "scope" | "user_impact",
      "impact": "increases" | "decreases" | "neutral",
      "weight": "minor" | "moderate" | "major"
    }
  ],
  "explanation": "<2-3 sentence explanation of why this priority was recommended>"
}

IMPORTANT:
- Provide 3-6 factors that influenced your recommendation
- Be specific in factor descriptions (reference actual story details)
- Consider the full context: PRD description, dependencies, other stories' priorities
- A story that blocks many others should generally be higher priority
- Security and data-related stories should lean toward higher priority
- Confidence should reflect how clearly the priority can be determined from the available information${memoryContext}`;

  const userPrompt = `Recommend a priority level for this user story:

## PRD: ${prdRow.name}
${prdRow.description || '(No description)'}

## Story to Prioritize
Title: ${story.title}
Description: ${story.description}
Current Priority: ${story.priority}
Status: ${story.status}
Acceptance Criteria:
${criteriaText || '(No criteria defined)'}
${story.estimate ? `Estimate: ${story.estimate.size} (${story.estimate.storyPoints} points)` : 'No estimate yet'}
${dependencyContext}${siblingContext}

Recommend a priority level with explanation and supporting factors.`;

  try {
    const rawResponse = await callLlm({ system: systemPrompt, user: userPrompt });

    // Parse JSON response
    let rawText = rawResponse.trim();
    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return c.json(
        { ok: false, error: 'Failed to parse AI priority response as JSON. Try again.' },
        502,
      );
    }

    // Validate and normalize
    const validPriorities: StoryPriority[] = ['critical', 'high', 'medium', 'low'];
    const validCategories = ['dependency', 'risk', 'scope', 'user_impact'];

    const suggestedPriority: StoryPriority = validPriorities.includes(parsed.suggestedPriority)
      ? parsed.suggestedPriority
      : 'medium';
    const confidence =
      typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(100, Math.round(parsed.confidence)))
        : 60;

    const factors: PriorityFactor[] = (parsed.factors || [])
      .filter((f: any) => f.factor && typeof f.factor === 'string')
      .slice(0, 6)
      .map((f: any) => ({
        factor: f.factor.trim(),
        category: validCategories.includes(f.category) ? f.category : 'scope',
        impact: ['increases', 'decreases', 'neutral'].includes(f.impact) ? f.impact : 'neutral',
        weight: ['minor', 'moderate', 'major'].includes(f.weight) ? f.weight : 'moderate',
      }));

    const recommendation: PriorityRecommendation = {
      storyId,
      suggestedPriority,
      currentPriority: story.priority as StoryPriority,
      confidence,
      factors,
      explanation: (
        parsed.explanation || 'Priority recommendation based on story analysis.'
      ).trim(),
      isManualOverride: false,
    };

    // Persist recommendation to database
    const now = Date.now();
    db.query('UPDATE prd_stories SET priority_recommendation = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(recommendation),
      now,
      storyId,
    );
    db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);

    return c.json({
      ok: true,
      data: { storyId, recommendation } as PriorityRecommendationResponse,
    });
  } catch (err) {
    return c.json(
      { ok: false, error: `Priority recommendation failed: ${(err as Error).message}` },
      500,
    );
  }
});

// Accept/override a priority recommendation
app.put('/:prdId/stories/:storyId/priority', async (c) => {
  const db = getDb();
  const prdId = c.req.param('prdId');
  const storyId = c.req.param('storyId');
  const body = await c.req.json();

  const storyRow = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id = ?')
    .get(storyId, prdId) as any;
  if (!storyRow) return c.json({ ok: false, error: 'Story not found' }, 404);

  const { priority, accept } = body;
  const validPriorities: StoryPriority[] = ['critical', 'high', 'medium', 'low'];

  if (!validPriorities.includes(priority)) {
    return c.json(
      { ok: false, error: 'Invalid priority. Must be: critical, high, medium, or low' },
      400,
    );
  }

  const now = Date.now();
  const story = storyFromRow(storyRow);

  // Update the story priority
  db.query('UPDATE prd_stories SET priority = ?, updated_at = ? WHERE id = ?').run(
    priority,
    now,
    storyId,
  );

  // Update the recommendation to note the override (if one exists)
  if (story.priorityRecommendation) {
    const updatedRec: PriorityRecommendation = {
      ...story.priorityRecommendation,
      isManualOverride: !accept, // If accepting AI suggestion, it's not an override
      currentPriority: priority,
    };
    db.query('UPDATE prd_stories SET priority_recommendation = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(updatedRec),
      now,
      storyId,
    );
  }

  db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);

  return c.json({ ok: true });
});

// Recommend priorities for all stories in a PRD
app.post('/:id/priorities', async (c) => {
  const db = getDb();
  const prdId = c.req.param('id');

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const allStories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC')
    .all(prdId) as any[];

  if (allStories.length === 0) {
    return c.json({ ok: false, error: 'No stories in this PRD' }, 400);
  }

  const mappedStories = allStories.map(storyFromRow);

  // Build dependency map
  const blocksMap: Record<string, string[]> = {};
  for (const s of mappedStories) {
    for (const depId of s.dependsOn || []) {
      if (!blocksMap[depId]) blocksMap[depId] = [];
      blocksMap[depId].push(s.id);
    }
  }

  // Build context for AI
  let storiesContext = '';
  for (const s of mappedStories) {
    const acCount = s.acceptanceCriteria?.length || 0;
    const criteriaText = s.acceptanceCriteria.map((ac: any) => `  - ${ac.description}`).join('\n');
    const blocksCount = blocksMap[s.id]?.length || 0;
    const blockedByCount = s.dependsOn?.length || 0;
    const blocksTitles = (blocksMap[s.id] || [])
      .map((id: string) => mappedStories.find((ms) => ms.id === id)?.title || id)
      .join(', ');

    storiesContext += `
### Story: ${s.title}
- ID: ${s.id}
- Current Priority: ${s.priority}
- Status: ${s.status}
- Description: ${s.description || '(No description)'}
- Acceptance Criteria (${acCount}):
${criteriaText || '  (None)'}
- Blocks: ${blocksCount > 0 ? `${blocksCount} stories (${blocksTitles})` : 'None'}
- Blocked By: ${blockedByCount > 0 ? `${blockedByCount} stories` : 'None'}
${s.estimate ? `- Estimate: ${s.estimate.size} (${s.estimate.storyPoints} points)` : '- No estimate yet'}
`;
  }

  // Get project memory for context
  let memoryContext = '';
  try {
    const memories = db
      .query(
        'SELECT category, key, content FROM workspace_memories WHERE workspace_path = ? ORDER BY category, key',
      )
      .all(prdRow.workspace_path) as any[];
    if (memories.length > 0) {
      memoryContext = '\n\n## Project Context\n';
      for (const m of memories.slice(0, 10)) {
        memoryContext += `- [${m.category}] ${m.key}: ${m.content}\n`;
      }
    }
  } catch {
    /* no project memory */
  }

  const systemPrompt = `You are an expert product manager specializing in story prioritization. Recommend priority levels for ALL stories in this PRD.

PRIORITY LEVELS:
- **critical**: Must be done immediately. Blocks critical functionality, security issues, data loss, prerequisite for many stories.
- **high**: Important, schedule soon. Significant user impact, blocks other stories, key business requirements.
- **medium**: Standard priority. Normal feature work, moderate impact, few dependencies.
- **low**: Nice to have. Minor improvements, cosmetic changes, non-blocking tech debt.

EVALUATION CRITERIA:
1. **Blocking Dependencies**: Stories that block many others should be higher priority
2. **Risk Keywords**: Look for "security", "performance", "data loss", "migration", "breaking change", "compliance", "auth"
3. **Scope**: Number of criteria, cross-cutting concerns, complexity
4. **User Impact**: Core workflows, user-facing vs internal, pain points

You MUST respond with ONLY a valid JSON object. No markdown, no explanation, no code fences.

{
  "recommendations": [
    {
      "storyId": "<story ID>",
      "suggestedPriority": "critical" | "high" | "medium" | "low",
      "confidence": <number 0-100>,
      "factors": [
        {
          "factor": "<factor description>",
          "category": "dependency" | "risk" | "scope" | "user_impact",
          "impact": "increases" | "decreases" | "neutral",
          "weight": "minor" | "moderate" | "major"
        }
      ],
      "explanation": "<1-2 sentence explanation>"
    }
  ],
  "summary": "<Overall prioritization rationale>"
}

IMPORTANT:
- Include ALL story IDs from the input
- Provide 2-4 factors per story
- Be specific in factor descriptions
- Consider relative priorities: not every story should be critical or high
- Stories blocking many others should generally rank higher
- Consider the overall PRD goals when prioritizing${memoryContext}`;

  const userPrompt = `Recommend priority levels for all ${mappedStories.length} stories in this PRD:

## PRD: ${prdRow.name}
${prdRow.description || '(No description)'}

## Stories
${storiesContext}

Prioritize all stories considering dependencies, risks, scope, and user impact.`;

  try {
    const rawResponse = await callLlm({ system: systemPrompt, user: userPrompt });

    // Parse JSON response
    let rawText = rawResponse.trim();
    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return c.json(
        { ok: false, error: 'Failed to parse AI priority response as JSON. Try again.' },
        502,
      );
    }

    // Validate and build recommendations
    const validPriorities: StoryPriority[] = ['critical', 'high', 'medium', 'low'];
    const validCategories = ['dependency', 'risk', 'scope', 'user_impact'];

    const recommendations: PriorityRecommendation[] = [];
    const now = Date.now();

    for (const rec of parsed.recommendations || []) {
      const matchedStory = mappedStories.find((s) => s.id === rec.storyId);
      if (!matchedStory) continue;

      const suggestedPriority: StoryPriority = validPriorities.includes(rec.suggestedPriority)
        ? rec.suggestedPriority
        : 'medium';
      const confidence =
        typeof rec.confidence === 'number'
          ? Math.max(0, Math.min(100, Math.round(rec.confidence)))
          : 60;

      const factors: PriorityFactor[] = (rec.factors || [])
        .filter((f: any) => f.factor && typeof f.factor === 'string')
        .slice(0, 6)
        .map((f: any) => ({
          factor: f.factor.trim(),
          category: validCategories.includes(f.category) ? f.category : 'scope',
          impact: ['increases', 'decreases', 'neutral'].includes(f.impact) ? f.impact : 'neutral',
          weight: ['minor', 'moderate', 'major'].includes(f.weight) ? f.weight : 'moderate',
        }));

      const recommendation: PriorityRecommendation = {
        storyId: matchedStory.id,
        suggestedPriority,
        currentPriority: matchedStory.priority as StoryPriority,
        confidence,
        factors,
        explanation: (rec.explanation || 'Priority based on story analysis.').trim(),
        isManualOverride: false,
      };

      recommendations.push(recommendation);

      // Persist to database
      db.query(
        'UPDATE prd_stories SET priority_recommendation = ?, updated_at = ? WHERE id = ?',
      ).run(JSON.stringify(recommendation), now, matchedStory.id);
    }

    db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);

    // Build summary
    const summary: PriorityRecommendationBulkResponse['summary'] = {
      criticalCount: recommendations.filter((r) => r.suggestedPriority === 'critical').length,
      highCount: recommendations.filter((r) => r.suggestedPriority === 'high').length,
      mediumCount: recommendations.filter((r) => r.suggestedPriority === 'medium').length,
      lowCount: recommendations.filter((r) => r.suggestedPriority === 'low').length,
      changedCount: recommendations.filter((r) => r.suggestedPriority !== r.currentPriority).length,
    };

    return c.json({
      ok: true,
      data: {
        prdId,
        recommendations,
        summary,
      } as PriorityRecommendationBulkResponse,
    });
  } catch (err) {
    return c.json(
      { ok: false, error: `Bulk priority recommendation failed: ${(err as Error).message}` },
      500,
    );
  }
});

export default app;
