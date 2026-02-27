import { Hono } from 'hono';
import { getDb, storyFromRow, callLlm, buildEstimateSummary } from './helpers';
import type {
  EstimateStoryRequest,
  EstimatePrdRequest,
  StoryEstimate,
  StorySize,
  EstimateConfidence,
  EstimationFactor,
  AnalyzePrdCompletenessRequest,
  AnalyzePrdCompletenessResponse,
  PRDCompletenessAnalysis,
  PRDSectionAnalysis,
  PRDSectionName,
  PRDSectionSeverity,
} from './helpers';

const app = new Hono();

// --- Story Estimation ---

// Estimate complexity for a single story
app.post('/:prdId/stories/:storyId/estimate', async (c) => {
  const db = getDb();
  const prdId = c.req.param('prdId');
  const storyId = c.req.param('storyId');
  const body = (await c.req.json()) as EstimateStoryRequest;

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const storyRow = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id = ?')
    .get(storyId, prdId) as any;
  if (!storyRow) return c.json({ ok: false, error: 'Story not found' }, 404);

  const story = storyFromRow(storyRow);

  // Build context: all stories in the PRD for relative sizing
  const allStories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC')
    .all(prdId) as any[];
  const mappedStories = allStories.map(storyFromRow);

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

  // Build sibling stories context for relative sizing
  let siblingContext = '';
  const otherStories = mappedStories.filter((s) => s.id !== storyId);
  if (otherStories.length > 0) {
    siblingContext = '\n\n## Other Stories in this PRD (for relative sizing)\n';
    for (const s of otherStories) {
      const acCount = s.acceptanceCriteria?.length || 0;
      const existingEstimate = s.estimate
        ? ` [Estimated: ${s.estimate.size}, ${s.estimate.storyPoints}pts]`
        : '';
      siblingContext += `- ${s.title}: ${s.description} (${acCount} criteria)${existingEstimate}\n`;
    }
  }

  const criteriaText = story.acceptanceCriteria.map((ac: any) => `- ${ac.description}`).join('\n');

  const depsCount = story.dependsOn?.length || 0;

  const systemPrompt = `You are an expert software project estimator. Your task is to provide complexity and effort estimates for user stories based on their content, acceptance criteria, and context.

ESTIMATION FRAMEWORK:
Use a combination of story points (Fibonacci: 1, 2, 3, 5, 8, 13) and t-shirt sizes (small, medium, large).

Mapping guide:
- **small** (1-2 points): Simple, well-understood tasks. Single file changes, minor UI tweaks, simple config, clear patterns to follow.
- **medium** (3-5 points): Moderate complexity. Multiple files, new components, API endpoints with some logic, database changes, moderate testing.
- **large** (8-13 points): Complex tasks. Cross-cutting concerns, new architectures, multiple integration points, significant testing, unknowns.

CONFIDENCE LEVELS:
- **high** (80-100): Story is well-defined, acceptance criteria are specific and testable, scope is clear.
- **medium** (50-79): Story is mostly clear but some ambiguity exists, some criteria could be more specific.
- **low** (0-49): Story is vague, criteria are unclear, significant unknowns or ambiguity.

FACTORS TO CONSIDER:
1. Number and complexity of acceptance criteria
2. Whether the story requires new architecture or follows existing patterns
3. Number of integration points (APIs, databases, external services)
4. UI complexity (forms, validation, state management)
5. Testing requirements (unit, integration, E2E)
6. Dependencies on other stories
7. Clarity and specificity of requirements
8. Potential for scope creep or hidden complexity
9. Whether similar work has been done before in the project

You MUST respond with ONLY a valid JSON object. No markdown, no explanation, no code fences.

{
  "size": "small" | "medium" | "large",
  "storyPoints": <1 | 2 | 3 | 5 | 8 | 13>,
  "confidence": "low" | "medium" | "high",
  "confidenceScore": <number 0-100>,
  "factors": [
    {
      "factor": "<description of the factor>",
      "impact": "increases" | "decreases" | "neutral",
      "weight": "minor" | "moderate" | "major"
    }
  ],
  "reasoning": "<2-3 sentence explanation of the estimate>",
  "suggestedBreakdown": ["<sub-task 1>", "<sub-task 2>"] // only for large stories (8+ points)
}

IMPORTANT:
- Provide 3-6 factors that influenced your estimate
- Be specific in factor descriptions (not generic)
- suggestedBreakdown is ONLY for stories estimated at 8+ points
- Confidence should reflect story clarity, NOT your confidence in your own estimate
- Consider the project context and existing patterns when estimating${memoryContext}${siblingContext}`;

  const userPrompt = `Estimate the complexity of this user story:

## PRD: ${prdRow.name}
${prdRow.description || '(No description)'}

## Story to Estimate
Title: ${story.title}
Description: ${story.description}
Priority: ${story.priority}
Dependencies: ${depsCount > 0 ? `Depends on ${depsCount} other story(ies)` : 'None'}
Acceptance Criteria:
${criteriaText || '(No criteria defined)'}

Provide a complexity estimate with story points, confidence level, and key factors.`;

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
        { ok: false, error: 'Failed to parse AI estimation response as JSON. Try again.' },
        502,
      );
    }

    // Validate and normalize
    const validSizes: StorySize[] = ['small', 'medium', 'large'];
    const validPoints = [1, 2, 3, 5, 8, 13];
    const validConfidences: EstimateConfidence[] = ['low', 'medium', 'high'];

    const size: StorySize = validSizes.includes(parsed.size) ? parsed.size : 'medium';
    const storyPoints = validPoints.includes(parsed.storyPoints)
      ? parsed.storyPoints
      : size === 'small'
        ? 2
        : size === 'medium'
          ? 5
          : 8;
    const confidence: EstimateConfidence = validConfidences.includes(parsed.confidence)
      ? parsed.confidence
      : 'medium';
    const confidenceScore =
      typeof parsed.confidenceScore === 'number'
        ? Math.max(0, Math.min(100, Math.round(parsed.confidenceScore)))
        : confidence === 'high'
          ? 85
          : confidence === 'medium'
            ? 60
            : 30;

    const factors: EstimationFactor[] = (parsed.factors || [])
      .filter((f: any) => f.factor && typeof f.factor === 'string')
      .slice(0, 6)
      .map((f: any) => ({
        factor: f.factor.trim(),
        impact: ['increases', 'decreases', 'neutral'].includes(f.impact) ? f.impact : 'neutral',
        weight: ['minor', 'moderate', 'major'].includes(f.weight) ? f.weight : 'moderate',
      }));

    const estimate: StoryEstimate = {
      storyId,
      size,
      storyPoints,
      confidence,
      confidenceScore,
      factors,
      reasoning: (parsed.reasoning || 'Estimate based on story content analysis.').trim(),
      suggestedBreakdown:
        storyPoints >= 8 && Array.isArray(parsed.suggestedBreakdown)
          ? parsed.suggestedBreakdown
              .filter((s: any) => typeof s === 'string' && s.trim())
              .map((s: string) => s.trim())
          : undefined,
      isManualOverride: false,
    };

    // Persist estimate to database
    const now = Date.now();
    db.query('UPDATE prd_stories SET estimate = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(estimate),
      now,
      storyId,
    );
    db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);

    return c.json({
      ok: true,
      data: { storyId, estimate },
    });
  } catch (err) {
    return c.json({ ok: false, error: `Story estimation failed: ${(err as Error).message}` }, 500);
  }
});

