/**
 * Frustration Detection Service
 *
 * Wraps the shared detection logic with server-side tracking.
 * Maintains a rolling window of frustration scores to detect
 * escalating frustration over a conversation.
 */

import { detectFrustration, type FrustrationSignal } from '@e/shared';

interface FrustrationHistory {
  conversationId: string;
  scores: { score: number; timestamp: number }[];
}

const MAX_HISTORY = 20;
const histories = new Map<string, FrustrationHistory>();

/**
 * Analyze a user message for frustration and track it per-conversation.
 * Returns the current signal plus the rolling trend.
 */
export function analyzeUserFrustration(
  conversationId: string,
  message: string,
): FrustrationSignal & { trend: 'escalating' | 'stable' | 'improving' } {
  const signal = detectFrustration(message);

  // Track history
  let history = histories.get(conversationId);
  if (!history) {
    history = { conversationId, scores: [] };
    histories.set(conversationId, history);
  }
  history.scores.push({ score: signal.score, timestamp: Date.now() });
  if (history.scores.length > MAX_HISTORY) {
    history.scores.shift();
  }

  // Calculate trend from recent scores
  const trend = calculateTrend(history.scores.map((s) => s.score));

  return { ...signal, trend };
}

function calculateTrend(scores: number[]): 'escalating' | 'stable' | 'improving' {
  if (scores.length < 3) return 'stable';

  const recent = scores.slice(-3);
  const earlier = scores.slice(-6, -3);
  if (earlier.length === 0) return 'stable';

  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const earlierAvg = earlier.reduce((a, b) => a + b, 0) / earlier.length;
  const diff = recentAvg - earlierAvg;

  if (diff > 0.15) return 'escalating';
  if (diff < -0.15) return 'improving';
  return 'stable';
}

/**
 * Clear frustration history for a conversation.
 */
export function clearFrustrationHistory(conversationId: string): void {
  histories.delete(conversationId);
}

/**
 * Build a system prompt injection for frustration-aware responses.
 * Returns undefined if no adjustment needed.
 */
export function frustrationPromptAdjustment(
  signal: FrustrationSignal & { trend: string },
): string | undefined {
  if (signal.level === 'none') return undefined;

  const parts: string[] = [];

  if (signal.level === 'high' || signal.trend === 'escalating') {
    parts.push(
      '<frustration_context>',
      'The user appears frustrated. Respond with:',
      '- Direct acknowledgment of the difficulty',
      '- Immediate, actionable solution steps',
      '- No verbose explanations or caveats',
      '- Empathetic but efficient tone',
      '</frustration_context>',
    );
  } else if (signal.level === 'moderate') {
    parts.push(
      '<frustration_context>',
      'The user may be frustrated. Be concise and solution-focused.',
      '</frustration_context>',
    );
  }

  return parts.length > 0 ? parts.join('\n') : undefined;
}
