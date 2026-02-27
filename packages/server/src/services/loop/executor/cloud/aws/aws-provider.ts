// ---------------------------------------------------------------------------
// AWSProvider — CloudProvider implementation for AWS
// ---------------------------------------------------------------------------
// Implements the CloudProvider strategy interface for both EC2 instances
// (VM backend) and ECS Fargate tasks (container backend). Coordinates
// between the EC2 manager, ECS manager, VPC manager, auth manager, and
// pricing manager.
//
// Acceptance Criterion 1: AWSProvider implements CloudProvider interface
// for both EC2 and ECS Fargate backends.
//
// Acceptance Criterion 10: Supports all commercial AWS regions; GovCloud
// configurable via separate credential profile.
// ---------------------------------------------------------------------------

import type {
  CloudProvider,
  CloudProviderType,
  CloudBackendType,
  CloudInstance,
  CloudInstanceCreateOptions,
  CostEstimateRequest,
  CostEstimateResult,
  RegionCandidate,
  AWSProviderConfig,
} from '@e/shared';
import {
  DEFAULT_AWS_PROVIDER_CONFIG,
  AWS_COMMERCIAL_REGIONS,
  AWS_GOVCLOUD_REGIONS,
  AWS_REFERENCE_PRICING,
} from '@e/shared';
import {
  AuthFailedError,
  ConfigurationError,
  ProvisionFailedError,
  wrapProviderError,
} from '../cloud-errors';
import { AWSAuthManager } from './aws-auth';
import { AWSEC2Manager } from './aws-ec2';
import { AWSECSManager } from './aws-ecs';
import { AWSVPCManager } from './aws-vpc';
import { AWSPricingManager } from './aws-pricing';

/**
 * AWSProvider — CloudProvider implementation for Amazon Web Services.
 *
 * Supports two backends:
 * - **EC2 (VM)**: Spot instances by default with automatic fallback to on-demand.
 *   Instance types configurable (default: t3.medium). Supports ARM (t4g) instances.
 * - **ECS Fargate (container)**: Runs the golem container image with configurable
 *   vCPU and memory. Faster cold start (~30s vs ~90s for EC2).
 *
 * Auth: Uses the AWS SDK credential chain (env vars → shared credentials →
 * IAM role → instance profile). Supports cross-account execution via
 * sts:AssumeRole.
 *
 * Networking: VPC/subnet/security-group auto-provisioned on first use
 * with 'e-golem' tag prefix. Reused on subsequent runs.
 *
 * Regions: All commercial AWS regions supported. GovCloud and China
 * regions as optional configuration.
 */
export class AWSProvider implements CloudProvider {
  readonly providerType: CloudProviderType = 'aws';
  readonly name = 'Amazon Web Services';
  readonly supportedBackends: CloudBackendType[] = ['vm', 'container'];

  private config: AWSProviderConfig;
  private authManager: AWSAuthManager;
  private ec2Manager: AWSEC2Manager;
  private ecsManager: AWSECSManager;
  private vpcManager: AWSVPCManager;
  private pricingManager: AWSPricingManager;
  private initialized = false;
  private initRegion: string | null = null;

  constructor(config: Partial<AWSProviderConfig> = {}) {
    this.config = this.mergeConfig(config);
    this.authManager = new AWSAuthManager(this.config.auth);
    this.ec2Manager = new AWSEC2Manager(this.config.ec2);
    this.ecsManager = new AWSECSManager(this.config.ecsFargate);
    this.vpcManager = new AWSVPCManager(this.config.vpc);
    this.pricingManager = new AWSPricingManager();
  }

  // ---------------------------------------------------------------------------
  // CloudProvider interface
  // ---------------------------------------------------------------------------

