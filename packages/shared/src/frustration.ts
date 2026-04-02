/**
 * Frustration Detection
 *
 * Regex-based sentiment analysis on user input to detect frustration.
 * When detected, the system can adjust golem mood and response tone.
 *
 * Inspired by Claude Code's userPromptKeywords.ts.
 */

export type FrustrationLevel = 'none' | 'mild' | 'moderate' | 'high';

export interface FrustrationSignal {
  level: FrustrationLevel;
  score: number; // 0.0 - 1.0
  triggers: string[]; // matched patterns
  suggestion?: string; // suggested system behavior
}

// ─── Pattern Definitions ─────────────────────────────────────────────────────

interface FrustrationPattern {
  pattern: RegExp;
  weight: number;
  label: string;
}

const FRUSTRATION_PATTERNS: FrustrationPattern[] = [
  // Direct frustration expressions
  { pattern: /\b(ugh+|argh+|grr+|gah+|ffs)\b/i, weight: 0.3, label: 'exclamation' },
  {
    pattern: /\b(frustrated|frustrating|annoying|annoyed)\b/i,
    weight: 0.4,
    label: 'frustration-word',
  },
  { pattern: /\b(broken|busted|borked|messed up)\b/i, weight: 0.3, label: 'broken' },
  { pattern: /\bwhat the (hell|heck|fuck)\b/i, weight: 0.5, label: 'wtf' },
  { pattern: /\b(goddamn|damn it|dammit|shit|fuck)\b/i, weight: 0.4, label: 'profanity' },

  // Repeated failures
  { pattern: /\b(again|still|yet again|once more)\b/i, weight: 0.2, label: 'repetition' },
  { pattern: /\b(keeps? (failing|breaking|crashing))\b/i, weight: 0.4, label: 'recurring-failure' },
  {
    pattern: /\b(nothing works|doesn'?t work|won'?t work|not working)\b/i,
    weight: 0.4,
    label: 'not-working',
  },
  { pattern: /\b(tried everything|give up|giving up)\b/i, weight: 0.5, label: 'giving-up' },

  // Impatience
  {
    pattern: /\b(just|simply|already)\b.*\b(do it|fix it|work)\b/i,
    weight: 0.3,
    label: 'impatience',
  },
  { pattern: /\b(how (many|much) (more )?times)\b/i, weight: 0.4, label: 'repetition-complaint' },
  { pattern: /\b(why (is|does|can'?t|won'?t))\b/i, weight: 0.15, label: 'why-question' },

  // ALL CAPS (more than 3 consecutive uppercase words)
  { pattern: /\b[A-Z]{2,}\s+[A-Z]{2,}\s+[A-Z]{2,}\b/, weight: 0.3, label: 'shouting' },

  // Excessive punctuation
  { pattern: /[!?]{3,}/, weight: 0.25, label: 'excessive-punctuation' },
  { pattern: /\.{4,}/, weight: 0.15, label: 'trailing-dots' },
];

// ─── Scoring ─────────────────────────────────────────────────────────────────

function scoreToLevel(score: number): FrustrationLevel {
  if (score >= 0.6) return 'high';
  if (score >= 0.35) return 'moderate';
  if (score >= 0.15) return 'mild';
  return 'none';
}

function suggestBehavior(level: FrustrationLevel): string | undefined {
  switch (level) {
    case 'high':
      return 'Acknowledge difficulty. Be direct and solution-focused. Avoid verbose explanations.';
    case 'moderate':
      return 'Show empathy briefly. Focus on actionable next steps.';
    case 'mild':
      return 'Continue normally but be concise.';
    default:
      return undefined;
  }
}

/**
 * Analyze user input for frustration signals.
 */
export function detectFrustration(input: string): FrustrationSignal {
  const triggers: string[] = [];
  let totalScore = 0;

  for (const { pattern, weight, label } of FRUSTRATION_PATTERNS) {
    if (pattern.test(input)) {
      triggers.push(label);
      totalScore += weight;
    }
  }

  // Cap at 1.0
  const score = Math.min(1.0, totalScore);
  const level = scoreToLevel(score);

  return {
    level,
    score,
    triggers,
    suggestion: suggestBehavior(level),
  };
}
