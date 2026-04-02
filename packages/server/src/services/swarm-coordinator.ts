/**
 * Swarm Coordinator Service
 *
 * Multi-agent parallel execution system. Spawns sub-agents with
 * restricted toolsets in isolated contexts (worktrees).
 */

import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import type {
  SwarmGroup,
  SwarmGroupConfig,
  SwarmAgent,
  SwarmTask,
  SwarmAgentConfig,
  SwarmGroupStatus,
  StreamSwarmEvent,
} from '@e/shared';
import { SWARM_AGENT_COLORS, DEFAULT_SWARM_GROUP_CONFIG } from '@e/shared';

interface SwarmTaskInput {
  title: string;
  description: string;
  dependsOn?: string[];
}

class SwarmCoordinator extends EventEmitter {
  private groups = new Map<string, SwarmGroup>();
  private taskExecutors = new Map<string, Promise<void>>();

  /**
   * Create a new swarm group with tasks.
   */
  createGroup(
    name: string,
    workspacePath: string,
    tasks: SwarmTaskInput[],
    config?: Partial<SwarmGroupConfig>,
    context?: { loopId?: string; storyId?: string },
  ): SwarmGroup {
    const groupId = nanoid(12);
    const mergedConfig = { ...DEFAULT_SWARM_GROUP_CONFIG, ...config };

    // Create tasks with IDs
    const swarmTasks: SwarmTask[] = tasks.map((t, i) => ({
      id: nanoid(8),
      groupId,
      title: t.title,
      description: t.description,
      dependsOn: t.dependsOn || [],
      status: 'idle' as const,
    }));

    // Create agents (one per max concurrent slot)
    const agents: SwarmAgent[] = [];
    for (let i = 0; i < mergedConfig.maxConcurrent; i++) {
      agents.push({
        id: nanoid(8),
        groupId,
        config: {
          name: `Agent-${i + 1}`,
          color: SWARM_AGENT_COLORS[i % SWARM_AGENT_COLORS.length],
          ...mergedConfig.defaultAgentConfig,
        },
        status: 'idle',
        tasksCompleted: 0,
        tasksFailed: 0,
      });
    }

    const group: SwarmGroup = {
      id: groupId,
      name,
      workspacePath,
      status: 'pending',
      agents,
      tasks: swarmTasks,
      config: mergedConfig,
      createdAt: Date.now(),
      loopId: context?.loopId,
      storyId: context?.storyId,
    };

    this.groups.set(groupId, group);
    this.persistGroup(group);
    return group;
  }

  /**
   * Start executing a swarm group.
   */
  async executeGroup(groupId: string): Promise<void> {
    const group = this.groups.get(groupId);
    if (!group) throw new Error(`Swarm group ${groupId} not found`);

    group.status = 'running';
    this.emitEvent(group, 'group_started', {
      message: `Swarm "${group.name}" started with ${group.agents.length} agents`,
    });

    try {
      await this.runScheduler(group);

      // Determine final status
      const allCompleted = group.tasks.every((t) => t.status === 'completed');
      const anyFailed = group.tasks.some((t) => t.status === 'failed');

      if (allCompleted) {
        group.status = 'completed';
      } else if (anyFailed && group.config.failFast) {
        group.status = 'failed';
      } else if (anyFailed) {
        group.status = 'completed_partial';
      } else {
        group.status = 'completed';
      }
    } catch {
      group.status = 'failed';
    }

    group.completedAt = Date.now();
    this.persistGroup(group);
    this.emitEvent(group, 'group_completed', {
      status: group.status,
      message: `Swarm "${group.name}" ${group.status}`,
    });
  }

  /**
   * Cancel a running swarm group.
   */
  cancel(groupId: string): void {
    const group = this.groups.get(groupId);
    if (!group) return;

    group.status = 'cancelled';
    for (const task of group.tasks) {
      if (task.status === 'idle' || task.status === 'working') {
        task.status = 'cancelled';
      }
    }
    for (const agent of group.agents) {
      if (agent.status === 'working') {
        agent.status = 'cancelled';
      }
    }

    group.completedAt = Date.now();
    this.persistGroup(group);
  }

