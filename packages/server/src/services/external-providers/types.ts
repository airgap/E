import type {
  ExternalProvider,
  ExternalProviderConfig,
  ExternalIssue,
  ExternalProject,
  StoryPriority,
} from '@e/shared';

/** Abstract interface that all external providers implement */
export interface IExternalProvider {
  readonly provider: ExternalProvider;

  /** Validate credentials and return true if connection works */
  testConnection(config: ExternalProviderConfig): Promise<boolean>;

  /** List projects/boards the user has access to */
  listProjects(config: ExternalProviderConfig): Promise<ExternalProject[]>;

  /** List issues in a project, optionally filtered */
  listIssues(
    config: ExternalProviderConfig,
    projectKey: string,
    options?: { status?: string; maxResults?: number },
  ): Promise<ExternalIssue[]>;

  /** Fetch a single issue by its external ID */
  getIssue(config: ExternalProviderConfig, externalId: string): Promise<ExternalIssue>;

  /** Push status and metadata back to the external provider */
  pushStatus(
    config: ExternalProviderConfig,
    externalId: string,
    status: 'completed' | 'failed' | 'in_progress',
    meta?: { commitSha?: string; prUrl?: string; comment?: string },
  ): Promise<void>;

  /** Map a raw provider status string to a normalized status category */
  normalizeStatus(rawStatus: string): 'todo' | 'in_progress' | 'done';

  /** Map a raw provider priority to StoryPriority */
  normalizePriority(rawPriority: string): StoryPriority;
}
