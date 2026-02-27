import type {
  ExternalProviderConfig,
  ExternalIssue,
  ExternalProject,
  StoryPriority,
} from '@e/shared';
import type { IExternalProvider } from './types';

/**
 * Jira Cloud REST API v3 provider.
 *
 * Auth: Basic auth with email:apiToken (base64 encoded).
 * Config: baseUrl = Jira instance URL (e.g. https://myorg.atlassian.net)
 *         email   = user email
 *         apiKey  = API token from https://id.atlassian.net/manage-profile/security/api-tokens
 */
export class JiraProvider implements IExternalProvider {
  readonly provider = 'jira' as const;

  private headers(config: ExternalProviderConfig): Record<string, string> {
    const email = config.email || '';
    const token = config.apiKey || '';
    return {
      Authorization: `Basic ${btoa(`${email}:${token}`)}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private api(config: ExternalProviderConfig): string {
    return (config.baseUrl || '').replace(/\/$/, '');
  }

  // ── Connection ──

  async testConnection(config: ExternalProviderConfig): Promise<boolean> {
    try {
      const res = await fetch(`${this.api(config)}/rest/api/3/myself`, {
        headers: this.headers(config),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Projects ──

  async listProjects(config: ExternalProviderConfig): Promise<ExternalProject[]> {
    const res = await fetch(`${this.api(config)}/rest/api/3/project?recent=20`, {
      headers: this.headers(config),
    });
    if (!res.ok) throw new Error(`Jira listProjects failed: ${res.status} ${res.statusText}`);

    const data = (await res.json()) as any[];
    return data.map((p) => ({
      id: p.key,
      name: p.name,
      provider: 'jira' as const,
    }));
  }

  // ── Issues ──

  async listIssues(
    config: ExternalProviderConfig,
    projectKey: string,
    options?: { status?: string; maxResults?: number },
  ): Promise<ExternalIssue[]> {
    const maxResults = options?.maxResults || 50;
    let jql = `project = "${projectKey}" AND statusCategory != Done`;
    if (options?.status) {
      jql = `project = "${projectKey}" AND status = "${options.status}"`;
    }
    jql += ' ORDER BY priority DESC, updated DESC';

    const params = new URLSearchParams({
      jql,
      maxResults: String(maxResults),
      fields: 'summary,description,status,priority,assignee,labels,project,updated',
    });

    const res = await fetch(`${this.api(config)}/rest/api/3/search?${params}`, {
      headers: this.headers(config),
    });
    if (!res.ok) throw new Error(`Jira listIssues failed: ${res.status} ${res.statusText}`);

    const data = (await res.json()) as any;
    return (data.issues || []).map((issue: any) => this.mapJiraIssue(issue, config));
  }

  async getIssue(config: ExternalProviderConfig, externalId: string): Promise<ExternalIssue> {
    const params = new URLSearchParams({
      fields: 'summary,description,status,priority,assignee,labels,project,updated',
    });

    const res = await fetch(`${this.api(config)}/rest/api/3/issue/${externalId}?${params}`, {
      headers: this.headers(config),
    });
    if (!res.ok) throw new Error(`Jira getIssue failed: ${res.status} ${res.statusText}`);

    const issue = (await res.json()) as any;
    return this.mapJiraIssue(issue, config);
  }

  // ── Status Push ──

  async pushStatus(
    config: ExternalProviderConfig,
    externalId: string,
    status: 'completed' | 'failed' | 'in_progress',
    meta?: { commitSha?: string; prUrl?: string; comment?: string },
  ): Promise<void> {
    // Find and apply an appropriate transition
    const transRes = await fetch(`${this.api(config)}/rest/api/3/issue/${externalId}/transitions`, {
      headers: this.headers(config),
    });
    if (transRes.ok) {
      const transData = (await transRes.json()) as any;
      let transition: any;
      if (status === 'completed') {
        transition = transData.transitions?.find(
          (t: any) =>
            t.to?.statusCategory?.key === 'done' ||
            t.name?.toLowerCase().includes('done') ||
            t.name?.toLowerCase().includes('complete'),
        );
      } else if (status === 'in_progress') {
        // For QA / in-progress, try to find a "In Review" or "In Progress" transition
        transition = transData.transitions?.find(
          (t: any) =>
            t.to?.statusCategory?.key === 'indeterminate' ||
            t.name?.toLowerCase().includes('review') ||
            t.name?.toLowerCase().includes('qa') ||
            t.name?.toLowerCase().includes('progress'),
        );
      }
      if (transition) {
        await fetch(`${this.api(config)}/rest/api/3/issue/${externalId}/transitions`, {
          method: 'POST',
          headers: this.headers(config),
          body: JSON.stringify({ transition: { id: transition.id } }),
        });
      }
    }

    // Post a comment with results
    const commentParts: string[] = [];
    if (status === 'completed') {
      commentParts.push('✅ *Implemented automatically by E.*');
    } else if (status === 'in_progress') {
      commentParts.push('🔍 *Implementation complete, moved to QA.*');
    } else {
      commentParts.push('❌ *Automatic implementation failed.*');
    }
    if (meta?.commitSha) {
      commentParts.push(`Commit: \`${meta.commitSha.slice(0, 8)}\``);
    }
    if (meta?.prUrl) {
      commentParts.push(`PR: ${meta.prUrl}`);
    }
    if (meta?.comment) {
      commentParts.push(meta.comment);
    }