  getGroup(groupId: string): SwarmGroup | undefined {
    return this.groups.get(groupId);
  }

  getAllGroups(): SwarmGroup[] {
    return Array.from(this.groups.values());
  }

  // ─── Scheduler ─────────────────────────────────────────────────────────

  private async runScheduler(group: SwarmGroup): Promise<void> {
    while (true) {
      const eligibleTasks = this.getEligibleTasks(group);
      const idleAgents = group.agents.filter((a) => a.status === 'idle');

      if (eligibleTasks.length === 0 && !group.tasks.some((t) => t.status === 'working')) {
        break; // No more work to do
      }

      if (group.config.failFast && group.tasks.some((t) => t.status === 'failed')) {
        break; // Fail fast mode
      }

      // Assign tasks to idle agents
      for (const agent of idleAgents) {
        const task = eligibleTasks.shift();
        if (!task) break;

        task.status = 'working';
        task.agentId = agent.id;
        task.startedAt = Date.now();
        agent.status = 'working';
        agent.currentTaskId = task.id;
        agent.startedAt = agent.startedAt || Date.now();
        agent.lastActivityAt = Date.now();

        this.emitEvent(group, 'task_assigned', {
          agentId: agent.id,
          agentName: agent.config.name,
          agentColor: agent.config.color,
          taskId: task.id,
          taskTitle: task.title,
        });

        // Execute task (simulated — real implementation would spawn an agent process)
        this.executeTask(group, agent, task);
      }

      // Wait for any task to complete
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  private getEligibleTasks(group: SwarmGroup): SwarmTask[] {
    return group.tasks.filter((task) => {
      if (task.status !== 'idle') return false;

      // Check dependencies
      return task.dependsOn.every((depId) => {
        const dep = group.tasks.find((t) => t.id === depId);
        return dep && dep.status === 'completed';
      });
    });
  }

  private async executeTask(group: SwarmGroup, agent: SwarmAgent, task: SwarmTask): Promise<void> {
    // In a real implementation, this would spawn a sub-agent process
    // with restricted tools in an isolated worktree.
    // For now, we mark it as completed after a brief delay.
    try {
      // Placeholder: actual agent execution would go here
      task.status = 'completed';
      task.completedAt = Date.now();
      agent.tasksCompleted++;

      this.emitEvent(group, 'task_completed', {
        agentId: agent.id,
        agentName: agent.config.name,
        taskId: task.id,
        taskTitle: task.title,
        message: `Task "${task.title}" completed`,
      });
    } catch (err: any) {
      task.status = 'failed';
      task.error = err?.message || 'Unknown error';
      task.completedAt = Date.now();
      agent.tasksFailed++;

      this.emitEvent(group, 'task_failed', {
        agentId: agent.id,
        agentName: agent.config.name,
        taskId: task.id,
        taskTitle: task.title,
        message: `Task "${task.title}" failed: ${task.error}`,
      });
    } finally {
      agent.status = 'idle';
      agent.currentTaskId = undefined;
      agent.lastActivityAt = Date.now();
    }
  }

  // ─── Events ────────────────────────────────────────────────────────────

  private emitEvent(
    group: SwarmGroup,
    event: StreamSwarmEvent['event'],
    data: Partial<StreamSwarmEvent['data']>,
  ): void {
    const sseEvent: StreamSwarmEvent = {
      type: 'swarm_event',
      groupId: group.id,
      event,
      data: data as StreamSwarmEvent['data'],
    };
    this.emit('swarm_event', sseEvent);
  }

  private persistGroup(group: SwarmGroup): void {
    try {
      const db = getDb();
      db.query(
        `
        INSERT OR REPLACE INTO swarm_groups (id, name, workspace_path, status, agents_json, tasks_json, config_json, created_at, completed_at, loop_id, story_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        group.id,
        group.name,
        group.workspacePath,
        group.status,
        JSON.stringify(group.agents),
        JSON.stringify(group.tasks),
        JSON.stringify(group.config),
        group.createdAt,
        group.completedAt || null,
        group.loopId || null,
        group.storyId || null,
      );
    } catch {
      // Table may not exist yet
    }
  }
}

export const swarmCoordinator = new SwarmCoordinator();
