/**
 * Undercover Mode
 *
 * Auto-detects when working in public repositories and suppresses
 * internal/sensitive information from commits, PRs, and agent output.
 *
 * Detection:
 * - Checks git remote URL for known public hosting (github.com, gitlab.com, etc.)
 * - Checks repository visibility via GitHub API if available
 * - Can be manually toggled
 *
 * Suppression:
 * - Scrubs internal references from commit messages
 * - Sanitizes agent output before public-facing actions
 * - Warns when about to expose potentially internal information
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type UndercoverStatus = 'disabled' | 'active' | 'warning';

export type UndercoverTrigger = 'auto_detected' | 'manual' | 'git_remote';

export interface UndercoverConfig {
  /** Enable automatic detection of public repos */
  autoDetect: boolean;
  /** Patterns to detect internal references (scrubbed from output) */
  internalPatterns: string[];
  /** Replacement text for scrubbed content */
  replacementText: string;
  /** Warn before committing to detected public repos */
  warnOnCommit: boolean;
  /** Warn before creating PRs in detected public repos */
  warnOnPR: boolean;
  /** Known internal domains (stripped from URLs, references) */
  internalDomains: string[];
  /** Known internal project prefixes */
  internalPrefixes: string[];
}

export interface UndercoverState {
  /** Whether undercover mode is currently active */
  active: boolean;
  /** How it was triggered */
  trigger?: UndercoverTrigger;
  /** The detected public remote URL */
  detectedRemote?: string;
  /** Repository visibility (if detected) */
  repoVisibility?: 'public' | 'private' | 'unknown';
  /** Count of scrubbed references in current session */
  scrubbedCount: number;
  /** Warnings issued in current session */
  warnings: UndercoverWarning[];
}

export interface UndercoverWarning {
  id: string;
  timestamp: number;
  type: 'commit' | 'pr' | 'output' | 'file';
  message: string;
  /** The content that triggered the warning (redacted) */
  context?: string;
  /** Whether the user dismissed this warning */
  dismissed: boolean;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_UNDERCOVER_CONFIG: UndercoverConfig = {
  autoDetect: true,
  internalPatterns: [
    // Internal issue trackers
    '\\b[A-Z]{2,}-\\d{3,}\\b', // JIRA-style ticket refs (PROJ-123)
    // Internal URLs
    'https?://[\\w.-]+\\.internal\\b',
    'https?://[\\w.-]+\\.corp\\b',
    'https?://[\\w.-]+\\.local\\b',
    // IP ranges (private)
    '\\b10\\.\\d+\\.\\d+\\.\\d+\\b',
    '\\b172\\.(1[6-9]|2\\d|3[01])\\.\\d+\\.\\d+\\b',
    '\\b192\\.168\\.\\d+\\.\\d+\\b',
    // API keys/tokens (common patterns)
    '\\b(sk|pk|api|key|token|secret)[-_][a-zA-Z0-9]{20,}\\b',
  ],
  replacementText: '[redacted]',
  warnOnCommit: true,
  warnOnPR: true,
  internalDomains: [],
  internalPrefixes: [],
};

// ─── Public Repo Detection ───────────────────────────────────────────────────

/** Known public git hosting domains */
const PUBLIC_HOSTS = [
  'github.com',
  'gitlab.com',
  'bitbucket.org',
  'codeberg.org',
  'sr.ht',
  'gitea.com',
];

/**
 * Check if a git remote URL points to a likely public repository.
 * This is a heuristic — it can't know visibility without API access.
 */
export function isLikelyPublicRemote(remoteUrl: string): boolean {
  if (!remoteUrl) return false;
  const lower = remoteUrl.toLowerCase();
  return PUBLIC_HOSTS.some((host) => lower.includes(host));
}

/**
 * Parse a git remote URL to extract host and repo path.
 */
export function parseRemoteUrl(url: string): { host: string; repo: string } | null {
  // SSH format: git@github.com:owner/repo.git
  const sshMatch = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) return { host: sshMatch[1], repo: sshMatch[2] };

  // HTTPS format: https://github.com/owner/repo.git
  const httpsMatch = url.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) return { host: httpsMatch[1], repo: httpsMatch[2] };

  return null;
}

/**
 * Scrub internal references from text using configured patterns.
 */
export function scrubInternalReferences(
  text: string,
  config: UndercoverConfig = DEFAULT_UNDERCOVER_CONFIG,
): { scrubbed: string; matchCount: number } {
  let scrubbed = text;
  let matchCount = 0;

  for (const pattern of config.internalPatterns) {
    try {
      const regex = new RegExp(pattern, 'g');
      const matches = scrubbed.match(regex);
      if (matches) {
        matchCount += matches.length;
        scrubbed = scrubbed.replace(regex, config.replacementText);
      }
    } catch {
      // Invalid regex pattern — skip
    }
  }

  // Scrub internal domains
  for (const domain of config.internalDomains) {
    const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`https?://[\\w.-]*${escaped}[\\w./-]*`, 'g');
    const matches = scrubbed.match(regex);
    if (matches) {
      matchCount += matches.length;
      scrubbed = scrubbed.replace(regex, config.replacementText);
    }
  }

  return { scrubbed, matchCount };
}
