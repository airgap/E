/**
 * Skill & Rule Proposal Generator
 *
 * Generates skill and rule proposals based on detected patterns.
 */

import { getDb } from '../db/database';
import { nanoid } from 'nanoid';
import type { PatternDetection, SkillProposal, ProposalType } from '@e/shared';
import { generateSkillMd } from '../routes/skills-registry/discovery';

/**
 * Generate a skill or rule proposal from a detected pattern
 */
export async function generateProposal(
  pattern: PatternDetection,
  proposalType: ProposalType = 'skill',
): Promise<SkillProposal> {
  const db = getDb();
  const now = Date.now();
  const id = nanoid();

  // Generate proposal content based on pattern type
  const proposal = await generateProposalContent(pattern, proposalType);

  // Create proposal record
  db.query(
    `INSERT INTO skill_proposals
     (id, workspace_path, pattern_id, proposal_type, status, name, description,
      content, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    pattern.workspacePath,
    pattern.id,
    proposalType,
    proposal.name,
    proposal.description,
    proposal.content,
    JSON.stringify({
      category: proposal.category,
      tags: proposal.tags,
      rationale: proposal.rationale,
      examples: proposal.examples,
    }),
    now,
    now,
  );

  return {
    id,
    workspacePath: pattern.workspacePath,
    patternId: pattern.id,
    proposalType,
    status: 'pending',
    name: proposal.name,
    description: proposal.description,
    content: proposal.content,
    metadata: {
      category: proposal.category,
      tags: proposal.tags,
      rationale: proposal.rationale,
      examples: proposal.examples,
    },
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Generate proposal content (skill or rule markdown)
 */
async function generateProposalContent(
  pattern: PatternDetection,
  proposalType: ProposalType,
): Promise<{
  name: string;
  description: string;
  category: string;
  content: string;
  tags: string[];
  rationale: string;
  examples: string[];
}> {
  // Map pattern types to skill/rule names and content
  const proposalTemplates: Record<
    string,
    {
      name: string;
      description: string;
      category: string;
      tags: string[];
      promptTemplate: string;
      rules: string[];
    }
  > = {
    refactoring: {
      name: 'Code Refactoring Assistant',
      description: 'Automated code refactoring based on detected patterns',
      category: 'refactoring',
      tags: ['refactoring', 'code-quality', 'automation'],
      promptTemplate: `When refactoring code, follow these steps:

1. Identify code smells and improvement opportunities
2. Apply pattern: ${pattern.description}
3. Preserve existing behavior and tests
4. Apply incremental, reviewable changes
5. Update documentation and tests as needed`,
      rules: [
        'Never change behavior while refactoring',
        'Make small, atomic changes',
        'Always run tests after refactoring',
        'Update documentation to reflect changes',
      ],
    },
    workflow: {
      name: 'Workflow Automation',
      description: 'Automate recurring multi-step workflows',
      category: 'workflow',
      tags: ['workflow', 'automation', 'efficiency'],
      promptTemplate: `Execute this recurring workflow pattern:

${pattern.description}

Steps:
1. Validate inputs and preconditions
2. Execute each step systematically
3. Handle errors gracefully
4. Verify completion and outcomes`,
      rules: [
        'Validate inputs before starting',
        'Handle errors gracefully',
        'Log progress at each step',
        'Verify outcomes',
      ],
    },
    'tool-usage': {
      name: 'Tool Usage Assistant',
      description: 'Optimize repeated tool usage patterns',
      category: 'tool-usage',
      tags: ['tools', 'automation', 'efficiency'],
      promptTemplate: `When using tools, follow this pattern:

${pattern.description}

Apply this approach consistently.`,
      rules: ['Use tools efficiently', 'Cache results when appropriate'],
    },
    'problem-solving': {
      name: 'Problem Solving Assistant',
      description: 'Systematic problem-solving approach',
      category: 'problem-solving',
      tags: ['debugging', 'troubleshooting'],
      promptTemplate: `Follow this systematic approach:

${pattern.description}`,
      rules: ['Identify root cause', 'Apply minimal fixes', 'Verify solutions'],
    },
    'file-pattern': {
      name: 'File Pattern Assistant',
      description: 'Automated file operation patterns',
      category: 'file-pattern',
      tags: ['files', 'automation'],
      promptTemplate: `Apply this file operation pattern:

${pattern.description}`,
      rules: ['Follow consistent file patterns', 'Validate paths'],
    },
    'command-sequence': {
      name: 'Command Sequence Assistant',
      description: 'Automated command sequences',
      category: 'command-sequence',
      tags: ['commands', 'automation'],
      promptTemplate: `Execute this command sequence:

${pattern.description}`,
      rules: ['Validate commands', 'Handle errors', 'Check results'],
    },
    other: {
      name: `Pattern Assistant`,
      description: pattern.description,
      category: 'other',
      tags: ['automation', 'custom'],
      promptTemplate: `Execute this pattern:

${pattern.description}

Apply this approach consistently when similar situations arise.`,
      rules: ['Follow the detected pattern consistently', 'Adapt to context as needed'],
    },
  };

  const template = proposalTemplates[pattern.patternType] || proposalTemplates.other;

  // Generate examples from the pattern's example messages
  const examples = [
    `This ${proposalType} was generated after observing ${pattern.occurrences} similar instances.`,
    `Confidence: ${(pattern.confidence * 100).toFixed(0)}%`,
    `Pattern: ${pattern.description}`,
  ];

  const rationale = `This ${proposalType} was automatically proposed after detecting a recurring pattern in your work. ${pattern.description}. Automating this pattern could save time and improve consistency.`;

  // Generate content based on type
  let content: string;
  if (proposalType === 'skill') {
    // Generate SKILL.md format
    content = generateSkillMd(
      {
        id: template.name.toLowerCase().replace(/\s+/g, '-'),
        name: template.name,
        description: template.description,
        version: '1.0.0',
        author: 'Pattern Detection System',
        category: template.category as any,
        tags: template.tags,
      },
      template.promptTemplate,
      template.rules,
    );
  } else {
    // Generate rule markdown
    content = `# ${template.name}

${template.description}

## Context

${pattern.description}

## Pattern Detected

${pattern.description} (observed ${pattern.occurrences} times with ${(pattern.confidence * 100).toFixed(0)}% confidence)

## Rules

${template.rules.map((r) => `- ${r}`).join('\n')}

## When to Apply

Apply this rule when you encounter similar scenarios to those detected in the pattern analysis.

---

*Auto-generated by Pattern Detection System*
*First seen: ${new Date(pattern.firstSeen).toISOString()}*
*Last seen: ${new Date(pattern.lastSeen).toISOString()}*
`;
  }

  return {
    name: template.name,
    description: template.description,
    category: template.category,
    content,
    tags: template.tags,
    rationale,
    examples,
  };
}

/**
 * Approve a proposal and install the skill/rule
 */
export async function approveProposal(
  proposalId: string,
): Promise<{ success: boolean; path?: string; error?: string }> {
  const db = getDb();

  const proposal = db.query('SELECT * FROM skill_proposals WHERE id = ?').get(proposalId) as any;

  if (!proposal) {
    return { success: false, error: 'Proposal not found' };
  }

  if (proposal.status !== 'pending') {
    return { success: false, error: 'Proposal already processed' };
  }

  try {
    const now = Date.now();

    if (proposal.proposal_type === 'skill') {
      // Install as a workspace skill
      const { mkdir, writeFile } = await import('fs/promises');
      const { join } = await import('path');

      const skillId = proposal.name.toLowerCase().replace(/\s+/g, '-');
      const skillDir = join(proposal.workspace_path, '.e', 'skills', skillId);
      await mkdir(skillDir, { recursive: true });

      const skillFile = join(skillDir, 'SKILL.md');
      await writeFile(skillFile, proposal.content, 'utf-8');

      // Also write to .claude/skills for backward compat
      const claudeDir = join(proposal.workspace_path, '.claude', 'skills', skillId);
      await mkdir(claudeDir, { recursive: true });
      await writeFile(join(claudeDir, 'SKILL.md'), proposal.content, 'utf-8');

      // Update proposal
      db.query(
        `UPDATE skill_proposals
         SET status = 'approved', installed_path = ?, updated_at = ?
         WHERE id = ?`,
      ).run(skillFile, now, proposalId);

      return { success: true, path: skillFile };
    } else {
      // Install as a rule
      const { mkdir, writeFile } = await import('fs/promises');
      const { join } = await import('path');

      const ruleFileName = `${proposal.name.toLowerCase().replace(/\s+/g, '-')}.md`;
      const rulesDir = join(proposal.workspace_path, '.e', 'rules');
      await mkdir(rulesDir, { recursive: true });

      const ruleFile = join(rulesDir, ruleFileName);
      await writeFile(ruleFile, proposal.content, 'utf-8');

      // Update proposal
      db.query(
        `UPDATE skill_proposals
         SET status = 'approved', installed_path = ?, updated_at = ?
         WHERE id = ?`,
      ).run(ruleFile, now, proposalId);

      return { success: true, path: ruleFile };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

/**
 * Reject a proposal
 */
export async function rejectProposal(proposalId: string): Promise<{ success: boolean }> {
  const db = getDb();
  const now = Date.now();

  db.query(
    `UPDATE skill_proposals
     SET status = 'rejected', updated_at = ?
     WHERE id = ? AND status = 'pending'`,
  ).run(now, proposalId);

  return { success: true };
}