// Save a manual estimate override for a story
app.put('/:prdId/stories/:storyId/estimate', async (c) => {
  const db = getDb();
  const prdId = c.req.param('prdId');
  const storyId = c.req.param('storyId');
  const body = await c.req.json();

  const storyRow = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id = ?')
    .get(storyId, prdId) as any;
  if (!storyRow) return c.json({ ok: false, error: 'Story not found' }, 404);

  const validSizes: StorySize[] = ['small', 'medium', 'large'];
  const validPoints = [1, 2, 3, 5, 8, 13];

  if (!validSizes.includes(body.size)) {
    return c.json({ ok: false, error: 'Invalid size. Must be small, medium, or large.' }, 400);
  }
  if (!validPoints.includes(body.storyPoints)) {
    return c.json({ ok: false, error: 'Invalid story points. Must be 1, 2, 3, 5, 8, or 13.' }, 400);
  }

  // Build the manual estimate, preserving any existing AI factors
  const existingEstimate = storyRow.estimate ? JSON.parse(storyRow.estimate) : {};

  const estimate: StoryEstimate = {
    storyId,
    size: body.size,
    storyPoints: body.storyPoints,
    confidence: existingEstimate.confidence || 'high',
    confidenceScore: existingEstimate.confidenceScore || 90,
    factors: existingEstimate.factors || [],
    reasoning: body.reasoning || existingEstimate.reasoning || 'Manual estimate.',
    suggestedBreakdown: existingEstimate.suggestedBreakdown,
    isManualOverride: true,
  };

  const now = Date.now();
  db.query('UPDATE prd_stories SET estimate = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(estimate),
    now,
    storyId,
  );
  db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);

  return c.json({ ok: true, data: { storyId, estimate } });
});

