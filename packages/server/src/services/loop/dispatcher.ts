import type {
  GolemExecutor,
  ExecutionContext,
  ExecutionResult,
  DispatchStrategy,
  ExecutorInfo,
} from '@e/shared';
import { ExecutorRegistry, executorRegistry, LocalWorktreeExecutor } from './executor';

/**
 * GolemDispatcher — selects the appropriate executor for a story execution
 * based on the configured dispatch strategy.
 *
 * Currently supports local-only execution. The strategy pattern is in place
 * so that remote executors (SSH, cloud, etc.) can be plugged in later without
 * modifying the dispatcher or runner.
 */
export class GolemDispatcher {
  private strategy: DispatchStrategy;
  private registry: ExecutorRegistry;

  /** Round-robin index for the round-robin strategy. */
  private roundRobinIndex = 0;

  constructor(strategy: DispatchStrategy = 'local-only', registry?: ExecutorRegistry) {
    this.strategy = strategy;
    this.registry = registry ?? executorRegistry;

    // Auto-register the local executor if the registry is empty
    if (this.registry.size === 0) {
      this.registry.register(new LocalWorktreeExecutor());
    }
  }

  /**
   * Select an executor and run a story execution.
   * The dispatcher finds the best eligible executor based on the current
   * strategy and delegates execution to it.
   */
  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const executor = this.selectExecutor(context);

    if (!executor) {
      return {
        status: 'failure',
        branchName: null,
        commitSha: null,
        logs: [`No eligible executor found for strategy "${this.strategy}"`],
        duration: 0,
        agentOutput: '',
        agentError: `No eligible executor found. Strategy: ${this.strategy}, registered executors: ${this.registry.size}`,
        qualityResults: [],
        conversationId: null,
        agentId: null,
      };
    }

    console.log(
      `[dispatcher] Dispatching execution ${context.executionId} to ${executor.type} (strategy: ${this.strategy})`,
    );

    return executor.execute(context);
  }

  /**
   * Cancel a running execution across all executors.
   * Broadcasts cancel to all executors since we may not know which one is running it.
   */
  async cancel(executionId: string): Promise<void> {
    const executors = this.registry.getAll();
    await Promise.all(executors.map((e) => e.cancel(executionId)));
  }

  /**
   * Get the current dispatch strategy.
   */
  getStrategy(): DispatchStrategy {
    return this.strategy;
  }

  /**
   * Update the dispatch strategy.
   */
  setStrategy(strategy: DispatchStrategy): void {
    this.strategy = strategy;
    console.log(`[dispatcher] Strategy changed to: ${strategy}`);
  }

  /**
   * List all registered executors and their capabilities.
   */
  listExecutors(): ExecutorInfo[] {
    return this.registry.listInfo();
  }

  /**
   * Get the underlying registry for direct executor management.
   */
  getRegistry(): ExecutorRegistry {
    return this.registry;
  }

  // --- Private: executor selection strategies ---

  private selectExecutor(context: ExecutionContext): GolemExecutor | null {
    const eligible = this.registry.getEligible(context);
    if (eligible.length === 0) return null;

    switch (this.strategy) {
      case 'local-only':
        return this.selectLocalOnly(eligible);

      case 'round-robin':
        return this.selectRoundRobin(eligible);

      case 'cost-optimized':
        // Future: sort by cost metric. For now, prefer local (cheapest).
        return this.selectLocalOnly(eligible) ?? eligible[0];

      case 'latency-optimized':
        // Future: sort by latency metric. For now, prefer local (lowest latency).
        return this.selectLocalOnly(eligible) ?? eligible[0];

      case 'manual':
        // Manual strategy requires the context to specify which executor to use.
        // For now, fall back to first eligible.
        return eligible[0];

      default:
        return eligible[0];
    }
  }

  private selectLocalOnly(eligible: GolemExecutor[]): GolemExecutor | null {
    return eligible.find((e) => e.getCapabilities().supportsLocal) ?? null;
  }

  private selectRoundRobin(eligible: GolemExecutor[]): GolemExecutor {
    const index = this.roundRobinIndex % eligible.length;
    this.roundRobinIndex++;
    return eligible[index];
  }
}

/** Singleton dispatcher with default local-only strategy. */
export const golemDispatcher = new GolemDispatcher();
