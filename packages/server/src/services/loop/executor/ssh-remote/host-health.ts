// ---------------------------------------------------------------------------
// Remote Host Health Monitor
// ---------------------------------------------------------------------------
// Periodically checks SSH connectivity to all configured remote hosts.
// Unhealthy hosts are excluded from scheduling.
// ---------------------------------------------------------------------------

import type { RemoteHostConfig, RemoteHostHealth, RemoteHostHealthStatus } from '@e/shared';
import { SSHClient } from './ssh-client';

/**
 * Remote Host Health Monitor.
 *
 * AC6: Host health check runs every 30s; unhealthy hosts excluded from scheduling.
 */
export class HostHealthMonitor {
  private healthMap = new Map<string, RemoteHostHealth>();
  private sshClients = new Map<string, SSHClient>();
  private activeStoryCounts = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private intervalMs: number;

  constructor(hosts: RemoteHostConfig[], intervalMs: number = 30_000) {
    this.intervalMs = intervalMs;

    for (const host of hosts) {
      this.sshClients.set(host.id, new SSHClient(host));
      this.activeStoryCounts.set(host.id, 0);
      this.healthMap.set(host.id, {
        hostId: host.id,
        status: 'unknown',
        activeStories: 0,
        availableSlots: host.maxConcurrentStories,
        lastCheckAt: null,
        lastError: null,
        latencyMs: null,
        golemAvailable: false,
        loadAverage: null,
      });
    }
  }

  /**
   * Start the periodic health check timer.
   * Runs immediately, then every intervalMs.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    console.log(
      `[host-health] Starting health checks every ${this.intervalMs}ms for ${this.sshClients.size} hosts`,
    );

    // Run initial check
    void this.checkAll();

    this.timer = setInterval(() => {
      void this.checkAll();
    }, this.intervalMs);
  }

  /**
   * Stop the periodic health check timer.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    console.log('[host-health] Stopped');
  }

  /**
   * Run a health check for all registered hosts.
   */
  async checkAll(): Promise<void> {
    const promises = Array.from(this.sshClients.entries()).map(([hostId, client]) =>
      this.checkHost(hostId, client),
    );
    await Promise.allSettled(promises);
  }

  /**
   * Run a health check for a single host.
   */
  async checkHost(hostId: string, client?: SSHClient): Promise<RemoteHostHealth> {
    const sshClient = client ?? this.sshClients.get(hostId);
    if (!sshClient) {
      throw new Error(`Unknown host: ${hostId}`);
    }

    const health = this.healthMap.get(hostId)!;
    health.status = 'checking';

    try {
      // SSH ping
      const pingResult = await sshClient.ping();

      if (!pingResult.reachable) {
        health.status = 'unhealthy';
        health.lastError = pingResult.error;
        health.latencyMs = null;
        health.golemAvailable = false;
        health.loadAverage = null;
      } else {
        // Check golem binary
        const golemAvailable = await sshClient.checkGolemBinary();

        // Get load average
        const loadAverage = await sshClient.getLoadAverage();

        health.status = 'healthy';
        health.latencyMs = pingResult.latencyMs;
        health.golemAvailable = golemAvailable;
        health.loadAverage = loadAverage;
        health.lastError = null;
      }
    } catch (err) {
      health.status = 'unhealthy';
      health.lastError = err instanceof Error ? err.message : String(err);
    }

    health.lastCheckAt = new Date().toISOString();
    health.activeStories = this.activeStoryCounts.get(hostId) ?? 0;
    const hostConfig = sshClient.getConfig();
    health.availableSlots = hostConfig.maxConcurrentStories - health.activeStories;

    return { ...health };
  }

  /**
   * Get the current health status of a host.
   */
  getHealth(hostId: string): RemoteHostHealth | null {
    return this.healthMap.get(hostId) ?? null;
  }

  /**
   * Get health status for all hosts.
   */
  getAllHealth(): RemoteHostHealth[] {
    return Array.from(this.healthMap.values());
  }

  /**
   * Get all healthy hosts with available slots.
   *
   * AC8: Load balancing across hosts respects max_concurrent_stories limit per host.
   */
  getAvailableHosts(): RemoteHostHealth[] {
    return Array.from(this.healthMap.values()).filter(
      (h) => h.status === 'healthy' && h.availableSlots > 0,
    );
  }

  /**
   * Increment the active story count for a host.
   */
  incrementActiveStories(hostId: string): void {
    const current = this.activeStoryCounts.get(hostId) ?? 0;
    this.activeStoryCounts.set(hostId, current + 1);

    const health = this.healthMap.get(hostId);
    if (health) {
      health.activeStories = current + 1;
      const client = this.sshClients.get(hostId);
      if (client) {
        health.availableSlots = client.getConfig().maxConcurrentStories - (current + 1);
      }
    }
  }

  /**
   * Decrement the active story count for a host.
   */
  decrementActiveStories(hostId: string): void {
    const current = this.activeStoryCounts.get(hostId) ?? 0;
    const newCount = Math.max(0, current - 1);
    this.activeStoryCounts.set(hostId, newCount);

    const health = this.healthMap.get(hostId);
    if (health) {
      health.activeStories = newCount;
      const client = this.sshClients.get(hostId);
      if (client) {
        health.availableSlots = client.getConfig().maxConcurrentStories - newCount;
      }
    }
  }

  /**
   * Add a new host to the health monitor.
   */
  addHost(host: RemoteHostConfig): void {
    this.sshClients.set(host.id, new SSHClient(host));
    this.activeStoryCounts.set(host.id, 0);
    this.healthMap.set(host.id, {
      hostId: host.id,
      status: 'unknown',
      activeStories: 0,
      availableSlots: host.maxConcurrentStories,
      lastCheckAt: null,
      lastError: null,
      latencyMs: null,
      golemAvailable: false,
      loadAverage: null,
    });

    // Trigger immediate health check
    void this.checkHost(host.id);
  }

  /**
   * Remove a host from the health monitor.
   */
  removeHost(hostId: string): void {
    this.sshClients.delete(hostId);
    this.activeStoryCounts.delete(hostId);
    this.healthMap.delete(hostId);
  }

  /**
   * Whether the monitor is currently running.
   */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the SSH client for a host.
   */
  getSSHClient(hostId: string): SSHClient | undefined {
    return this.sshClients.get(hostId);
  }
}