// Estimate all stories in a PRD
app.post('/:id/estimate', async (c) => {
  const db = getDb();
  const prdId = c.req.param('id');
  const body = (await c.req.json()) as EstimatePrdRequest;

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const stories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC')
    .all(prdId) as any[];

  if (stories.length === 0) {
    return c.json({ ok: false, error: 'No stories to estimate' }, 400);
  }

  const mappedStories = stories.map(storyFromRow);

  // Filter: skip stories that already have estimates unless reEstimate is true
  const storiesToEstimate = body.reEstimate
    ? mappedStories
    : mappedStories.filter((s) => !s.estimate || s.estimate.isManualOverride === false);

  if (storiesToEstimate.length === 0) {
    // All stories already estimated — return current data
    const allEstimates = mappedStories.filter((s) => s.estimate).map((s) => s.estimate!);
    return c.json({
      ok: true,
      data: buildEstimateSummary(prdId, allEstimates),
    });
  }

  // Build context for batch estimation
  let storiesContext = '';
  for (const s of mappedStories) {
    const criteria = s.acceptanceCriteria.map((ac: any) => `  - ${ac.description}`).join('\n');
    const existingEstimate =
      s.estimate && !storiesToEstimate.find((st) => st.id === s.id)
        ? ` [Already estimated: ${s.estimate.size}, ${s.estimate.storyPoints}pts]`
        : '';
    storiesContext += `\n### Story "${s.title}" (ID: ${s.id}) [${s.priority}]${existingEstimate}
${s.description}
Dependencies: ${s.dependsOn?.length || 0}
Acceptance Criteria:
${criteria || '(None)'}\n`;
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

  const storyIdsToEstimate = storiesToEstimate.map((s) => s.id);

  const systemPrompt = `You are an expert software project estimator. Estimate ALL stories listed below for relative sizing and complexity.

ESTIMATION FRAMEWORK:
- **small** (1-2 points): Simple, well-understood. Single file, minor changes, clear patterns.
- **medium** (3-5 points): Moderate complexity. Multiple files, new components, API endpoints with logic.
- **large** (8-13 points): Complex. Cross-cutting concerns, new architecture, many integration points, unknowns.

CONFIDENCE LEVELS:
- **high** (80-100): Well-defined, specific criteria, clear scope.
- **medium** (50-79): Mostly clear but some ambiguity.
- **low** (0-49): Vague, unclear criteria, significant unknowns.

IMPORTANT: Estimate stories RELATIVE to each other — the smallest should be "small" and the most complex "large". Not all stories need to be the same size.

Only estimate stories with these IDs: ${storyIdsToEstimate.join(', ')}

You MUST respond with ONLY a valid JSON array. No markdown, no explanation, no code fences.

Each element must have:
{
  "storyId": "<story ID>",
  "size": "small" | "medium" | "large",
  "storyPoints": <1 | 2 | 3 | 5 | 8 | 13>,
  "confidence": "low" | "medium" | "high",
  "confidenceScore": <0-100>,
  "factors": [
    { "factor": "<description>", "impact": "increases" | "decreases" | "neutral", "weight": "minor" | "moderate" | "major" }
  ],
  "reasoning": "<2-3 sentence explanation>",
  "suggestedBreakdown": ["<sub-task>"] // only for 8+ point stories
}${memoryContext}`;

  const userPrompt = `Estimate the complexity of each story in this PRD:

## PRD: ${prdRow.name}
${prdRow.description || '(No description)'}
${storiesContext}

Provide relative complexity estimates for all stories that need estimation.`;

  try {
    const rawResponse = await callLlm({ system: systemPrompt, user: userPrompt });

    let rawText = rawResponse.trim();
    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    let parsedEstimates: any[];
    try {
      parsedEstimates = JSON.parse(rawText);
    } catch {
      return c.json(
        { ok: false, error: 'Failed to parse AI estimation response as JSON. Try again.' },
        502,
      );
    }

    if (!Array.isArray(parsedEstimates)) {
      return c.json({ ok: false, error: 'AI returned invalid estimation format' }, 502);
    }

    const validSizes: StorySize[] = ['small', 'medium', 'large'];
    const validPoints = [1, 2, 3, 5, 8, 13];
    const validConfidences: EstimateConfidence[] = ['low', 'medium', 'high'];
    const storyIdSet = new Set(storyIdsToEstimate);

    const estimates: StoryEstimate[] = [];
    const now = Date.now();

    for (const pe of parsedEstimates) {
      if (!pe.storyId || !storyIdSet.has(pe.storyId)) continue;

      const size: StorySize = validSizes.includes(pe.size) ? pe.size : 'medium';
      const storyPoints = validPoints.includes(pe.storyPoints)
        ? pe.storyPoints
        : size === 'small'
          ? 2
          : size === 'medium'
            ? 5
            : 8;
      const confidence: EstimateConfidence = validConfidences.includes(pe.confidence)
        ? pe.confidence
        : 'medium';
      const confidenceScore =
        typeof pe.confidenceScore === 'number'
          ? Math.max(0, Math.min(100, Math.round(pe.confidenceScore)))
          : confidence === 'high'
            ? 85
            : confidence === 'medium'
              ? 60
              : 30;

      const factors: EstimationFactor[] = (pe.factors || [])
        .filter((f: any) => f.factor && typeof f.factor === 'string')
        .slice(0, 6)
        .map((f: any) => ({
          factor: f.factor.trim(),
          impact: ['increases', 'decreases', 'neutral'].includes(f.impact) ? f.impact : 'neutral',
          weight: ['minor', 'moderate', 'major'].includes(f.weight) ? f.weight : 'moderate',
        }));

      const estimate: StoryEstimate = {
        storyId: pe.storyId,
        size,
        storyPoints,
        confidence,
        confidenceScore,
        factors,
        reasoning: (pe.reasoning || 'Estimated based on story content.').trim(),
        suggestedBreakdown:
          storyPoints >= 8 && Array.isArray(pe.suggestedBreakdown)
            ? pe.suggestedBreakdown
                .filter((s: any) => typeof s === 'string' && s.trim())
                .map((s: string) => s.trim())
            : undefined,
        isManualOverride: false,
      };

      estimates.push(estimate);

      // Persist to database
      db.query('UPDATE prd_stories SET estimate = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(estimate),
        now,
        pe.storyId,
      );
    }

    db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);

    // Combine with existing estimates that weren't re-estimated
    const allEstimates = [
      ...estimates,
      ...mappedStories.filter((s) => s.estimate && !storyIdSet.has(s.id)).map((s) => s.estimate!),
    ];

    return c.json({
      ok: true,
      data: buildEstimateSummary(prdId, allEstimates),
    });
  } catch (err) {
    return c.json({ ok: false, error: `Bulk estimation failed: ${(err as Error).message}` }, 500);
  }
});

