import type { GolemExecutor, ExecutorInfo, ExecutionContext } from '@e/shared';

/**
 * Registry for GolemExecutor implementations.
 * Allows runtime registration of new executor types so remote/cloud executors
 * can be plugged in without modifying core loop code.
 */
export class ExecutorRegistry {
  private executors = new Map<string, GolemExecutor>();

  /**
   * Register an executor. Replaces any existing executor with the same type.
   */
  register(executor: GolemExecutor): void {
    this.executors.set(executor.type, executor);
    console.log(`[executor-registry] Registered executor: ${executor.type} (${executor.name})`);
  }

  /**
   * Unregister an executor by type.
   * Returns true if the executor was found and removed.
   */
  unregister(type: string): boolean {
    const removed = this.executors.delete(type);
    if (removed) {
      console.log(`[executor-registry] Unregistered executor: ${type}`);
    }
    return removed;
  }

  /**
   * Get a specific executor by type.
   */
  get(type: string): GolemExecutor | undefined {
    return this.executors.get(type);
  }

  /**
   * Get all registered executors.
   */
  getAll(): GolemExecutor[] {
    return Array.from(this.executors.values());
  }

  /**
   * Get all executors that can handle the given execution context.
   */
  getEligible(context: ExecutionContext): GolemExecutor[] {
    return this.getAll().filter((executor) => executor.canExecute(context));
  }

  /**
   * List metadata for all registered executors.
   */
  listInfo(): ExecutorInfo[] {
    return this.getAll().map((executor) => ({
      type: executor.type,
      name: executor.name,
      capabilities: executor.getCapabilities(),
      description: `${executor.name} executor`,
    }));
  }

  /**
   * Check if an executor type is registered.
   */
  has(type: string): boolean {
    return this.executors.has(type);
  }

  /**
   * Number of registered executors.
   */
  get size(): number {
    return this.executors.size;
  }
}

/** Singleton executor registry. */
export const executorRegistry = new ExecutorRegistry();