  /**
   * Create a cloud instance (EC2 or Fargate) for story execution.
   *
   * For EC2: Launches a spot instance with automatic fallback to on-demand.
   * For Fargate: Runs a container task with the configured vCPU/memory.
   */
  async createInstance(options: CloudInstanceCreateOptions): Promise<CloudInstance> {
    const region = options.region ?? this.config.auth.region;
    await this.ensureInitialized(region);

    const backend = options.backend ?? this.resolveBackend();

    try {
      // Resolve VPC networking
      const vpcContext = await this.vpcManager.resolve(this.config.vpc.coordinatorIp);

      if (backend === 'container') {
        // Validate that container image is configured
        if (!this.config.ecsFargate.containerImage) {
          throw new ConfigurationError(
            'aws',
            'ECS Fargate requires a container image (ecsFargate.containerImage)',
          );
        }
        return await this.ecsManager.launchTask(options, vpcContext);
      }

      // Default: EC2 VM backend
      return await this.ec2Manager.launchInstance(options, vpcContext);
    } catch (err) {
      if (err instanceof Error && err.name.includes('Error')) {
        const cloudErr = wrapProviderError('aws', err, 'createInstance');
        throw cloudErr;
      }
      throw err;
    }
  }

  /**
   * Destroy a running instance or task.
   * Idempotent — no error if already terminated.
   */
  async destroyInstance(instanceId: string): Promise<void> {
    await this.ensureInitialized();

    try {
      // Try EC2 first, then ECS
      // EC2 instance IDs start with "i-", ECS task IDs are UUIDs
      if (instanceId.startsWith('i-')) {
        await this.ec2Manager.terminateInstance(instanceId);
      } else {
        // Could be an ECS task ID or ARN
        await this.ecsManager.stopTask(instanceId);
      }
    } catch (err) {
      // Ignore not-found errors (idempotent destroy)
      const errMsg = err instanceof Error ? err.message : String(err);
      if (
        errMsg.includes('not found') ||
        errMsg.includes('InvalidInstanceID') ||
        errMsg.includes('STOPPED')
      ) {
        return;
      }
      throw wrapProviderError('aws', err, 'destroyInstance');
    }
  }

  /**
   * Get the current status of an instance or task.
   */
  async getInstanceStatus(instanceId: string): Promise<CloudInstance | null> {
    await this.ensureInitialized();

    try {
      if (instanceId.startsWith('i-')) {
        return await this.ec2Manager.describeInstance(instanceId);
      }
      return await this.ecsManager.describeTask(instanceId);
    } catch (err) {
      throw wrapProviderError('aws', err, 'getInstanceStatus');
    }
  }

  /**
   * List all e-golem instances, optionally filtered by tags.
   * Queries both EC2 and ECS backends.
   */
  async listInstances(tags?: Record<string, string>): Promise<CloudInstance[]> {
    await this.ensureInitialized();

    const results: CloudInstance[] = [];

    try {
      const [ec2Instances, ecsInstances] = await Promise.allSettled([
        this.ec2Manager.listInstances(tags),
        this.ecsManager.listTasks(tags),
      ]);

      if (ec2Instances.status === 'fulfilled') {
        results.push(...ec2Instances.value);
      }
      if (ecsInstances.status === 'fulfilled') {
        results.push(...ecsInstances.value);
      }
    } catch (err) {
      throw wrapProviderError('aws', err, 'listInstances');
    }

    return results;
  }

  /**
   * Estimate the cost of running an instance.
   * Uses AWS Price List API with fallback to reference pricing.
   *
   * Acceptance Criterion 11: Cost estimation uses current spot/on-demand
   * pricing from AWS Price List API.
   */
  async estimateCost(request: CostEstimateRequest): Promise<CostEstimateResult> {
    await this.ensureInitialized();
    return this.pricingManager.estimateCost(request);
  }

