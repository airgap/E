/**
 * Detects whether a user message contains multiple distinct tasks
 * and extracts them for potential story creation.
 *
 * Two-pass detection:
 *   Pass 1 (high confidence): Structural markers — numbered/bullet lists
 *   Pass 2 (medium confidence): Imperative verb analysis on conjunction-split fragments
 */

export interface DetectedTask {
  text: string;
  index: number;
  selected: boolean;
}

export interface DetectionResult {
  isMultiPart: boolean;
  tasks: DetectedTask[];
  confidence: 'high' | 'medium';
}

const NO_MATCH: DetectionResult = { isMultiPart: false, tasks: [], confidence: 'medium' };

// ── Imperative verbs common in development requests ──

const IMPERATIVE_VERBS = new Set([
  'fix',
  'add',
  'create',
  'build',
  'update',
  'refactor',
  'remove',
  'delete',
  'implement',
  'write',
  'change',
  'move',
  'rename',
  'configure',
  'setup',
  'install',
  'deploy',
  'test',
  'review',
  'merge',
  'redesign',
  'optimize',
  'migrate',
  'integrate',
  'debug',
  'resolve',
  'enable',
  'disable',
  'convert',
  'extract',
  'rewrite',
  'improve',
  'upgrade',
  'downgrade',
  'clean',
  'document',
  'check',
  'validate',
  'make',
  'run',
  'ensure',
  'modify',
  'replace',
  'adjust',
  'set',
  'handle',
  'introduce',
  'wire',
  'hook',
  'connect',
  'scaffold',
  'generate',
  'publish',
  'bump',
  'split',
  'combine',
  'reorganize',
  'restructure',
  'simplify',
  'inline',
  'wrap',
  'unwrap',
  'expose',
  'hide',
  'show',
  'support',
  'drop',
  'deprecate',
]);

// ── Helpers ──

/** Strip fenced code blocks so their contents don't trigger false positives. */
function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '');
}

/** Strip leading filler words ("also", "then", "next", "please", "and") before verb check. */
function stripLeadingFiller(fragment: string): string {
  return fragment.replace(/^(also|then|next|please|and|additionally)\s+/i, '');
}

/** Check whether the first word of a fragment is an imperative verb. */
function startsWithImperative(fragment: string): boolean {
  const cleaned = stripLeadingFiller(fragment);
  const first = cleaned
    .split(/\s+/)[0]
    ?.toLowerCase()
    .replace(/[^a-z]/g, '');
  if (!first) return false;
  // Handle two-word verbs like "set up"
  if (first === 'set') {
    const second = cleaned.split(/\s+/)[1]?.toLowerCase();
    if (second === 'up') return true;
  }
  return IMPERATIVE_VERBS.has(first);
}

/** Build a DetectedTask[] from raw string fragments. */
function toTasks(fragments: string[]): DetectedTask[] {
  return fragments.map((text, index) => ({ text: text.trim(), index, selected: true }));
}

// ── Guards ──

function shouldSkip(text: string): boolean {
  // Too short to be multi-part
  if (text.length < 30) return true;
  // Slash commands are handled elsewhere
  if (text.startsWith('/')) return true;
  // Questions are rarely multi-task requests
  if (text.trim().endsWith('?')) return true;
  // Very long messages are usually detailed single-task instructions
  if (text.length > 2000) return true;
  return false;
}

// ── Pass 1: Structural markers (high confidence) ──

function detectNumberedList(text: string): DetectedTask[] | null {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const numbered = lines.filter((l) => /^\d+[\.\)]\s+/.test(l));
  if (numbered.length >= 2) {
    return toTasks(numbered.map((l) => l.replace(/^\d+[\.\)]\s+/, '')));
  }
  return null;
}

function detectBulletList(text: string): DetectedTask[] | null {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const bullets = lines.filter((l) => /^[-*]\s+/.test(l));
  if (bullets.length >= 2) {
    return toTasks(bullets.map((l) => l.replace(/^[-*]\s+/, '')));
  }
  return null;
}

// ── Pass 2: Conjunction-split imperative detection (medium confidence) ──

/**
 * Split on clause boundaries that signal distinct tasks.
 * We split on ", and ", ", then ", ", also ", "; ", ". " and newlines
 * but NOT bare " and " (which often connects nouns in a single task).
 */
function splitOnConjunctions(text: string): string[] {
  return text
    .split(/(?:,\s+and\s+|,\s+then\s+|,\s+also\s+|,\s+additionally\s+|;\s+|\.\s+|\n+)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function detectImperativeFragments(text: string): DetectedTask[] | null {
  const fragments = splitOnConjunctions(text);
  const imperative = fragments.filter(startsWithImperative);
  if (imperative.length >= 2) {
    return toTasks(imperative);
  }
  return null;
}

// ── Main entry point ──

export function detectMultiPartRequest(text: string): DetectionResult {
  if (shouldSkip(text)) return NO_MATCH;

  const cleaned = stripCodeBlocks(text);

  // Pass 1: structural markers
  const numbered = detectNumberedList(cleaned);
  if (numbered) {
    return { isMultiPart: true, tasks: numbered, confidence: 'high' };
  }

  const bullets = detectBulletList(cleaned);
  if (bullets) {
    return { isMultiPart: true, tasks: bullets, confidence: 'high' };
  }

  // Pass 2: imperative verb analysis
  const imperatives = detectImperativeFragments(cleaned);
  if (imperatives) {
    return { isMultiPart: true, tasks: imperatives, confidence: 'medium' };
  }

  return NO_MATCH;
}
