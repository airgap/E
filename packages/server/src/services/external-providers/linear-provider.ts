import type {
  ExternalProviderConfig,
  ExternalIssue,
  ExternalProject,
  StoryPriority,
} from '@e/shared';
import type { IExternalProvider } from './types';

/**
 * Linear GraphQL API provider.
 *
 * Auth: Bearer token via API key.
 * API: https://api.linear.app/graphql
 *
 * Linear priorities: 0=none, 1=urgent, 2=high, 3=medium, 4=low
 * Linear state types: backlog, unstarted, started, completed, cancelled
 */
export class LinearProvider implements IExternalProvider {
  readonly provider = 'linear' as const;
  private readonly apiUrl = 'https://api.linear.app/graphql';

  private headers(config: ExternalProviderConfig): Record<string, string> {
    return {
      Authorization: config.apiKey,
      'Content-Type': 'application/json',
    };
  }

  private async graphql(
    config: ExternalProviderConfig,
    query: string,
    variables?: any,
  ): Promise<any> {
    const res = await fetch(this.apiUrl, {
      method: 'POST',
      headers: this.headers(config),
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`Linear API failed: ${res.status} ${res.statusText}`);
    const json = (await res.json()) as any;
    if (json.errors?.length) throw new Error(`Linear GraphQL error: ${json.errors[0].message}`);
    return json.data;
  }

  async testConnection(config: ExternalProviderConfig): Promise<boolean> {
    try {
      const data = await this.graphql(config, `{ viewer { id name } }`);
      return !!data?.viewer?.id;
    } catch {
      return false;
    }
  }

  async listProjects(config: ExternalProviderConfig): Promise<ExternalProject[]> {
    const data = await this.graphql(config, `{ teams { nodes { id name key issueCount } } }`);
    return (data.teams?.nodes || []).map((t: any) => ({
      id: t.key || t.id,
      name: t.name,
      provider: 'linear' as const,
      issueCount: t.issueCount,
    }));
  }

  async listIssues(
    config: ExternalProviderConfig,
    projectKey: string,
    options?: { status?: string; maxResults?: number },
  ): Promise<ExternalIssue[]> {
    const limit = options?.maxResults || 50;
    const data = await this.graphql(
      config,
      `query($teamKey: String!, $limit: Int!) {
        issues(
          filter: { team: { key: { eq: $teamKey } }, state: { type: { nin: ["completed", "cancelled"] } } }
          first: $limit
          orderBy: priority
        ) {
          nodes {
            id identifier url title description priority priorityLabel
            state { name type }
            assignee { name email }
            labels { nodes { name } }
            team { key name }
            updatedAt
          }
        }
      }`,
      { teamKey: projectKey, limit },
    );

    return (data.issues?.nodes || []).map((issue: any) => this.mapLinearIssue(issue));
  }

  async getIssue(config: ExternalProviderConfig, externalId: string): Promise<ExternalIssue> {
    const data = await this.graphql(
      config,
      `query($id: String!) {
        issue(id: $id) {
          id identifier url title description priority priorityLabel
          state { name type }
          assignee { name email }
          labels { nodes { name } }
          team { key name }
          updatedAt
        }
      }`,
      { id: externalId },
    );
    if (!data?.issue) throw new Error(`Linear issue not found: ${externalId}`);
    return this.mapLinearIssue(data.issue);
  }

  async pushStatus(
    config: ExternalProviderConfig,
    externalId: string,
    status: 'completed' | 'failed' | 'in_progress',
    meta?: { commitSha?: string; prUrl?: string; comment?: string },
  ): Promise<void> {
    if (status === 'completed' || status === 'in_progress') {
      // Find the appropriate state for the issue's team
      const issueData = await this.graphql(
        config,
        `query($id: String!) {
          issue(id: $id) {
            id
            team { id states { nodes { id name type } } }
          }
        }`,
        { id: externalId },
      );

      const states = issueData?.issue?.team?.states?.nodes || [];
      let targetState: any;
      if (status === 'completed') {
        targetState = states.find((s: any) => s.type === 'completed');
      } else {
        // For QA/in_progress, prefer "In Review" or "Started" state
        targetState =
          states.find((s: any) => s.name?.toLowerCase().includes('review')) ||
          states.find((s: any) => s.type === 'started');
      }
      if (targetState) {
        await this.graphql(
          config,
          `mutation($id: String!, $stateId: String!) {
            issueUpdate(id: $id, input: { stateId: $stateId }) { success }
          }`,
          { id: externalId, stateId: targetState.id },
        );
      }
    }

    // Post a comment
    const commentParts: string[] = [];
    if (status === 'completed') {
      commentParts.push('✅ Implemented automatically by E.');
    } else if (status === 'in_progress') {
      commentParts.push('🔍 Implementation complete, moved to QA.');
    } else {
      commentParts.push('❌ Automatic implementation failed.');
    }
    if (meta?.commitSha) commentParts.push(`Commit: ${meta.commitSha.slice(0, 8)}`);
    if (meta?.prUrl) commentParts.push(`PR: ${meta.prUrl}`);
    if (meta?.comment) commentParts.push(meta.comment);

    await this.graphql(
      config,
      `mutation($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) { success }
      }`,
      { issueId: externalId, body: commentParts.join('\n') },
    ).catch(() => {});
  }

  normalizeStatus(raw: string): 'todo' | 'in_progress' | 'done' {
    const lower = raw.toLowerCase();
    if (lower === 'completed' || lower === 'done' || lower === 'cancelled') return 'done';
    if (lower === 'started' || lower === 'in progress') return 'in_progress';
    return 'todo';
  }

  normalizePriority(raw: string): StoryPriority {
    const lower = (raw || '').toLowerCase();
    if (lower === 'urgent' || lower === '1') return 'critical';
    if (lower === 'high' || lower === '2') return 'high';
    if (lower === 'low' || lower === '4') return 'low';
    return 'medium';
  }

  private mapLinearIssue(issue: any): ExternalIssue {
    const stateType = issue.state?.type || 'unstarted';
    let statusCategory: 'todo' | 'in_progress' | 'done';
    switch (stateType) {
      case 'completed':
      case 'cancelled':
        statusCategory = 'done';
        break;
      case 'started':
        statusCategory = 'in_progress';
        break;
      default:
        statusCategory = 'todo';
    }

    // Linear priorities: 0=none, 1=urgent, 2=high, 3=medium, 4=low
    const priorityMap: Record<number, StoryPriority> = {
      0: 'medium',
      1: 'critical',
      2: 'high',
      3: 'medium',
      4: 'low',
    };

    return {
      externalId: issue.id,
      externalUrl: issue.url || '',
      provider: 'linear',
      title: issue.title || '',
      description: issue.description || '',
      acceptanceCriteria: this.extractAcceptanceCriteria(issue.description || ''),
      status: issue.state?.name || 'Backlog',
      statusCategory,
      priority: issue.priorityLabel || 'Medium',
      priorityNormalized: priorityMap[issue.priority] || 'medium',
      assignee: issue.assignee?.name || issue.assignee?.email,
      labels: (issue.labels?.nodes || []).map((l: any) => l.name),
      projectKey: issue.team?.key || '',
      projectName: issue.team?.name || '',
      updatedAt: issue.updatedAt ? new Date(issue.updatedAt).getTime() : Date.now(),
    };
  }

  private extractAcceptanceCriteria(description: string): string[] {
    if (!description) return [];
    const acMatch = description.match(
      /(?:acceptance\s+criteria|ac|definition\s+of\s+done|dod)\s*[:\-]\s*([\s\S]*?)(?:\n\n|\n(?=[A-Z#])|$)/i,
    );
    if (!acMatch) return [];
    return acMatch[1]
      .split(/\n/)
      .map((l) => l.replace(/^[\s\-*•\[\]]+/, '').trim())
      .filter((l) => l.length > 0);
  }
}
