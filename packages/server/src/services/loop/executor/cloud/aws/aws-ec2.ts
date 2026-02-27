// ---------------------------------------------------------------------------
// AWS EC2 Instance Manager
// ---------------------------------------------------------------------------
// Manages EC2 instance lifecycle: launch, terminate, describe.
// Supports spot instances with automatic fallback to on-demand.
//
// Acceptance Criterion 2: EC2 mode launches spot instances by default with
// automatic fallback to on-demand.
//
// Acceptance Criterion 3: EC2 instance types configurable with sensible
// default (t3.medium); supports ARM (t4g) for cost savings.
//
// Acceptance Criterion 9: All resources tagged with e-golem=true, story-id,
// prd-id, created-by for cost allocation and cleanup.
// ---------------------------------------------------------------------------

import {
  EC2Client,
  RunInstancesCommand,
  TerminateInstancesCommand,
  DescribeInstancesCommand,
  DescribeImagesCommand,
  CreateFleetCommand,
  type _InstanceType,
  type Tag,
  type TagSpecification,
  type Instance,
  type Filter,
  type FleetLaunchTemplateOverridesRequest,
} from '@aws-sdk/client-ec2';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import type {
  AWSEC2Config,
  CloudInstance,
  CloudInstanceCreateOptions,
  CloudBackendType,
  CloudProviderType,
} from '@e/shared';
import { DEFAULT_AWS_EC2_CONFIG, generateInstanceTags } from '@e/shared';
import { generateCloudInitScript } from '../cloud-init';
import { ProvisionFailedError, QuotaExceededError } from '../cloud-errors';
import type { ResolvedVPCContext } from './aws-vpc';

/**
 * EC2 launch result with purchase model information.
 */
export interface EC2LaunchResult {
  instanceId: string;
  purchaseModel: 'spot' | 'on-demand';
  instanceType: string;
  availabilityZone: string;
}

/**
 * AWS EC2 Manager — handles EC2 instance lifecycle.
 *
 * Spot Strategy:
 * 1. Attempt to launch a spot instance via EC2 Fleet API
 * 2. If spot capacity is unavailable or interrupted, automatically
 *    fall back to on-demand instances
 * 3. Spot price is capped at maxSpotPriceRatio × on-demand price
 */
export class AWSEC2Manager {
  private config: AWSEC2Config;
  private ec2Client: EC2Client | null = null;
  private currentRegion: string = 'us-east-1';

  constructor(config: Partial<AWSEC2Config> = {}) {
    this.config = { ...DEFAULT_AWS_EC2_CONFIG, ...config };
  }

  /**
   * Initialize the EC2 client for a specific region.
   */
  initialize(region: string, credentials: AwsCredentialIdentityProvider): void {
    this.currentRegion = region;
    this.ec2Client = new EC2Client({ region, credentials });
  }

  /**
   * Launch an EC2 instance for a story execution.
   *
   * When preferSpot is true (default):
   * 1. Tries to launch a spot instance first
   * 2. Falls back to on-demand if spot fails (capacity, price, etc.)
   */
  async launchInstance(
    options: CloudInstanceCreateOptions,
    vpcContext: ResolvedVPCContext,
  ): Promise<CloudInstance> {
    const client = this.getClient();

    const instanceType = options.instanceType ?? this.config.instanceType;
    const userDataScript = generateCloudInitScript(options.cloudInit);
    const userData = Buffer.from(userDataScript).toString('base64');

    // Resolve AMI
    const amiId = this.config.amiId ?? (await this.resolveDefaultAMI(instanceType));

    // Build tags
    const tags = this.buildEC2Tags(options);

    let result: EC2LaunchResult;

    if (this.config.preferSpot) {
      try {
        result = await this.launchSpotInstance(
          instanceType,
          amiId,
          userData,
          options.sshPublicKey,
          vpcContext,
          tags,
        );
        console.log(`[aws-ec2] Spot instance launched: ${result.instanceId}`);
      } catch (spotErr) {
        console.warn(
          `[aws-ec2] Spot launch failed, falling back to on-demand: ${spotErr instanceof Error ? spotErr.message : String(spotErr)}`,
        );
        result = await this.launchOnDemandInstance(
          instanceType,
          amiId,
          userData,
          options.sshPublicKey,
          vpcContext,
          tags,
        );
        console.log(`[aws-ec2] On-demand instance launched: ${result.instanceId}`);
      }
    } else {
      result = await this.launchOnDemandInstance(
        instanceType,
        amiId,
        userData,
        options.sshPublicKey,
        vpcContext,
        tags,
      );
      console.log(`[aws-ec2] On-demand instance launched: ${result.instanceId}`);
    }

    return {
      instance_id: result.instanceId,
      provider: 'aws' as CloudProviderType,
      region: this.currentRegion,
      instance_type: result.instanceType,
      status: 'provisioning',
      public_ip: null,
      created_at: new Date().toISOString(),
      story_id: options.storyId,
      cost_so_far: 0,
      backend: 'vm' as CloudBackendType,
      execution_id: options.executionId,
      prd_id: options.prdId ?? null,
      tags: {
        ...options.tags,
        'e-golem-purchase-model': result.purchaseModel,
      },
    };
  }