  /**
   * List available regions with cost and availability metadata.
   *
   * Acceptance Criterion 10: Supports all commercial AWS regions.
   * GovCloud configurable via separate credential profile.
   */
  async listRegions(instanceType?: string): Promise<RegionCandidate[]> {
    const type = instanceType ?? this.config.ec2.instanceType;
    const regions = this.getSupportedRegions();

    const candidates: RegionCandidate[] = [];
    for (const region of regions) {
      // Look up reference pricing for this instance type
      const refPricing = AWS_REFERENCE_PRICING.find((p) => p.instanceType === type);

      candidates.push({
        region,
        estimatedHourlyCostUsd: refPricing?.onDemandHourly ?? 0.0416, // Default t3.medium
        available: true,
        latencyMs: null,
      });
    }

    return candidates;
  }

  /**
   * Validate AWS credentials.
   *
   * Acceptance Criterion 6: Validates the credential chain works correctly.
   */
  async validateCredentials(): Promise<boolean> {
    try {
      return await this.authManager.validateCredentials();
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // AWSProvider-specific methods
  // ---------------------------------------------------------------------------

  /**
   * Get the auth manager for direct access to credential operations.
   */
  getAuthManager(): AWSAuthManager {
    return this.authManager;
  }

  /**
   * Get the VPC manager for direct VPC operations.
   */
  getVPCManager(): AWSVPCManager {
    return this.vpcManager;
  }

  /**
   * Get the pricing manager for direct pricing queries.
   */
  getPricingManager(): AWSPricingManager {
    return this.pricingManager;
  }

  /**
   * Get the list of supported regions based on configuration.
   */
  getSupportedRegions(): string[] {
    const regions = [...AWS_COMMERCIAL_REGIONS];

    if (this.config.auth.useGovCloud) {
      regions.push(...AWS_GOVCLOUD_REGIONS);
    }

    return regions;
  }

  /**
   * Update the provider configuration.
   * Re-initializes subsystems as needed.
   */
  updateConfig(config: Partial<AWSProviderConfig>): void {
    this.config = this.mergeConfig(config);

    if (config.auth) {
      this.authManager.updateConfig(config.auth);
    }
    if (config.ec2) {
      this.ec2Manager.updateConfig(config.ec2);
    }
    if (config.ecsFargate) {
      this.ecsManager.updateConfig(config.ecsFargate);
    }
    if (config.vpc) {
      this.vpcManager.updateConfig(config.vpc);
    }

    // Force re-initialization with new config
    this.initialized = false;
    this.initRegion = null;
  }

  /**
   * Get the current configuration.
   */
  getConfig(): AWSProviderConfig {
    return { ...this.config };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Ensure all subsystem clients are initialized for the given region.
   */
  private async ensureInitialized(region?: string): Promise<void> {
    const targetRegion = region ?? this.config.auth.region;

    if (this.initialized && this.initRegion === targetRegion) {
      return;
    }

    const credentials = this.authManager.getCredentialProvider();

    this.ec2Manager.initialize(targetRegion, credentials);
    this.ecsManager.initialize(targetRegion, credentials);
    this.vpcManager.initialize(targetRegion, credentials);
    this.pricingManager.initialize(targetRegion, credentials);

    this.initialized = true;
    this.initRegion = targetRegion;
  }

  /**
   * Resolve the backend type from configuration.
   */
  private resolveBackend(): CloudBackendType {
    switch (this.config.preferredBackend) {
      case 'ecs-fargate':
        return 'container';
      case 'ec2':
      default:
        return 'vm';
    }
  }

  /**
   * Deep merge configuration with defaults.
   */
  private mergeConfig(config: Partial<AWSProviderConfig>): AWSProviderConfig {
    return {
      auth: { ...DEFAULT_AWS_PROVIDER_CONFIG.auth, ...config.auth },
      ec2: { ...DEFAULT_AWS_PROVIDER_CONFIG.ec2, ...config.ec2 },
      ecsFargate: { ...DEFAULT_AWS_PROVIDER_CONFIG.ecsFargate, ...config.ecsFargate },
      vpc: { ...DEFAULT_AWS_PROVIDER_CONFIG.vpc, ...config.vpc },
      preferredBackend: config.preferredBackend ?? DEFAULT_AWS_PROVIDER_CONFIG.preferredBackend,
    };
  }
}
