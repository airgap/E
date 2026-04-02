/**
 * Model Router — Complexity-Based Auto-Routing
 *
 * Analyzes task complexity and routes to the cheapest sufficient model:
 *   Simple → Haiku (fastest, cheapest)
 *   Medium → Sonnet (balanced)
 *   Complex → Opus (most capable)
 */

export type TaskComplexity = 'simple' | 'medium' | 'complex';

export type ModelTier = 'haiku' | 'sonnet' | 'opus';

export interface ComplexitySignal {
  /** Estimated complexity */
  complexity: TaskComplexity;
  /** Confidence (0.0 - 1.0) */
  confidence: number;
  /** Which signals contributed */
  signals: string[];
  /** Recommended model */
  recommendedModel: string;
  /** Recommended tier */
  tier: ModelTier;
}

export interface ModelRouterConfig {
  /** Enable auto-routing */
  enabled: boolean;
  /** Model ID for each tier */
  models: Record<ModelTier, string>;
  /** Override: always use this model (disables routing) */
  forceModel?: string;
  /** Minimum confidence to auto-route (below this, use default) */
  minConfidence: number;
  /** Default tier when confidence is low */
  defaultTier: ModelTier;
  /** Token threshold: above this → bump complexity */
  longInputTokens: number;
  /** Multi-file threshold: above this → bump complexity */
  multiFileThreshold: number;
}

export const DEFAULT_MODEL_ROUTER_CONFIG: ModelRouterConfig = {
  enabled: true,
  models: {
    haiku: 'claude-haiku-4-5-20251001',
    sonnet: 'claude-sonnet-4-6',
    opus: 'claude-opus-4-6',
  },
  minConfidence: 0.6,
  defaultTier: 'sonnet',
  longInputTokens: 4000,
  multiFileThreshold: 5,
};

// ─── Complexity Indicators ────────────────────────────────────────────────

const SIMPLE_PATTERNS = [
  /^(what|how|why|when|where|who|explain|describe|list|show|tell)\b/i,
  /^(fix|correct|typo|rename|update)\s+(the|this|a)\b/i,
  /\b(one line|single|quick|small|minor|trivial)\b/i,
  /\b(format|lint|prettify|indent)\b/i,
  /\?(\.|\s)*$/, // Questions
];

const COMPLEX_PATTERNS = [
  /\b(refactor|redesign|architect|overhaul|rewrite|migrate)\b/i,
  /\b(implement|build|create)\s+(a |an |the )?(full|complete|entire|new)\b/i,
  /\b(multiple files|across|throughout|all of|every)\b/i,
  /\b(database|schema|migration|deploy|infrastructure)\b/i,
  /\b(security|auth|oauth|encryption|permission)\b/i,
  /\b(test suite|integration test|e2e|end.to.end)\b/i,
  /\b(performance|optimize|scale|concurrency)\b/i,
  /\b(plan|design|strategy|roadmap)\b/i,
];

/**
 * Analyze input text to determine task complexity.
 */
export function analyzeComplexity(
  input: string,
  config: ModelRouterConfig = DEFAULT_MODEL_ROUTER_CONFIG,
): ComplexitySignal {
  const signals: string[] = [];
  let score = 0; // -1 to +1 scale: negative = simple, positive = complex

  // Word count
  const words = input.split(/\s+/).length;
  if (words < 20) {
    score -= 0.2;
    signals.push('short_input');
  } else if (words > 200) {
    score += 0.3;
    signals.push('long_input');
  } else if (words > 500) {
    score += 0.5;
    signals.push('very_long_input');
  }

  // Pattern matching
  for (const pat of SIMPLE_PATTERNS) {
    if (pat.test(input)) {
      score -= 0.15;
      signals.push('simple_pattern');
      break;
    }
  }
  for (const pat of COMPLEX_PATTERNS) {
    if (pat.test(input)) {
      score += 0.2;
      signals.push('complex_pattern');
    }
  }

  // Code blocks
  const codeBlocks = (input.match(/```/g) || []).length / 2;
  if (codeBlocks > 0) {
    score += 0.1 * codeBlocks;
    signals.push('code_blocks');
  }

  // File references
  const fileRefs = (input.match(/\b[\w/.-]+\.\w{1,5}\b/g) || []).length;
  if (fileRefs > config.multiFileThreshold) {
    score += 0.3;
    signals.push('multi_file');
  } else if (fileRefs > 1) {
    score += 0.1;
    signals.push('few_files');
  }

  // Line count indicator (context dumps)
  const lines = input.split('\n').length;
  if (lines > 50) {
    score += 0.2;
    signals.push('many_lines');
  }

  // Determine complexity
  let complexity: TaskComplexity;
  let confidence: number;

  if (score <= -0.2) {
    complexity = 'simple';
    confidence = Math.min(1, 0.5 + Math.abs(score));
  } else if (score >= 0.4) {
    complexity = 'complex';
    confidence = Math.min(1, 0.3 + score);
  } else {
    complexity = 'medium';
    confidence = 0.5 + Math.abs(score - 0.1) * 0.5;
  }

  // Map to tier
  const tierMap: Record<TaskComplexity, ModelTier> = {
    simple: 'haiku',
    medium: 'sonnet',
    complex: 'opus',
  };
  const tier = confidence >= config.minConfidence ? tierMap[complexity] : config.defaultTier;

  return {
    complexity,
    confidence: Math.round(confidence * 100) / 100,
    signals: [...new Set(signals)],
    recommendedModel: config.forceModel || config.models[tier],
    tier,
  };
}
