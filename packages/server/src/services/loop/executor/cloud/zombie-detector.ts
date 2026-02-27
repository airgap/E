// ---------------------------------------------------------------------------
// Zombie Instance Detector
// ---------------------------------------------------------------------------
// Periodically sweeps cloud providers for instances tagged as e-golem but
// not tracked by the coordinator. Destroys or alerts on orphaned instances.
// ---------------------------------------------------------------------------

import type {
  CloudProvider,
  CloudInstance,
  ZombieInstance,
  ZombieDetectorConfig,
  CloudProviderType,
} from '@e/shared';
import { DEFAULT_ZOMBIE_DETECTOR_CONFIG } from '@e/shared';

/** Callback for zombie detection events. */
export type ZombieEventCallback = (zombie: ZombieInstance) => void;

/**
 * Zombie Instance Detector — finds and cleans up orphaned cloud instances.
 *
 * Acceptance Criterion 6: Zombie instance detector runs every 5 minutes —
 * finds instances tagged as e-golem but not tracked by coordinator.
 *
 * An instance is considered a "zombie" if:
 * 1. It has the e-golem tag
 * 2. It is NOT in the coordinator's tracked instance set
 * 3. It is not in a terminal state (terminated/failed)
 */
export class ZombieDetector {
  private config: ZombieDetectorConfig;
  private providers = new Map<CloudProviderType, CloudProvider>();
  private trackedInstanceIds = new Set<string>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private detectedZombies: ZombieInstance[] = [];
  private onZombieDetected: ZombieEventCallback | null = null;
  private running = false;

  constructor(config: Partial<ZombieDetectorConfig> = {}) {
    this.config = { ...DEFAULT_ZOMBIE_DETECTOR_CONFIG, ...config };
  }

  /**
   * Register a cloud provider for zombie scanning.
   */
  registerProvider(provider: CloudProvider): void {
    this.providers.set(provider.providerType, provider);
  }

  /**
   * Unregister a cloud provider.
   */
  unregisterProvider(providerType: CloudProviderType): void {
    this.providers.delete(providerType);
  }

  /**
   * Update the set of instance IDs currently tracked by the coordinator.
   * Instances in this set will NOT be flagged as zombies.
   */
  updateTrackedInstances(instanceIds: Set<string> | string[]): void {
    this.trackedInstanceIds = new Set(instanceIds);
  }

  /**
   * Add an instance ID to the tracked set.
   */
  trackInstance(instanceId: string): void {
    this.trackedInstanceIds.add(instanceId);
  }

  /**
   * Remove an instance ID from the tracked set.
   */
  untrackInstance(instanceId: string): void {
    this.trackedInstanceIds.delete(instanceId);
  }

  /**
   * Set callback for zombie detection events.
   */
  onDetected(callback: ZombieEventCallback): void {
    this.onZombieDetected = callback;
  }

  /**
   * Start the periodic sweep timer.
   * Runs every sweepIntervalMs (default: 5 minutes).
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    console.log(`[zombie-detector] Starting with ${this.config.sweepIntervalMs}ms interval`);

    // Run first sweep immediately
    void this.sweep();

    // Schedule periodic sweeps
    this.sweepTimer = setInterval(() => {
      void this.sweep();
    }, this.config.sweepIntervalMs);
  }

  /**
   * Stop the periodic sweep timer.
   */
  stop(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.running = false;
    console.log('[zombie-detector] Stopped');
  }

  /**
   * Run a single sweep across all registered providers.
   * Can be called manually or is run automatically by the timer.
   */
  async sweep(): Promise<ZombieInstance[]> {
    const newZombies: ZombieInstance[] = [];

    for (const [providerType, provider] of this.providers) {
      try {
        // Find all instances tagged as e-golem
        const instances = await provider.listInstances({
          [this.config.tagKey]: 'true',
        });

        // Check each instance against tracked set
        for (const instance of instances) {
          // Skip instances in terminal states
          if (instance.status === 'terminated' || instance.status === 'failed') {
            continue;
          }

          // If not tracked by coordinator, it's a zombie
          if (!this.trackedInstanceIds.has(instance.instance_id)) {
            const zombie: ZombieInstance = {
              instanceId: instance.instance_id,
              provider: providerType,
              region: instance.region,
              tags: instance.tags,
              createdAt: instance.created_at,
              detectedAt: new Date().toISOString(),
              action: this.config.autoDestroy ? 'destroy' : 'alert',
            };

            newZombies.push(zombie);
            this.detectedZombies.push(zombie);

            // Notify callback
            if (this.onZombieDetected) {
              this.onZombieDetected(zombie);
            }

            // Auto-destroy if configured
            if (this.config.autoDestroy) {
              try {
                console.log(
                  `[zombie-detector] Destroying zombie instance: ${instance.instance_id} (${providerType}/${instance.region})`,
                );
                await provider.destroyInstance(instance.instance_id);
                zombie.action = 'destroy';
              } catch (err) {
                console.error(
                  `[zombie-detector] Failed to destroy zombie ${instance.instance_id}: ${err}`,
                );
                zombie.action = 'alert';
              }
            }
          }
        }
      } catch (err) {
        console.error(`[zombie-detector] Failed to sweep provider ${providerType}: ${err}`);
      }
    }

    if (newZombies.length > 0) {
      console.log(`[zombie-detector] Found ${newZombies.length} zombie instance(s)`);
    }

    return newZombies;
  }

  /**
   * Get all detected zombies (historical).
   */
  getDetectedZombies(): ZombieInstance[] {
    return [...this.detectedZombies];
  }

  /**
   * Get the count of detected zombies.
   */
  get zombieCount(): number {
    return this.detectedZombies.length;
  }

  /**
   * Clear zombie detection history.
   */
  clearHistory(): void {
    this.detectedZombies = [];
  }

  /**
   * Whether the detector is currently running.
   */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the current configuration.
   */
  getConfig(): ZombieDetectorConfig {
    return { ...this.config };
  }

  /**
   * Update configuration. Restarts the timer if interval changed.
   */
  updateConfig(config: Partial<ZombieDetectorConfig>): void {
    const oldInterval = this.config.sweepIntervalMs;
    this.config = { ...this.config, ...config };

    // Restart timer if interval changed and currently running
    if (this.running && config.sweepIntervalMs && config.sweepIntervalMs !== oldInterval) {
      this.stop();
      this.start();
    }
  }
}