    const commentBody = {
      body: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: commentParts.join('\n') }],
          },
        ],
      },
    };

    await fetch(`${this.api(config)}/rest/api/3/issue/${externalId}/comment`, {
      method: 'POST',
      headers: this.headers(config),
      body: JSON.stringify(commentBody),
    }).catch(() => {
      // Comment failure is non-critical
    });
  }

  // ── Normalization ──

  normalizeStatus(raw: string): 'todo' | 'in_progress' | 'done' {
    const lower = raw.toLowerCase();
    if (
      lower.includes('done') ||
      lower.includes('complete') ||
      lower.includes('closed') ||
      lower.includes('resolved')
    ) {
      return 'done';
    }
    if (lower.includes('progress') || lower.includes('review') || lower.includes('active')) {
      return 'in_progress';
    }
    return 'todo';
  }

  normalizePriority(raw: string): StoryPriority {
    const lower = (raw || '').toLowerCase();
    if (lower === 'highest' || lower === 'blocker' || lower === 'critical') return 'critical';
    if (lower === 'high') return 'high';
    if (lower === 'low' || lower === 'lowest' || lower === 'trivial') return 'low';
    return 'medium';
  }

  // ── Mapping ──

  private mapJiraIssue(issue: any, config: ExternalProviderConfig): ExternalIssue {
    const fields = issue.fields || {};
    const statusName = fields.status?.name || 'To Do';
    const statusCategoryKey = fields.status?.statusCategory?.key || 'new';
    const priorityName = fields.priority?.name || 'Medium';

    // Convert Jira's statusCategory key to our categories
    let statusCategory: 'todo' | 'in_progress' | 'done';
    switch (statusCategoryKey) {
      case 'done':
        statusCategory = 'done';
        break;
      case 'indeterminate':
        statusCategory = 'in_progress';
        break;
      default:
        statusCategory = 'todo';
    }

    // Extract description text from ADF (Atlassian Document Format)
    const description = this.adfToText(fields.description);

    // Try to extract acceptance criteria from description
    const acceptanceCriteria = this.extractAcceptanceCriteria(description);

    return {
      externalId: issue.key,
      externalUrl: `${this.api(config)}/browse/${issue.key}`,
      provider: 'jira',
      title: fields.summary || '',
      description,
      acceptanceCriteria,
      status: statusName,
      statusCategory,
      priority: priorityName,
      priorityNormalized: this.normalizePriority(priorityName),
      assignee: fields.assignee?.displayName || fields.assignee?.emailAddress,
      labels: fields.labels || [],
      projectKey: fields.project?.key || '',
      projectName: fields.project?.name || '',
      updatedAt: fields.updated ? new Date(fields.updated).getTime() : Date.now(),
    };
  }

  /**
   * Convert Jira ADF (Atlassian Document Format) to plain text.
   * Handles the common node types; falls back gracefully for unknown types.
   */
  private adfToText(adf: any): string {
    if (!adf) return '';
    if (typeof adf === 'string') return adf;

    const extractText = (node: any): string => {
      if (!node) return '';
      if (node.type === 'text') return node.text || '';

      const children = node.content || [];
      const childText = children.map(extractText).join('');

      switch (node.type) {
        case 'paragraph':
          return childText + '\n';
        case 'heading':
          return childText + '\n';
        case 'bulletList':
        case 'orderedList':
          return childText;
        case 'listItem':
          return '- ' + childText;
        case 'codeBlock':
          return '```\n' + childText + '```\n';
        case 'blockquote':
          return '> ' + childText;
        case 'hardBreak':
          return '\n';
        default:
          return childText;
      }
    };

    return extractText(adf).trim();
  }

  /**
   * Try to extract acceptance criteria from issue description.
   * Looks for common patterns: "Acceptance Criteria:", bullet lists after AC header, etc.
   */
  private extractAcceptanceCriteria(description: string): string[] {
    if (!description) return [];

    // Look for "Acceptance Criteria" section
    const acMatch = description.match(
      /(?:acceptance\s+criteria|ac|definition\s+of\s+done|dod)\s*[:\-]\s*([\s\S]*?)(?:\n\n|\n(?=[A-Z])|$)/i,
    );
    if (!acMatch) return [];

    const acSection = acMatch[1].trim();
    const lines = acSection
      .split(/\n/)
      .map((l) => l.replace(/^[\s\-*•]+/, '').trim())
      .filter((l) => l.length > 0);

    return lines;
  }
}