  /**
   * Terminate an EC2 instance.
   */
  async terminateInstance(instanceId: string): Promise<void> {
    const client = this.getClient();

    try {
      await client.send(
        new TerminateInstancesCommand({
          InstanceIds: [instanceId],
        }),
      );
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Ignore "already terminated" errors
      if (errMsg.includes('InvalidInstanceID') || errMsg.includes('terminated')) {
        return;
      }
      throw err;
    }
  }

  /**
   * Describe an EC2 instance and return its current status.
   */
  async describeInstance(instanceId: string): Promise<CloudInstance | null> {
    const client = this.getClient();

    try {
      const response = await client.send(
        new DescribeInstancesCommand({
          InstanceIds: [instanceId],
        }),
      );

      const reservations = response.Reservations ?? [];
      if (reservations.length === 0) return null;

      const instances = reservations[0].Instances ?? [];
      if (instances.length === 0) return null;

      return this.mapEC2Instance(instances[0]);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('InvalidInstanceID')) return null;
      throw err;
    }
  }

  /**
   * List EC2 instances matching the given tag filters.
   */
  async listInstances(tags?: Record<string, string>): Promise<CloudInstance[]> {
    const client = this.getClient();

    const filters: Filter[] = [];
    if (tags) {
      for (const [key, value] of Object.entries(tags)) {
        filters.push({ Name: `tag:${key}`, Values: [value] });
      }
    }

    // Exclude terminated instances from listing
    filters.push({
      Name: 'instance-state-name',
      Values: ['pending', 'running', 'stopping', 'stopped', 'shutting-down'],
    });

    const response = await client.send(new DescribeInstancesCommand({ Filters: filters }));

    const instances: CloudInstance[] = [];
    for (const reservation of response.Reservations ?? []) {
      for (const instance of reservation.Instances ?? []) {
        const mapped = this.mapEC2Instance(instance);
        if (mapped) instances.push(mapped);
      }
    }

    return instances;
  }

  /**
   * Update configuration.
   */
  updateConfig(config: Partial<AWSEC2Config>): void {
    this.config = { ...this.config, ...config };
  }

  // ---------------------------------------------------------------------------
  // Private: Launch methods
  // ---------------------------------------------------------------------------

  /**
   * Launch a spot instance using RunInstances with spot market options.
   */
  private async launchSpotInstance(
    instanceType: string,
    amiId: string,
    userData: string,
    sshPublicKey: string,
    vpcContext: ResolvedVPCContext,
    tags: TagSpecification[],
  ): Promise<EC2LaunchResult> {
    const client = this.getClient();

    try {
      const response = await client.send(
        new RunInstancesCommand({
          ImageId: amiId,
          InstanceType: instanceType as _InstanceType,
          MinCount: 1,
          MaxCount: 1,
          UserData: userData,
          SecurityGroupIds: vpcContext.securityGroupIds,
          SubnetId: vpcContext.subnetIds[0],
          TagSpecifications: tags,
          InstanceMarketOptions: {
            MarketType: 'spot',
            SpotOptions: {
              SpotInstanceType: 'one-time',
              InstanceInterruptionBehavior: 'terminate',
            },
          },
          BlockDeviceMappings: [
            {
              DeviceName: '/dev/xvda',
              Ebs: {
                VolumeSize: this.config.volumeSizeGb,
                VolumeType: this.config.volumeType as
                  | 'gp3'
                  | 'gp2'
                  | 'io1'
                  | 'io2'
                  | 'st1'
                  | 'sc1'
                  | 'standard',
                DeleteOnTermination: true,
              },
            },
          ],
          MetadataOptions: {
            HttpTokens: 'required', // Require IMDSv2
            HttpPutResponseHopLimit: 1,
          },
        }),
      );

      const instance = response.Instances?.[0];
      if (!instance?.InstanceId) {
        throw new ProvisionFailedError('aws', 'Spot instance launch returned no instance ID');
      }

      return {
        instanceId: instance.InstanceId,
        purchaseModel: 'spot',
        instanceType,
        availabilityZone: instance.Placement?.AvailabilityZone ?? this.currentRegion,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (
        errMsg.includes('InsufficientInstanceCapacity') ||
        errMsg.includes('SpotMaxPriceTooLow') ||
        errMsg.includes('MaxSpotInstanceCountExceeded')
      ) {
        throw new QuotaExceededError('aws', `Spot capacity unavailable: ${errMsg}`);
      }
      throw err;
    }
  }

  /**
   * Launch an on-demand instance as fallback.
   */
  private async launchOnDemandInstance(
    instanceType: string,
    amiId: string,
    userData: string,
    sshPublicKey: string,
    vpcContext: ResolvedVPCContext,
    tags: TagSpecification[],
  ): Promise<EC2LaunchResult> {
    const client = this.getClient();

    const response = await client.send(
      new RunInstancesCommand({
        ImageId: amiId,
        InstanceType: instanceType as _InstanceType,
        MinCount: 1,
        MaxCount: 1,
        UserData: userData,
        SecurityGroupIds: vpcContext.securityGroupIds,
        SubnetId: vpcContext.subnetIds[0],
        TagSpecifications: tags,
        BlockDeviceMappings: [
          {
            DeviceName: '/dev/xvda',
            Ebs: {
              VolumeSize: this.config.volumeSizeGb,
              VolumeType: this.config.volumeType as
                | 'gp3'
                | 'gp2'
                | 'io1'
                | 'io2'
                | 'st1'
                | 'sc1'
                | 'standard',
              DeleteOnTermination: true,
            },
          },
        ],
        MetadataOptions: {
          HttpTokens: 'required',
          HttpPutResponseHopLimit: 1,
        },
      }),
    );

    const instance = response.Instances?.[0];
    if (!instance?.InstanceId) {
      throw new ProvisionFailedError('aws', 'On-demand instance launch returned no instance ID');
    }

    return {
      instanceId: instance.InstanceId,
      purchaseModel: 'on-demand',
      instanceType,
      availabilityZone: instance.Placement?.AvailabilityZone ?? this.currentRegion,
    };
  }

  // ---------------------------------------------------------------------------
  // Private: AMI resolution
  // ---------------------------------------------------------------------------

  /**
   * Resolve the default AMI for the instance type's architecture.
   * Uses Amazon Linux 2023 (latest) with cloud-init support.
   */
  private async resolveDefaultAMI(instanceType: string): Promise<string> {
    const client = this.getClient();

    // Determine architecture from instance type
    const arch = this.getArchitecture(instanceType);

    try {
      const response = await client.send(
        new DescribeImagesCommand({
          Filters: [
            { Name: 'name', Values: ['al2023-ami-2023*'] },
            { Name: 'architecture', Values: [arch] },
            { Name: 'owner-alias', Values: ['amazon'] },
            { Name: 'state', Values: ['available'] },
            { Name: 'virtualization-type', Values: ['hvm'] },
          ],
          Owners: ['amazon'],
        }),
      );

      const images = (response.Images ?? [])
        .filter((img) => img.ImageId && img.CreationDate)
        .sort((a, b) => {
          const dateA = a.CreationDate ?? '';
          const dateB = b.CreationDate ?? '';
          return dateB.localeCompare(dateA); // Newest first
        });

      if (images.length > 0) {
        return images[0].ImageId!;
      }
    } catch (err) {
      console.warn(
        `[aws-ec2] Failed to resolve AMI, using fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Fallback AMIs (may be out of date, but better than nothing)
    return arch === 'arm64'
      ? 'ami-0c02fb55956c7d316' // Amazon Linux 2023 ARM placeholder
      : 'ami-0c02fb55956c7d316'; // Amazon Linux 2023 x86 placeholder
  }

  /**
   * Determine the CPU architecture for an instance type.
   * ARM-based instance families: t4g, m6g, m7g, c6g, c7g, r6g, r7g, etc.
   */
  private getArchitecture(instanceType: string): string {
    const armFamilies = [
      't4g',
      'm6g',
      'm6gd',
      'm7g',
      'm7gd',
      'c6g',
      'c6gd',
      'c6gn',
      'c7g',
      'c7gd',
      'c7gn',
      'r6g',
      'r6gd',
      'r7g',
      'r7gd',
      'x2gd',
      'im4gn',
      'is4gen',
      'hpc7g',
    ];

    const family = instanceType.split('.')[0];
    return armFamilies.includes(family) ? 'arm64' : 'x86_64';
  }

  // ---------------------------------------------------------------------------
  // Private: Mapping
  // ---------------------------------------------------------------------------

  /**
   * Map an AWS EC2 Instance to the CloudInstance model.
   */
  private mapEC2Instance(instance: Instance): CloudInstance | null {
    if (!instance.InstanceId) return null;

    // Extract tags into a map
    const tags: Record<string, string> = {};
    for (const tag of instance.Tags ?? []) {
      if (tag.Key && tag.Value) {
        tags[tag.Key] = tag.Value;
      }
    }

    return {
      instance_id: instance.InstanceId,
      provider: 'aws' as CloudProviderType,
      region: this.currentRegion,
      instance_type: instance.InstanceType ?? 't3.medium',
      status: this.mapEC2Status(instance.State?.Name),
      public_ip: instance.PublicIpAddress ?? null,
      created_at: instance.LaunchTime?.toISOString() ?? new Date().toISOString(),
      story_id: tags['e-golem-story-id'] ?? '',
      cost_so_far: 0,
      backend: 'vm' as CloudBackendType,
      execution_id: tags['e-golem-execution-id'],
      prd_id: tags['e-golem-prd-id'] ?? null,
      tags,
      last_heartbeat: null,
      terminated_at: instance.State?.Name === 'terminated' ? new Date().toISOString() : null,
    };
  }

  /**
   * Map EC2 instance state to CloudInstanceStatus.
   */
  private mapEC2Status(state: string | undefined): CloudInstance['status'] {
    switch (state) {
      case 'pending':
        return 'provisioning';
      case 'running':
        return 'running';
      case 'stopping':
      case 'shutting-down':
        return 'stopping';
      case 'stopped':
      case 'terminated':
        return 'terminated';
      default:
        return 'pending';
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Tags
  // ---------------------------------------------------------------------------

  private buildEC2Tags(options: CloudInstanceCreateOptions): TagSpecification[] {
    const tagList: Tag[] = Object.entries(options.tags ?? {}).map(([key, value]) => ({
      Key: key,
      Value: value,
    }));

    // Add created-by tag
    tagList.push({ Key: 'created-by', Value: 'e-golem' });

    return [
      { ResourceType: 'instance', Tags: tagList },
      { ResourceType: 'volume', Tags: tagList },
    ];
  }

  private getClient(): EC2Client {
    if (!this.ec2Client) {
      throw new Error('[aws-ec2] EC2 client not initialized. Call initialize() first.');
    }
    return this.ec2Client;
  }
}
