import type {
  ExternalProviderConfig,
  ExternalIssue,
  ExternalProject,
  StoryPriority,
} from '@e/shared';
import type { IExternalProvider } from './types';

/**
 * Asana REST API provider.
 *
 * Auth: Bearer Personal Access Token.
 * API: https://app.asana.com/api/1.0/
 *
 * Asana uses completed/not-completed booleans + sections for workflow state.
 * Custom fields are commonly used for priority but aren't standardized.
 */
export class AsanaProvider implements IExternalProvider {
  readonly provider = 'asana' as const;
  private readonly apiUrl = 'https://app.asana.com/api/1.0';

  private headers(config: ExternalProviderConfig): Record<string, string> {
    return {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  async testConnection(config: ExternalProviderConfig): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiUrl}/users/me`, {
        headers: this.headers(config),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listProjects(config: ExternalProviderConfig): Promise<ExternalProject[]> {
    const workspaceGid = config.workspaceGid;
    let url = `${this.apiUrl}/projects?opt_fields=name,gid`;
    if (workspaceGid) {
      url += `&workspace=${workspaceGid}`;
    }

    const res = await fetch(url, { headers: this.headers(config) });
    if (!res.ok) throw new Error(`Asana listProjects failed: ${res.status}`);

    const data = (await res.json()) as any;
    return (data.data || []).map((p: any) => ({
      id: p.gid,
      name: p.name,
      provider: 'asana' as const,
    }));
  }

  async listIssues(
    config: ExternalProviderConfig,
    projectKey: string,
    options?: { status?: string; maxResults?: number },
  ): Promise<ExternalIssue[]> {
    const limit = Math.min(options?.maxResults || 50, 100);
    const fields =
      'name,notes,completed,assignee,assignee.name,tags,tags.name,modified_at,memberships,memberships.section,memberships.section.name';

    const res = await fetch(
      `${this.apiUrl}/projects/${projectKey}/tasks?opt_fields=${fields}&limit=${limit}&completed_since=now`,
      { headers: this.headers(config) },
    );
    if (!res.ok) throw new Error(`Asana listIssues failed: ${res.status}`);

    const data = (await res.json()) as any;

    // Fetch the project name
    let projectName = '';
    try {
      const projRes = await fetch(`${this.apiUrl}/projects/${projectKey}?opt_fields=name`, {
        headers: this.headers(config),
      });
      if (projRes.ok) {
        const projData = (await projRes.json()) as any;
        projectName = projData.data?.name || '';
      }
    } catch {}

    return (data.data || []).map((task: any) => this.mapAsanaTask(task, projectKey, projectName));
  }

  async getIssue(config: ExternalProviderConfig, externalId: string): Promise<ExternalIssue> {
    const fields =
      'name,notes,completed,assignee,assignee.name,tags,tags.name,modified_at,memberships,memberships.section,memberships.section.name,memberships.project,memberships.project.name';

    const res = await fetch(`${this.apiUrl}/tasks/${externalId}?opt_fields=${fields}`, {
      headers: this.headers(config),
    });
    if (!res.ok) throw new Error(`Asana getIssue failed: ${res.status}`);

    const data = (await res.json()) as any;
    const task = data.data;

    const membership = task.memberships?.[0] || {};
    const projectKey = membership.project?.gid || '';
    const projectName = membership.project?.name || '';

    return this.mapAsanaTask(task, projectKey, projectName);
  }

  async pushStatus(
    config: ExternalProviderConfig,
    externalId: string,
    status: 'completed' | 'failed' | 'in_progress',
    meta?: { commitSha?: string; prUrl?: string; comment?: string },
  ): Promise<void> {
    if (status === 'completed') {
      // Mark task as complete
      await fetch(`${this.apiUrl}/tasks/${externalId}`, {
        method: 'PUT',
        headers: this.headers(config),
        body: JSON.stringify({ data: { completed: true } }),
      });
    }
    // For 'in_progress' (QA), Asana doesn't need a status change —
    // just leave the task incomplete and add a comment.

    // Add a story (comment) to the task
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

    await fetch(`${this.apiUrl}/tasks/${externalId}/stories`, {
      method: 'POST',
      headers: this.headers(config),
      body: JSON.stringify({ data: { text: commentParts.join('\n') } }),
    }).catch(() => {});
  }

  normalizeStatus(raw: string): 'todo' | 'in_progress' | 'done' {
    const lower = raw.toLowerCase();
    if (lower === 'completed' || lower === 'done') return 'done';
    if (lower.includes('progress') || lower.includes('doing') || lower.includes('review'))
      return 'in_progress';
    return 'todo';
  }

  normalizePriority(_raw: string): StoryPriority {
    // Asana doesn't have a built-in priority field; default to medium
    return 'medium';
  }

  private mapAsanaTask(task: any, projectKey: string, projectName: string): ExternalIssue {
    const sectionName = task.memberships?.[0]?.section?.name || '';
    const isCompleted = !!task.completed;

    let statusCategory: 'todo' | 'in_progress' | 'done';
    if (isCompleted) {
      statusCategory = 'done';
    } else {
      statusCategory = this.normalizeStatus(sectionName);
    }

    const statusDisplay = isCompleted ? 'Completed' : sectionName || 'To Do';

    return {
      externalId: task.gid,
      externalUrl: `https://app.asana.com/0/0/${task.gid}`,
      provider: 'asana',
      title: task.name || '',
      description: task.notes || '',
      acceptanceCriteria: this.extractAcceptanceCriteria(task.notes || ''),
      status: statusDisplay,
      statusCategory,
      priority: 'Medium', // Asana has no built-in priority
      priorityNormalized: 'medium',
      assignee: task.assignee?.name,
      labels: (task.tags || []).map((t: any) => t.name),
      projectKey,
      projectName,
      updatedAt: task.modified_at ? new Date(task.modified_at).getTime() : Date.now(),
    };
  }

  private extractAcceptanceCriteria(description: string): string[] {
    if (!description) return [];
    const acMatch = description.match(
      /(?:acceptance\s+criteria|ac|definition\s+of\s+done|dod)\s*[:\-]\s*([\s\S]*?)(?:\n\n|\n(?=[A-Z])|$)/i,
    );
    if (!acMatch) return [];
    return acMatch[1]
      .split(/\n/)
      .map((l) => l.replace(/^[\s\-*•]+/, '').trim())
      .filter((l) => l.length > 0);
  }
}
