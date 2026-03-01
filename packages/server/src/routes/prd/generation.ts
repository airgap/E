import { Hono } from 'hono';
import { nanoid, getDb, storyFromRow, callLlm, reorderStoriesByDependencies } from './helpers';
import type {
  GenerateStoriesRequest,
  GeneratedStory,
  GenerateFromDescriptionRequest,
  GenerateFromDescriptionResponse,
  RefineStoryRequest,
  RefinementQuestion,
  ValidateACRequest,
  ValidateACResponse,
  ACCriterionValidation,
  ACValidationIssue,
  RefineAllRequest,
  StoryRecommendation,
  SuggestedNewStory,
} from './helpers';

const app = new Hono();

// --- Story Generation ---

// One-step endpoint: create a PRD from a description and generate stories in a single call.
// This is the foundational entry-point for the agentic PRD tool — a user provides a
// high-level description and receives a fully-populated PRD with AI-generated stories.
app.post('/generate-from-description', async (c) => {
  const db = getDb();
  const body = (await c.req.json()) as GenerateFromDescriptionRequest;

  const description = body.description?.trim();
  if (!description) {
    return c.json({ ok: false, error: 'A description is required to generate stories.' }, 400);
  }

  const workspacePath = body.workspacePath?.trim();
  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath is required.' }, 400);
  }

  // Derive a PRD name from the first line of the description if not provided
  const prdName =
    body.name?.trim() ||
    description.split(/[\n.!?]/)[0].slice(0, 80).trim() ||
    'Untitled PRD';

  // Build project memory context for better scoping
  let memoryContext = '';
  try {
    const memRows = db
      .query(
        `SELECT * FROM workspace_memories WHERE workspace_path = ? AND confidence >= 0.3 ORDER BY category, times_seen DESC LIMIT 30`,
      )
      .all(workspacePath) as any[];
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

  const targetCount = body.count || 7;

  const systemPrompt = `You are an expert software project manager and technical architect. Your task is to break down a product requirements description into well-scoped user stories.

RULES:
1. Generate between 5 and 10 user stories (aim for ${targetCount}).
2. Each story MUST have a clear, concise title.
3. Each story MUST have a description explaining what needs to be done and why.
4. Each story MUST have at least 3 acceptance criteria that are specific and testable.
5. Stories should be appropriately scoped for a single implementation session (a few hours of focused work).
6. Stories should be ordered by priority and logical dependencies.
7. Assign priorities: "critical" for foundational/blocking work, "high" for core features, "medium" for important but not blocking, "low" for nice-to-haves.
8. If a story depends on another, include "dependsOnIndices" with the zero-based indices of its prerequisites in the array.

You MUST respond with ONLY a valid JSON array of story objects. No markdown, no explanation, no code fences. Just the raw JSON array.

Each story object must have this exact shape:
{
  "title": "string",
  "description": "string",
  "acceptanceCriteria": ["string", "string", "string"],
  "priority": "critical" | "high" | "medium" | "low",
  "dependsOnIndices": [0, 1]
}

The "dependsOnIndices" field is optional. Only include it when a story truly depends on earlier stories being completed first. Each value is the zero-based index of the prerequisite story in the array.${memoryContext}`;

  const userPrompt = `Break down the following product requirements description into user stories:

## PRD: ${prdName}

${description}${body.context ? `\n\n## Additional Context\n${body.context}` : ''}`;

  try {
    const rawResponse = await callLlm({ system: systemPrompt, user: userPrompt });

    // Parse the JSON response — handle potential markdown code fences
    let rawText = rawResponse.trim();
    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    let generatedStories: GeneratedStory[];
    try {
      generatedStories = JSON.parse(rawText);
    } catch {
      return c.json({ ok: false, error: 'Failed to parse AI response as JSON. Try again.' }, 502);
    }

    // Validate the response shape
    if (!Array.isArray(generatedStories) || generatedStories.length === 0) {
      return c.json({ ok: false, error: 'AI returned empty or invalid stories array' }, 502);
    }

    const validPriorities = ['critical', 'high', 'medium', 'low'];
    const validatedStories: GeneratedStory[] = generatedStories
      .filter((s) => s.title && typeof s.title === 'string')
      .map((s) => ({
        title: s.title.trim(),
        description: (s.description || '').trim(),
        acceptanceCriteria: Array.isArray(s.acceptanceCriteria)
          ? s.acceptanceCriteria
              .filter((ac: any) => typeof ac === 'string' && ac.trim())
              .map((ac: string) => ac.trim())
          : [],
        priority: validPriorities.includes(s.priority) ? s.priority : 'medium',
        // Validate dependency indices: LLM may return as "dependsOn" or "dependsOnIndices"
        dependsOnIndices: (() => {
          const rawDeps = Array.isArray(s.dependsOnIndices)
            ? s.dependsOnIndices
            : Array.isArray((s as any).dependsOn)
              ? (s as any).dependsOn
              : null;
          if (!rawDeps) return undefined;
          return (rawDeps as any[]).filter(
            (idx: any) => typeof idx === 'number' && Number.isInteger(idx) && idx >= 0,
          );
        })(),
      }));

    // Ensure each story has at least 3 acceptance criteria
    for (const story of validatedStories) {
      while (story.acceptanceCriteria.length < 3) {
        story.acceptanceCriteria.push(
          `[Needs acceptance criterion ${story.acceptanceCriteria.length + 1}]`,
        );
      }
    }

    // Create the PRD
    const prdId = nanoid(12);
    const now = Date.now();
    db.query(
      `INSERT INTO prds (id, workspace_path, name, description, branch_name, quality_checks, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
    ).run(
      prdId,
      workspacePath,
      prdName,
      description,
      JSON.stringify(body.qualityChecks || []),
      now,
      now,
    );

    const autoAccept = body.autoAccept !== false; // default true
    let storyIds: string[] = [];
    let accepted = 0;

    if (autoAccept && validatedStories.length > 0) {
      const storyInsert = db.query(
        `INSERT INTO prd_stories (id, prd_id, title, description, acceptance_criteria, priority, depends_on, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      // First pass: generate all IDs so we can resolve dependsOnIndices
      for (const _s of validatedStories) {
        storyIds.push(nanoid(12));
      }

      // Second pass: insert stories with resolved dependency IDs
      let sortOrder = 0;
      for (let i = 0; i < validatedStories.length; i++) {
        const s = validatedStories[i];
        const storyId = storyIds[i];

        const criteria = s.acceptanceCriteria.map((desc: string) => ({
          id: nanoid(8),
          description: desc,
          passed: false,
        }));

        // Resolve dependsOnIndices to actual story IDs
        const dependsOn: string[] = [];
        if (Array.isArray(s.dependsOnIndices)) {
          for (const idx of s.dependsOnIndices) {
            if (typeof idx === 'number' && idx >= 0 && idx < storyIds.length && idx !== i) {
              dependsOn.push(storyIds[idx]);
            }
          }
        }

        storyInsert.run(
          storyId,
          prdId,
          s.title,
          s.description || '',
          JSON.stringify(criteria),
          s.priority || 'medium',
          JSON.stringify(dependsOn),
          sortOrder++,
          now,
          now,
        );
      }

      accepted = validatedStories.length;

      // Reorder stories so sort_order respects dependency constraints
      reorderStoriesByDependencies(db, prdId);

      // Touch PRD updated_at after accepting stories
      db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(Date.now(), prdId);
    }

    const response: GenerateFromDescriptionResponse = {
      prdId,
      stories: validatedStories,
      accepted,
      storyIds,
    };

    return c.json({ ok: true, data: response }, 201);
  } catch (err) {
    return c.json(
      { ok: false, error: `Story generation failed: ${(err as Error).message}` },
      500,
    );
  }
});

// Generate stories from a PRD description using AI
app.post('/:id/generate', async (c) => {
  const db = getDb();
  const prdId = c.req.param('id');
  const body = (await c.req.json()) as GenerateStoriesRequest;

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  // Use PRD description if no description provided in request
  const description = body.description || prdRow.description;
  if (!description?.trim()) {
    return c.json(
      {
        ok: false,
        error:
          'No description provided. Supply a description in the request or set one on the PRD.',
      },
      400,
    );
  }

  // Build project memory context for better scoping
  let memoryContext = '';
  try {
    const memRows = db
      .query(
        `SELECT * FROM workspace_memories WHERE workspace_path = ? AND confidence >= 0.3 ORDER BY category, times_seen DESC LIMIT 30`,
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

  // Check for existing stories to avoid duplicates
  const existingStories = db
    .query('SELECT title, description FROM prd_stories WHERE prd_id = ?')
    .all(prdId) as any[];
  let existingContext = '';
  if (existingStories.length > 0) {
    existingContext = '\n\n## Existing Stories (avoid duplicating these)\n';
    for (const s of existingStories) {
      existingContext += `- ${s.title}: ${s.description}\n`;
    }
  }

  const targetCount = body.count || 7; // Default target: 7 stories

  const systemPrompt = `You are an expert software project manager and technical architect. Your task is to break down a product requirements description into well-scoped user stories.

RULES:
1. Generate between 5 and 10 user stories (aim for ${targetCount}).
2. Each story MUST have a clear, concise title.
3. Each story MUST have a description explaining what needs to be done and why.
4. Each story MUST have at least 3 acceptance criteria that are specific and testable.
5. Stories should be appropriately scoped for a single implementation session (a few hours of focused work).
6. Stories should be ordered by priority and logical dependencies.
7. Assign priorities: "critical" for foundational/blocking work, "high" for core features, "medium" for important but not blocking, "low" for nice-to-haves.
8. Do NOT duplicate any existing stories listed below.
9. Identify dependencies between stories. If story B requires story A to be completed first, include A's zero-based index in B's "dependsOn" array.

You MUST respond with ONLY a valid JSON array of story objects. No markdown, no explanation, no code fences. Just the raw JSON array.

Each story object must have this exact shape:
{
  "title": "string",
  "description": "string",
  "acceptanceCriteria": ["string", "string", "string"],
  "priority": "critical" | "high" | "medium" | "low",
  "dependsOn": [0]
}

The "dependsOn" field is an array of zero-based indices of OTHER stories in this array that must be completed first. Use an empty array [] if the story has no dependencies.${memoryContext}${existingContext}`;

  const userPrompt = `Break down the following PRD description into user stories:

## PRD: ${prdRow.name}

${description}${body.context ? `\n\n## Additional Context\n${body.context}` : ''}`;

  try {
    const rawResponse = await callLlm({ system: systemPrompt, user: userPrompt });

    // Parse the JSON response - handle potential markdown code fences
    let rawText = rawResponse.trim();
    // Strip markdown code fences if present
    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    let generatedStories: GeneratedStory[];
    try {
      generatedStories = JSON.parse(rawText);
    } catch {
      return c.json({ ok: false, error: 'Failed to parse AI response as JSON. Try again.' }, 502);
    }

    // Validate the response shape
    if (!Array.isArray(generatedStories) || generatedStories.length === 0) {
      return c.json({ ok: false, error: 'AI returned empty or invalid stories array' }, 502);
    }

    const validPriorities = ['critical', 'high', 'medium', 'low'];
    const filteredStories = generatedStories.filter(
      (s) => s.title && typeof s.title === 'string',
    );
    const validatedStories: GeneratedStory[] = filteredStories.map((s) => ({
      title: s.title.trim(),
      description: (s.description || '').trim(),
      acceptanceCriteria: Array.isArray(s.acceptanceCriteria)
        ? s.acceptanceCriteria
            .filter((ac: any) => typeof ac === 'string' && ac.trim())
            .map((ac: string) => ac.trim())
        : [],
      priority: validPriorities.includes(s.priority) ? s.priority : 'medium',
      // Validate dependency indices: LLM may return as "dependsOn" or "dependsOnIndices"
      dependsOnIndices: (() => {
        const rawDeps = Array.isArray((s as any).dependsOn)
          ? (s as any).dependsOn
          : Array.isArray(s.dependsOnIndices)
            ? s.dependsOnIndices
            : null;
        if (!rawDeps) return undefined;
        const selfIdx = filteredStories.indexOf(s);
        return (rawDeps as any[]).filter(
          (idx: any) =>
            typeof idx === 'number' &&
            Number.isInteger(idx) &&
            idx >= 0 &&
            idx < filteredStories.length &&
            idx !== selfIdx,
        );
      })(),
    }));

    // Ensure each story has at least 3 acceptance criteria
    for (const story of validatedStories) {
      while (story.acceptanceCriteria.length < 3) {
        story.acceptanceCriteria.push(
          `[Needs acceptance criterion ${story.acceptanceCriteria.length + 1}]`,
        );
      }
    }

    return c.json({
      ok: true,
      data: {
        stories: validatedStories,
        prdId,
      },
    });
  } catch (err) {
    return c.json({ ok: false, error: `Story generation failed: ${(err as Error).message}` }, 500);
  }
});

// Accept generated stories — bulk-add them to the PRD
app.post('/:id/generate/accept', async (c) => {
  const db = getDb();
  const prdId = c.req.param('id');
  const body = await c.req.json();

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId);
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const stories: GeneratedStory[] = body.stories;
  if (!Array.isArray(stories) || stories.length === 0) {
    return c.json({ ok: false, error: 'No stories provided' }, 400);
  }

  // Get max sort_order
  const maxRow = db
    .query('SELECT MAX(sort_order) as max_order FROM prd_stories WHERE prd_id = ?')
    .get(prdId) as any;
  let sortOrder = (maxRow?.max_order ?? -1) + 1;

  const now = Date.now();
  const storyInsert = db.query(
    `INSERT INTO prd_stories (id, prd_id, title, description, acceptance_criteria, priority, depends_on, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)`,
  );

  // Pass 1: Insert all stories and collect generated IDs
  const storyIds: string[] = [];
  for (const s of stories) {
    const storyId = nanoid(12);
    storyIds.push(storyId);

    const criteria = (s.acceptanceCriteria || []).map((desc: string) => ({
      id: nanoid(8),
      description: desc,
      passed: false,
    }));

    storyInsert.run(
      storyId,
      prdId,
      s.title,
      s.description || '',
      JSON.stringify(criteria),
      s.priority || 'medium',
      sortOrder++,
      now,
      now,
    );
  }

  // Pass 2: Wire up inter-story dependencies from dependsOnIndices → actual story IDs
  const depUpdate = db.query(
    'UPDATE prd_stories SET depends_on = ?, updated_at = ? WHERE id = ?',
  );
  for (let i = 0; i < stories.length; i++) {
    const indices = stories[i].dependsOnIndices;
    if (Array.isArray(indices) && indices.length > 0) {
      // Map valid indices to their corresponding story IDs
      const depIds = indices
        .filter(
          (idx) =>
            typeof idx === 'number' &&
            Number.isInteger(idx) &&
            idx >= 0 &&
            idx < storyIds.length &&
            idx !== i,
        )
        .map((idx) => storyIds[idx]);

      if (depIds.length > 0) {
        depUpdate.run(JSON.stringify(depIds), now, storyIds[i]);
      }
    }
  }

  // Reorder stories so sort_order respects dependency constraints
  reorderStoriesByDependencies(db, prdId);

  // Touch PRD updated_at
  db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);

  return c.json({ ok: true, data: { storyIds, accepted: stories.length } }, 201);
});

// --- Story Refinement ---

// Refine a story by generating clarifying questions and incorporating answers
app.post('/:prdId/stories/:storyId/refine', async (c) => {
  const db = getDb();
  const prdId = c.req.param('prdId');
  const storyId = c.req.param('storyId');
  const body = (await c.req.json()) as RefineStoryRequest;

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const storyRow = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id = ?')
    .get(storyId, prdId) as any;
  if (!storyRow) return c.json({ ok: false, error: 'Story not found' }, 404);

  const story = storyFromRow(storyRow);

  // Build project memory context
  let memoryContext = '';
  try {
    const memRows = db
      .query(
        `SELECT * FROM workspace_memories WHERE workspace_path = ? AND confidence >= 0.3 ORDER BY category, times_seen DESC LIMIT 30`,
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

  // Build context about existing stories for reference
  const existingStories = db
    .query('SELECT title, description FROM prd_stories WHERE prd_id = ? AND id != ?')
    .all(prdId, storyId) as any[];
  let siblingContext = '';
  if (existingStories.length > 0) {
    siblingContext = '\n\n## Other Stories in this PRD\n';
    for (const s of existingStories) {
      siblingContext += `- ${s.title}: ${s.description}\n`;
    }
  }

  const hasAnswers = body.answers && body.answers.length > 0;

  // Build the prompt based on whether we have answers or this is the initial analysis
  let userPrompt: string;
  if (hasAnswers) {
    const answersText = body.answers!.map((a) => `Q: ${a.questionId}\nA: ${a.answer}`).join('\n\n');
    userPrompt = `The user has answered clarifying questions about this story. Use their answers to refine the story.

## Current Story
Title: ${story.title}
Description: ${story.description}
Priority: ${story.priority}
Acceptance Criteria:
${story.acceptanceCriteria.map((ac: any) => `- ${ac.description}`).join('\n')}

## User's Answers
${answersText}

Based on the answers, please:
1. Assess the story's quality (0-100 score)
2. Generate 2-5 NEW follow-up clarifying questions if quality is still below 80, OR generate 0 questions if the story is now well-defined
3. Provide an updated version of the story incorporating the user's answers
4. Explain what was unclear and how it was improved`;
  } else {
    userPrompt = `Analyze this user story and assess whether it has sufficient detail and clarity for implementation.

## PRD: ${prdRow.name}
${prdRow.description || '(No description)'}

## Story to Refine
Title: ${story.title}
Description: ${story.description}
Priority: ${story.priority}
Acceptance Criteria:
${story.acceptanceCriteria.map((ac: any) => `- ${ac.description}`).join('\n')}

Please:
1. Assess the story's quality (0-100 score). Consider: clarity, specificity, testability of criteria, scope appropriateness, missing details.
2. Generate 2-5 targeted clarifying questions to improve the story
3. For each question, explain why it matters (context)
4. Optionally suggest likely answers for each question
5. Explain what aspects are unclear or could be improved`;
  }

  const systemPrompt = `You are an expert agile coach and technical product manager. Your job is to help refine user stories until they are clear, specific, and implementable.

A well-defined story should:
- Have a clear, specific title that describes the outcome
- Have a description that explains WHAT needs to be done, WHY it matters, and any important context
- Have acceptance criteria that are specific, testable, and complete
- Be appropriately scoped for a single implementation session (a few hours)
- Not have ambiguous terms or undefined behavior
- Consider edge cases and error scenarios

Quality scoring guide:
- 90-100: Excellent — ready for implementation with no ambiguity
- 70-89: Good — minor clarifications might help but story is implementable
- 50-69: Fair — some important details missing, would benefit from refinement
- 30-49: Needs work — multiple areas of ambiguity
- 0-29: Very vague — major details missing, significant refinement needed

You MUST respond with ONLY a valid JSON object. No markdown, no explanation, no code fences. Just the raw JSON.

The JSON must have this exact shape:
{
  "qualityScore": <number 0-100>,
  "qualityExplanation": "<string explaining what is unclear or could be improved>",
  "meetsThreshold": <boolean, true if qualityScore >= 80>,
  "questions": [
    {
      "id": "<unique short id>",
      "question": "<the clarifying question>",
      "context": "<why this question matters for implementation>",
      "suggestedAnswers": ["<optional suggestion 1>", "<optional suggestion 2>"]
    }
  ],
  "improvements": ["<description of improvement 1>", "<description of improvement 2>"],
  "updatedStory": {
    "title": "<refined title>",
    "description": "<refined description>",
    "acceptanceCriteria": ["<criterion 1>", "<criterion 2>", ...],
    "priority": "critical" | "high" | "medium" | "low"
  }
}

IMPORTANT:
- Generate 2-5 questions when the story needs refinement (quality < 80)
- Generate 0 questions when the story meets the quality threshold (quality >= 80)
- The "improvements" array should list specific changes made (only when updatedStory is provided with answers)
- Always provide updatedStory when answers are given
- Questions should be targeted and specific, not generic${memoryContext}${siblingContext}`;

  try {
    const rawResponse = await callLlm({ system: systemPrompt, user: userPrompt });

    // Parse the JSON response
    let rawText = rawResponse.trim();
    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return c.json(
        { ok: false, error: 'Failed to parse AI refinement response as JSON. Try again.' },
        502,
      );
    }

    // Validate and shape the response
    const validPriorities = ['critical', 'high', 'medium', 'low'];
    const questions: RefinementQuestion[] = (parsed.questions || [])
      .filter((q: any) => q.question && typeof q.question === 'string')
      .slice(0, 5)
      .map((q: any) => ({
        id: q.id || nanoid(8),
        question: q.question.trim(),
        context: (q.context || '').trim(),
        suggestedAnswers: Array.isArray(q.suggestedAnswers)
          ? q.suggestedAnswers.filter((s: any) => typeof s === 'string' && s.trim())
          : undefined,
      }));

    const qualityScore =
      typeof parsed.qualityScore === 'number'
        ? Math.max(0, Math.min(100, Math.round(parsed.qualityScore)))
        : 50;

    const response: any = {
      storyId,
      questions,
      qualityScore,
      qualityExplanation: parsed.qualityExplanation || 'No explanation provided.',
      meetsThreshold: qualityScore >= 80,
    };

    if (parsed.updatedStory) {
      response.updatedStory = {
        title: (parsed.updatedStory.title || story.title).trim(),
        description: (parsed.updatedStory.description || story.description).trim(),
        acceptanceCriteria: Array.isArray(parsed.updatedStory.acceptanceCriteria)
          ? parsed.updatedStory.acceptanceCriteria
              .filter((ac: any) => typeof ac === 'string' && ac.trim())
              .map((ac: string) => ac.trim())
          : story.acceptanceCriteria.map((ac: any) => ac.description),
        priority: validPriorities.includes(parsed.updatedStory.priority)
          ? parsed.updatedStory.priority
          : story.priority,
      };
    }

    if (Array.isArray(parsed.improvements)) {
      response.improvements = parsed.improvements
        .filter((imp: any) => typeof imp === 'string' && imp.trim())
        .map((imp: string) => imp.trim());
    }

    // If answers were provided and there's an updated story, auto-apply the refinement
    if (hasAnswers && response.updatedStory) {
      const updated = response.updatedStory;
      const now = Date.now();
      const criteria = updated.acceptanceCriteria.map((desc: string) => ({
        id: nanoid(8),
        description: desc,
        passed: false,
      }));

      db.query(
        `UPDATE prd_stories SET title = ?, description = ?, acceptance_criteria = ?, priority = ?, updated_at = ? WHERE id = ?`,
      ).run(
        updated.title,
        updated.description,
        JSON.stringify(criteria),
        updated.priority,
        now,
        storyId,
      );

      db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);
    }

    return c.json({ ok: true, data: response });
  } catch (err) {
    return c.json({ ok: false, error: `Story refinement failed: ${(err as Error).message}` }, 500);
  }
});

// --- Acceptance Criteria Validation ---

// Validate acceptance criteria for specificity, measurability, and testability
app.post('/:prdId/stories/:storyId/validate-criteria', async (c) => {
  const db = getDb();
  const prdId = c.req.param('prdId');
  const storyId = c.req.param('storyId');
  const body = (await c.req.json()) as ValidateACRequest;

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const storyRow = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id = ?')
    .get(storyId, prdId) as any;
  if (!storyRow) return c.json({ ok: false, error: 'Story not found' }, 404);

  const story = storyFromRow(storyRow);

  // Use criteria from request body or fall back to stored criteria
  const criteria =
    body.criteria && body.criteria.length > 0
      ? body.criteria
      : story.acceptanceCriteria.map((ac: any) => ac.description);

  if (criteria.length === 0) {
    return c.json({ ok: false, error: 'No acceptance criteria to validate' }, 400);
  }

  const criteriaList = criteria.map((c: string, i: number) => `${i + 1}. "${c}"`).join('\n');

  const systemPrompt = `You are an expert agile coach specializing in writing high-quality acceptance criteria. Your task is to validate acceptance criteria for specificity, measurability, and testability.

VALIDATION RULES — check each criterion for:

1. **Specificity (vague)**: Flag criteria using vague language like "should work well", "user-friendly", "fast", "efficient", "appropriate", "proper", "good", "nice", "easy", "simple", "clean", "modern", "intuitive", "seamless", "robust", "scalable", "flexible", "relevant", "suitable", "reasonable", "adequate", etc.

2. **Measurability (unmeasurable)**: Flag criteria that cannot be objectively measured or verified. Good criteria define specific, observable outcomes (e.g., "returns HTTP 200" vs "works correctly").

3. **Testability (untestable)**: Flag criteria that a developer or QA engineer cannot write a concrete test for. Criteria should describe verifiable behavior, not aspirational goals.

4. **Scope (too_broad)**: Flag criteria that try to cover too many things at once or are too vague to implement in a single check.

5. **Ambiguity (ambiguous)**: Flag criteria with unclear terms, undefined references, or multiple possible interpretations.

6. **Missing Detail (missing_detail)**: Flag criteria that omit important specifics like error handling, edge cases, expected values, or user actions.

SEVERITY LEVELS:
- "error": Criterion is fundamentally unclear and MUST be rewritten before implementation
- "warning": Criterion could be improved but is still somewhat usable
- "info": Minor suggestion for improvement

SCORING:
- 90-100: Excellent criteria, specific and testable
- 70-89: Good, minor improvements possible
- 50-69: Fair, some criteria need attention
- 30-49: Poor, multiple criteria need rewriting
- 0-29: Very poor, most criteria are vague or untestable

You MUST respond with ONLY a valid JSON object. No markdown, no explanation, no code fences.

{
  "overallScore": <number 0-100>,
  "allValid": <boolean>,
  "summary": "<brief overall assessment>",
  "criteria": [
    {
      "index": <0-based index>,
      "text": "<the original criterion text>",
      "isValid": <boolean>,
      "issues": [
        {
          "criterionIndex": <same 0-based index>,
          "criterionText": "<the criterion text>",
          "severity": "error" | "warning" | "info",
          "category": "vague" | "unmeasurable" | "untestable" | "too_broad" | "ambiguous" | "missing_detail",
          "message": "<clear explanation of the issue>",
          "suggestedReplacement": "<improved version of this criterion>"
        }
      ],
      "suggestedReplacement": "<improved version if any issues found, or null>"
    }
  ]
}

IMPORTANT:
- Validate EVERY criterion — even ones that pass should appear in the response with isValid: true and empty issues
- For each issue, ALWAYS provide a concrete suggestedReplacement
- Suggestions should be specific, measurable, and testable
- Keep the same intent as the original, just make it clearer
- Do NOT add new requirements — only clarify existing ones`;

  const storyContext = body.storyTitle || story.title;
  const storyDesc = body.storyDescription || story.description;

  const userPrompt = `Validate these acceptance criteria for the story "${storyContext}":

${storyDesc ? `Story Description: ${storyDesc}\n\n` : ''}Acceptance Criteria:
${criteriaList}

Analyze each criterion and identify any issues with specificity, measurability, or testability.`;

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
        { ok: false, error: 'Failed to parse AI validation response as JSON. Try again.' },
        502,
      );
    }

    // Validate and shape the response
    const validSeverities = ['error', 'warning', 'info'];
    const validCategories = [
      'vague',
      'unmeasurable',
      'untestable',
      'too_broad',
      'ambiguous',
      'missing_detail',
    ];

    const validatedCriteria: ACCriterionValidation[] = (parsed.criteria || []).map(
      (cr: any, idx: number) => {
        const issues: ACValidationIssue[] = (cr.issues || [])
          .filter((iss: any) => iss.message && typeof iss.message === 'string')
          .map((iss: any) => ({
            criterionIndex: typeof iss.criterionIndex === 'number' ? iss.criterionIndex : idx,
            criterionText: (iss.criterionText || cr.text || criteria[idx] || '').trim(),
            severity: validSeverities.includes(iss.severity) ? iss.severity : 'warning',
            category: validCategories.includes(iss.category) ? iss.category : 'vague',
            message: iss.message.trim(),
            suggestedReplacement: iss.suggestedReplacement?.trim() || undefined,
          }));

        return {
          index: typeof cr.index === 'number' ? cr.index : idx,
          text: (cr.text || criteria[idx] || '').trim(),
          isValid:
            issues.length === 0 ||
            (cr.isValid === true && issues.every((i: any) => i.severity === 'info')),
          issues,
          suggestedReplacement: cr.suggestedReplacement?.trim() || undefined,
        };
      },
    );

    const overallScore =
      typeof parsed.overallScore === 'number'
        ? Math.max(0, Math.min(100, Math.round(parsed.overallScore)))
        : 50;

    const response: ValidateACResponse = {
      storyId,
      overallScore,
      allValid: validatedCriteria.every((cr) => cr.isValid),
      criteria: validatedCriteria,
      summary: parsed.summary || 'Validation complete.',
    };

    return c.json({ ok: true, data: response });
  } catch (err) {
    return c.json(
      { ok: false, error: `Criteria validation failed: ${(err as Error).message}` },
      500,
    );
  }
});