// --- PRD Completeness Analysis ---

// Analyze PRD content for completeness, missing sections, and gaps
app.post('/:id/completeness', async (c) => {
  const db = getDb();
  const prdId = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as AnalyzePrdCompletenessRequest;

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const stories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(prdId) as any[];

  const mappedStories = stories.map(storyFromRow);

  // Build a comprehensive view of the PRD for AI analysis
  let storiesContext = '';
  if (mappedStories.length > 0) {
    storiesContext = '\n## Existing Stories\n';
    for (const s of mappedStories) {
      const criteria = s.acceptanceCriteria.map((ac: any) => `  - ${ac.description}`).join('\n');
      storiesContext += `\n### ${s.title}\n`;
      if (s.description) storiesContext += `Description: ${s.description}\n`;
      if (criteria) storiesContext += `Acceptance Criteria:\n${criteria}\n`;
      storiesContext += `Priority: ${s.priority}\n`;
      if (s.estimate)
        storiesContext += `Estimate: ${s.estimate.size} (${s.estimate.storyPoints}pts)\n`;
    }
  }

  // Get project memory for additional context
  let memoryContext = '';
  try {
    const memories = db
      .query(
        'SELECT category, key, content FROM workspace_memories WHERE workspace_path = ? ORDER BY category, key',
      )
      .all(prdRow.workspace_path) as any[];
    if (memories.length > 0) {
      memoryContext = '\n\n## Project Memory\n';
      for (const m of memories.slice(0, 10)) {
        memoryContext += `- [${m.category}] ${m.key}: ${m.content}\n`;
      }
    }
  } catch {
    /* no project memory */
  }

  const standardSections: Array<{
    name: PRDSectionName;
    label: string;
    severity: PRDSectionSeverity;
  }> = [
    { name: 'goals', label: 'Goals & Objectives', severity: 'critical' },
    { name: 'scope', label: 'Scope & Boundaries', severity: 'critical' },
    { name: 'success_metrics', label: 'Success Metrics & KPIs', severity: 'critical' },
    { name: 'constraints', label: 'Constraints & Limitations', severity: 'warning' },
    { name: 'user_personas', label: 'User Personas & Target Audience', severity: 'warning' },
    { name: 'requirements', label: 'Functional Requirements', severity: 'critical' },
    { name: 'assumptions', label: 'Assumptions', severity: 'info' },
    { name: 'risks', label: 'Risks & Mitigations', severity: 'warning' },
    { name: 'timeline', label: 'Timeline & Milestones', severity: 'info' },
    { name: 'dependencies', label: 'External Dependencies', severity: 'info' },
  ];

  // Filter to only requested sections if specified
  const sectionsToAnalyze = body.sections
    ? standardSections.filter((s) => body.sections!.includes(s.name))
    : standardSections;

  const sectionsListStr = sectionsToAnalyze
    .map((s) => `- "${s.name}" (label: "${s.label}", default_severity: "${s.severity}")`)
    .join('\n');

  const systemPrompt = `You are a PRD (Product Requirements Document) analysis expert. Your job is to evaluate the completeness and quality of a PRD by checking for standard sections, identifying gaps, and suggesting improvements.

## PRD to Analyze

### Title: ${prdRow.name}
### Description:
${prdRow.description || '(No description provided)'}
${storiesContext}
${memoryContext}

## Standard PRD Sections to Check
${sectionsListStr}

## Your Task
Analyze the PRD content above and evaluate each section. For each section:
1. Determine if it is present (even if not explicitly labeled, content may cover the section)
2. Score its quality from 0-100 (0 = completely missing, 100 = thorough and well-defined)
3. Provide specific feedback about what's missing or could be improved
4. Suggest 1-3 specific questions that would help fill any gaps

Also provide:
- An overall completeness score (0-100) weighted by section severity
- A brief summary assessment
- Top 3-5 critical questions that would most improve the PRD

You MUST respond with ONLY a valid JSON object. No markdown, no explanation, no code fences.

{
  "overallScore": 75,
  "overallLabel": "Good",
  "summary": "Brief assessment of the PRD's overall completeness",
  "sections": [
    {
      "section": "goals",
      "label": "Goals & Objectives",
      "present": true,
      "severity": "critical",
      "score": 80,
      "feedback": "What's good and what's missing",
      "questions": ["Specific question to improve this section"]
    }
  ],
  "suggestedQuestions": ["Top priority question 1", "Top priority question 2"]
}

IMPORTANT:
- Be thorough but fair — content may implicitly address a section without a formal heading
- The overallLabel should be: "Excellent" (90+), "Good" (70-89), "Fair" (50-69), "Needs Work" (30-49), or "Incomplete" (<30)
- Weight critical sections more heavily in the overall score
- Questions should be specific and actionable, not generic
- Every section from the list MUST appear in the output
- Score 0 only if a section is completely absent with no related content`;

  const userPrompt = `Analyze this PRD for completeness. Check all ${sectionsToAnalyze.length} standard sections and identify any gaps, weak areas, or missing details that could cause problems during implementation.`;

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
        { ok: false, error: 'Failed to parse AI completeness analysis as JSON. Try again.' },
        502,
      );
    }

    // Validate and build the response
    const overallScore =
      typeof parsed.overallScore === 'number'
        ? Math.max(0, Math.min(100, Math.round(parsed.overallScore)))
        : 0;

    const overallLabel =
      typeof parsed.overallLabel === 'string'
        ? parsed.overallLabel
        : overallScore >= 90
          ? 'Excellent'
          : overallScore >= 70
            ? 'Good'
            : overallScore >= 50
              ? 'Fair'
              : overallScore >= 30
                ? 'Needs Work'
                : 'Incomplete';

    const sections: PRDSectionAnalysis[] = [];
    const parsedSections = Array.isArray(parsed.sections) ? parsed.sections : [];

    // Ensure all requested sections are represented
    for (const standardSection of sectionsToAnalyze) {
      const found = parsedSections.find((ps: any) => ps.section === standardSection.name);
      if (found) {
        sections.push({
          section: standardSection.name,
          label: standardSection.label,
          present: !!found.present,
          severity: standardSection.severity,
          score:
            typeof found.score === 'number'
              ? Math.max(0, Math.min(100, Math.round(found.score)))
              : 0,
          feedback: typeof found.feedback === 'string' ? found.feedback : 'No analysis available',
          questions: Array.isArray(found.questions)
            ? found.questions.filter((q: any) => typeof q === 'string')
            : [],
        });
      } else {
        // Section was not analyzed by AI — mark as missing
        sections.push({
          section: standardSection.name,
          label: standardSection.label,
          present: false,
          severity: standardSection.severity,
          score: 0,
          feedback: 'This section was not found in the PRD.',
          questions: [`What are the ${standardSection.label.toLowerCase()} for this project?`],
        });
      }
    }

    const suggestedQuestions = Array.isArray(parsed.suggestedQuestions)
      ? parsed.suggestedQuestions.filter((q: any) => typeof q === 'string')
      : sections
          .filter((s) => !s.present || s.score < 50)
          .flatMap((s) => s.questions)
          .slice(0, 5);

    const analysis: PRDCompletenessAnalysis = {
      prdId,
      overallScore,
      overallLabel,
      sections,
      summary:
        typeof parsed.summary === 'string' ? parsed.summary : `PRD completeness: ${overallScore}%`,
      suggestedQuestions,
      analyzedAt: Date.now(),
    };

    const response: AnalyzePrdCompletenessResponse = {
      prdId,
      analysis,
    };

    return c.json({ ok: true, data: response });
  } catch (err) {
    return c.json(
      { ok: false, error: `PRD completeness analysis failed: ${(err as Error).message}` },
      500,
    );
  }
});

export default app;