// --- PRD-Wide Story Refinement ---

// Re-evaluate all pending/in-progress stories in a PRD against current codebase state
app.post('/:prdId/refine-all', async (c) => {
  const db = getDb();
  const prdId = c.req.param('prdId');
  const body = (await c.req.json().catch(() => ({}))) as RefineAllRequest;

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const targetStatuses = body.statuses || ['pending', 'in_progress', 'failed'];
  const includeCodeScan = body.includeCodeScan !== false; // default true

  // Load all stories for the PRD
  const allStoryRows = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC')
    .all(prdId) as any[];
  const allStories = allStoryRows.map(storyFromRow);

  const targetStories = allStories.filter((s) => targetStatuses.includes(s.status));
  const completedStories = allStories.filter((s) => s.status === 'completed' || s.status === 'qa');

  if (targetStories.length === 0) {
    return c.json({
      ok: true,
      data: {
        prdId,
        summary: 'No stories match the target statuses for refinement.',
        storyRecommendations: [],
        suggestedNewStories: [],
      },
    });
  }

  // Build codebase context
  let codebaseContext = '';
  if (includeCodeScan) {
    try {
      const { spawnSync } = Bun;
      const cwd = prdRow.workspace_path;

      // Recent git log
      const logProc = spawnSync(['git', 'log', '--oneline', '-20'], {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const gitLog = new TextDecoder().decode(logProc.stdout).trim();
      if (gitLog) {
        codebaseContext += `\n### Recent Git History\n\`\`\`\n${gitLog}\n\`\`\`\n`;
      }

      // Git diff stat (what's changed since last commit)
      const diffProc = spawnSync(['git', 'diff', '--stat', 'HEAD'], {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const diffStat = new TextDecoder().decode(diffProc.stdout).trim();
      if (diffStat) {
        codebaseContext += `\n### Uncommitted Changes\n\`\`\`\n${diffStat}\n\`\`\`\n`;
      }

      // Directory structure (top-level overview)
      const treeProc = spawnSync(
        [
          'find',
          '.',
          '-maxdepth',
          '3',
          '-type',
          'f',
          '-not',
          '-path',
          '*/node_modules/*',
          '-not',
          '-path',
          '*/.git/*',
        ],
        { cwd, stdout: 'pipe', stderr: 'pipe' },
      );
      const treeOutput = new TextDecoder().decode(treeProc.stdout).trim();
      if (treeOutput) {
        const treeLines = treeOutput.split('\n').slice(0, 80);
        codebaseContext += `\n### Project Structure (top files)\n\`\`\`\n${treeLines.join('\n')}\n\`\`\`\n`;
      }
    } catch {
      /* codebase scan is best-effort */
    }
  }

  // Build project memory context
  let memoryContext = '';
  try {
    const memRows = db
      .query(
        `SELECT * FROM workspace_memories WHERE workspace_path = ? AND confidence >= 0.3 ORDER BY category, times_seen DESC LIMIT 30`,
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

  // Build the stories context
  let storiesContext = '\n## Stories to Evaluate\n';
  for (const s of targetStories) {
    storiesContext += `\n### [${s.status.toUpperCase()}] ${s.title} (id: ${s.id})\n`;
    storiesContext += `Priority: ${s.priority} | Attempts: ${s.attempts}\n`;
    if (s.description) storiesContext += `Description: ${s.description}\n`;
    storiesContext += `Acceptance Criteria:\n`;
    for (const ac of s.acceptanceCriteria) {
      storiesContext += `  - ${ac.description}\n`;
    }
    if (s.learnings.length > 0) {
      storiesContext += `Learnings from previous attempts:\n`;
      for (const l of s.learnings) {
        storiesContext += `  - ${l}\n`;
      }
    }
  }

  let completedContext = '';
  if (completedStories.length > 0) {
    completedContext = '\n## Already Completed Stories\n';
    for (const s of completedStories) {
      completedContext += `- ✅ ${s.title}`;
      if (s.learnings.length > 0) completedContext += ` (learnings: ${s.learnings.join('; ')})`;
      completedContext += '\n';
    }
  }

  const systemPrompt = `You are an expert technical product manager re-evaluating a PRD's stories against the current state of the codebase.

Your job is to analyze each pending/in-progress story and recommend whether it should be kept as-is, updated, split, merged with another story, removed, or marked as already done.

## Decision Framework

For each story, consider:
1. **Already implemented?** — Has the work described already been done (by a completed story or manual changes)?
2. **Still relevant?** — Does the story still make sense given completed work and codebase state?
3. **Scope correct?** — Is the story appropriately scoped, or should it be split/merged?
4. **Acceptance criteria current?** — Are the criteria still accurate given what's been built?
5. **Priority still correct?** — Has the priority changed based on dependencies or completed work?
6. **Gaps?** — Are there missing stories that should exist based on the current codebase state?

## Actions
- **keep**: Story is fine as-is, no changes needed
- **update**: Story needs updated description, criteria, or priority
- **split**: Story is too large or covers multiple concerns — suggest how to split
- **merge**: Story overlaps with another story — identify which ones to merge
- **remove**: Story is no longer needed (duplicate, superseded, or irrelevant)
- **already_done**: The work described has already been implemented

You MUST respond with ONLY a valid JSON object. No markdown, no explanation, no code fences.

{
  "summary": "<1-3 sentence overall assessment of the PRD's current state>",
  "storyRecommendations": [
    {
      "storyId": "<id>",
      "storyTitle": "<current title>",
      "action": "keep" | "update" | "split" | "merge" | "remove" | "already_done",
      "reason": "<clear explanation for the recommendation>",
      "suggestedChanges": {
        "title": "<new title if updating>",
        "description": "<new description if updating>",
        "acceptanceCriteria": ["<updated criteria>"],
        "priority": "critical" | "high" | "medium" | "low"
      },
      "mergeWith": ["<storyId>"]
    }
  ],
  "suggestedNewStories": [
    {
      "title": "<title for a gap story>",
      "description": "<what needs to be done and why>",
      "acceptanceCriteria": ["<specific, testable criteria>"],
      "priority": "critical" | "high" | "medium" | "low",
      "reason": "<why this gap exists>"
    }
  ]
}

IMPORTANT:
- Every target story MUST appear in storyRecommendations
- suggestedChanges is optional (only when action is "update")
- mergeWith is optional (only when action is "merge")
- suggestedNewStories can be empty if no gaps found
- Be specific in reasons — reference actual code/stories
- Keep recommendations actionable and concise${memoryContext}`;

  const userPrompt = `## PRD: ${prdRow.name}
${prdRow.description || '(No description)'}
${codebaseContext}${completedContext}${storiesContext}

Re-evaluate these ${targetStories.length} stories against the current codebase state. Identify stories that are stale, redundant, already implemented, need updating, or should be split/merged. Also identify any gaps that need new stories.`;

  try {
    const rawResponse = await callLlm({ system: systemPrompt, user: userPrompt });

    // Parse the JSON response
    let rawText = rawResponse.trim();
    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return c.json(
        { ok: false, error: 'Failed to parse AI refinement response as JSON. Try again.' },
        502,
      );
    }

    // Validate and shape the response
    const validActions = ['keep', 'update', 'split', 'merge', 'remove', 'already_done'];
    const validPriorities = ['critical', 'high', 'medium', 'low'];

    const storyRecommendations: StoryRecommendation[] = (parsed.storyRecommendations || [])
      .filter((r: any) => r.storyId && r.action)
      .map((r: any) => {
        const rec: StoryRecommendation = {
          storyId: r.storyId,
          storyTitle: r.storyTitle || targetStories.find((s) => s.id === r.storyId)?.title || '',
          action: validActions.includes(r.action) ? r.action : 'keep',
          reason: (r.reason || 'No reason provided').trim(),
        };
        if (r.suggestedChanges && rec.action === 'update') {
          rec.suggestedChanges = {};
          if (r.suggestedChanges.title)
            rec.suggestedChanges.title = r.suggestedChanges.title.trim();
          if (r.suggestedChanges.description)
            rec.suggestedChanges.description = r.suggestedChanges.description.trim();
          if (Array.isArray(r.suggestedChanges.acceptanceCriteria)) {
            rec.suggestedChanges.acceptanceCriteria = r.suggestedChanges.acceptanceCriteria
              .filter((ac: any) => typeof ac === 'string' && ac.trim())
              .map((ac: string) => ac.trim());
          }
          if (validPriorities.includes(r.suggestedChanges.priority)) {
            rec.suggestedChanges.priority = r.suggestedChanges.priority;
          }
        }
        if (Array.isArray(r.mergeWith) && rec.action === 'merge') {
          rec.mergeWith = r.mergeWith.filter((id: any) => typeof id === 'string' && id.trim());
        }
        return rec;
      });

    const suggestedNewStories: SuggestedNewStory[] = (parsed.suggestedNewStories || [])
      .filter((s: any) => s.title && typeof s.title === 'string')
      .slice(0, 10)
      .map((s: any) => ({
        title: s.title.trim(),
        description: (s.description || '').trim(),
        acceptanceCriteria: Array.isArray(s.acceptanceCriteria)
          ? s.acceptanceCriteria
              .filter((ac: any) => typeof ac === 'string' && ac.trim())
              .map((ac: string) => ac.trim())
          : [],
        priority: validPriorities.includes(s.priority) ? s.priority : 'medium',
        reason: (s.reason || '').trim(),
      }));

    return c.json({
      ok: true,
      data: {
        prdId,
        summary: (parsed.summary || 'Analysis complete.').trim(),
        storyRecommendations,
        suggestedNewStories,
      },
    });
  } catch (err) {
    return c.json(
      { ok: false, error: `PRD-wide refinement failed: ${(err as Error).message}` },
      500,
    );
  }
});

export default app;
