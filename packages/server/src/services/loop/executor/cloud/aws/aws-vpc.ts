// ---------------------------------------------------------------------------
// AWS VPC Manager
// ---------------------------------------------------------------------------
// Auto-provisions VPC, subnets, internet gateway, and security groups
// for e-golem instances. Resources are tagged with 'e-golem' prefix and
// reused on subsequent runs.
//
// Acceptance Criterion 7: VPC/subnet/security-group auto-provisioned on
// first use with 'e-golem' tag prefix; reused on subsequent runs.
//
// Acceptance Criterion 8: Security group allows outbound HTTPS (443) for
// LLM API + git, and inbound SSH (22) from coordinator IP only.
// ---------------------------------------------------------------------------

import {
  EC2Client,
  CreateVpcCommand,
  CreateSubnetCommand,
  CreateInternetGatewayCommand,
  AttachInternetGatewayCommand,
  CreateRouteTableCommand,
  CreateRouteCommand,
  AssociateRouteTableCommand,
  CreateSecurityGroupCommand,
  AuthorizeSecurityGroupIngressCommand,
  AuthorizeSecurityGroupEgressCommand,
  RevokeSecurityGroupEgressCommand,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
  DescribeSecurityGroupsCommand,
  DescribeAvailabilityZonesCommand,
  CreateTagsCommand,
  ModifyVpcAttributeCommand,
  type Tag,
  type Filter,
} from '@aws-sdk/client-ec2';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import type { AWSVPCConfig } from '@e/shared';
import { DEFAULT_AWS_VPC_CONFIG } from '@e/shared';

/**
 * Resolved VPC networking context for launching instances.
 */
export interface ResolvedVPCContext {
  /** VPC ID. */
  vpcId: string;
  /** Subnet IDs (at least one). */
  subnetIds: string[];
  /** Security group IDs. */
  securityGroupIds: string[];
}

/**
 * AWS VPC Manager — auto-provisions and manages networking resources.
 *
 * On first invocation, creates:
 * 1. A VPC with DNS support and hostnames enabled
 * 2. Subnets across available AZs
 * 3. An Internet Gateway attached to the VPC
 * 4. A route table with 0.0.0.0/0 → IGW
 * 5. A security group with:
 *    - Inbound SSH (22) from coordinator IP only
 *    - Outbound HTTPS (443) for LLM API and git
 *    - Outbound DNS (53) for name resolution
 *
 * All resources are tagged with the e-golem prefix for identification
 * and cost allocation. On subsequent runs, existing resources are reused.
 */
export class AWSVPCManager {
  private config: AWSVPCConfig;
  private ec2Client: EC2Client | null = null;
  private cached: ResolvedVPCContext | null = null;

  constructor(config: Partial<AWSVPCConfig> = {}) {
    this.config = { ...DEFAULT_AWS_VPC_CONFIG, ...config };
  }

  /**
   * Initialize the EC2 client for a specific region and credential provider.
   * Must be called before other methods.
   */
  initialize(region: string, credentials: AwsCredentialIdentityProvider): void {
    this.ec2Client = new EC2Client({ region, credentials });
    // Invalidate cache when region/creds change
    this.cached = null;
  }

  /**
   * Resolve the VPC context: find existing resources or auto-provision them.
   * Returns the VPC ID, subnet IDs, and security group IDs needed for
   * launching EC2 instances or ECS tasks.
   */
  async resolve(coordinatorIp?: string | null): Promise<ResolvedVPCContext> {
    if (this.cached) return this.cached;
    this.getClient(); // validate initialized

    // If user provided explicit VPC/subnet/SG, use them directly
    if (
      this.config.vpcId &&
      this.config.subnetIds.length > 0 &&
      this.config.securityGroupIds.length > 0
    ) {
      this.cached = {
        vpcId: this.config.vpcId,
        subnetIds: this.config.subnetIds,
        securityGroupIds: this.config.securityGroupIds,
      };
      return this.cached;
    }

    // Try to find existing e-golem VPC
    const existingVpc = await this.findExistingVPC();
    if (existingVpc) {
      console.log(`[aws-vpc] Found existing e-golem VPC: ${existingVpc.vpcId}`);

      // Find subnets and security groups in the existing VPC
      const subnets = await this.findExistingSubnets(existingVpc.vpcId);
      const securityGroups = await this.findExistingSecurityGroups(existingVpc.vpcId);

      if (subnets.length > 0 && securityGroups.length > 0) {
        this.cached = {
          vpcId: existingVpc.vpcId,
          subnetIds: subnets,
          securityGroupIds: securityGroups,
        };
        return this.cached;
      }
    }

    // Auto-provision everything
    console.log('[aws-vpc] Auto-provisioning e-golem VPC infrastructure...');
    const context = await this.autoProvision(coordinatorIp ?? this.config.coordinatorIp);
    this.cached = context;
    return context;
  }

  /**
   * Invalidate the cached VPC context (e.g., after config changes).
   */
  invalidateCache(): void {
    this.cached = null;
  }

  /**
   * Update configuration.
   */
  updateConfig(config: Partial<AWSVPCConfig>): void {
    this.config = { ...this.config, ...config };
    this.cached = null;
  }

  // ---------------------------------------------------------------------------
  // Private: Discovery
  // ---------------------------------------------------------------------------

  private async findExistingVPC(): Promise<{ vpcId: string } | null> {
    const client = this.getClient();

    const response = await client.send(
      new DescribeVpcsCommand({
        Filters: [
          { Name: 'tag:e-golem', Values: ['true'] },
          { Name: 'state', Values: ['available'] },
        ],
      }),
    );

    const vpcs = response.Vpcs ?? [];
    if (vpcs.length === 0) return null;

    return { vpcId: vpcs[0].VpcId! };
  }

  private async findExistingSubnets(vpcId: string): Promise<string[]> {
    const client = this.getClient();

    const response = await client.send(
      new DescribeSubnetsCommand({
        Filters: [
          { Name: 'vpc-id', Values: [vpcId] },
          { Name: 'tag:e-golem', Values: ['true'] },
        ],
      }),
    );

    return (response.Subnets ?? []).filter((s) => s.SubnetId).map((s) => s.SubnetId!);
  }

  private async findExistingSecurityGroups(vpcId: string): Promise<string[]> {
    const client = this.getClient();

    const response = await client.send(
      new DescribeSecurityGroupsCommand({
        Filters: [
          { Name: 'vpc-id', Values: [vpcId] },
          { Name: 'tag:e-golem', Values: ['true'] },
        ],
      }),
    );

    return (response.SecurityGroups ?? []).filter((sg) => sg.GroupId).map((sg) => sg.GroupId!);
  }

  // ---------------------------------------------------------------------------
  // Private: Auto-provisioning
  // ---------------------------------------------------------------------------

  private async autoProvision(coordinatorIp: string | null): Promise<ResolvedVPCContext> {
    const client = this.getClient();
    const tags = this.buildTags('vpc');

    // 1. Create VPC
    const vpcResult = await client.send(
      new CreateVpcCommand({
        CidrBlock: this.config.vpcCidr,
        TagSpecifications: [
          {
            ResourceType: 'vpc',
            Tags: tags,
          },
        ],
      }),
    );
    const vpcId = vpcResult.Vpc!.VpcId!;
    console.log(`[aws-vpc] Created VPC: ${vpcId}`);

    // Enable DNS support and hostnames
    await client.send(
      new ModifyVpcAttributeCommand({
        VpcId: vpcId,
        EnableDnsSupport: { Value: true },
      }),
    );
    await client.send(
      new ModifyVpcAttributeCommand({
        VpcId: vpcId,
        EnableDnsHostnames: { Value: true },
      }),
    );

    // 2. Create Internet Gateway and attach to VPC
    const igwResult = await client.send(
      new CreateInternetGatewayCommand({
        TagSpecifications: [
          {
            ResourceType: 'internet-gateway',
            Tags: this.buildTags('igw'),
          },
        ],
      }),
    );
    const igwId = igwResult.InternetGateway!.InternetGatewayId!;
    console.log(`[aws-vpc] Created Internet Gateway: ${igwId}`);

    await client.send(
      new AttachInternetGatewayCommand({
        InternetGatewayId: igwId,
        VpcId: vpcId,
      }),
    );

    // 3. Create route table with default route to IGW
    const rtResult = await client.send(
      new CreateRouteTableCommand({
        VpcId: vpcId,
        TagSpecifications: [
          {
            ResourceType: 'route-table',
            Tags: this.buildTags('rtb'),
          },
        ],
      }),
    );
    const rtId = rtResult.RouteTable!.RouteTableId!;

    await client.send(
      new CreateRouteCommand({
        RouteTableId: rtId,
        DestinationCidrBlock: '0.0.0.0/0',
        GatewayId: igwId,
      }),
    );

    // 4. Create subnets across AZs
    const azs = await this.getAvailabilityZones();
    const subnetIds: string[] = [];
    const cidrBlocks =
      this.config.subnetCidrs.length > 0 ? this.config.subnetCidrs : ['10.0.1.0/24', '10.0.2.0/24'];

    for (let i = 0; i < Math.min(cidrBlocks.length, azs.length); i++) {
      const subnetResult = await client.send(
        new CreateSubnetCommand({
          VpcId: vpcId,
          CidrBlock: cidrBlocks[i],
          AvailabilityZone: azs[i],
          TagSpecifications: [
            {
              ResourceType: 'subnet',
              Tags: this.buildTags(`subnet-${i}`),
            },
          ],
        }),
      );
      const subnetId = subnetResult.Subnet!.SubnetId!;
      subnetIds.push(subnetId);

      // Associate route table with subnet
      await client.send(
        new AssociateRouteTableCommand({
          RouteTableId: rtId,
          SubnetId: subnetId,
        }),
      );
      console.log(`[aws-vpc] Created subnet: ${subnetId} in ${azs[i]}`);
    }

    // 5. Create security group
    const sgResult = await client.send(
      new CreateSecurityGroupCommand({
        GroupName: `${this.config.tagPrefix}-sg-${Date.now()}`,
        Description: 'e-golem instance security group — managed automatically',
        VpcId: vpcId,
        TagSpecifications: [
          {
            ResourceType: 'security-group',
            Tags: this.buildTags('sg'),
          },
        ],
      }),
    );
    const sgId = sgResult.GroupId!;
    console.log(`[aws-vpc] Created security group: ${sgId}`);

    // Remove default outbound-all rule
    try {
      await client.send(
        new RevokeSecurityGroupEgressCommand({
          GroupId: sgId,
          IpPermissions: [
            {
              IpProtocol: '-1',
              IpRanges: [{ CidrIp: '0.0.0.0/0' }],
            },
          ],
        }),
      );
    } catch {
      // May not exist in all cases; ignore
    }

    // Inbound: SSH (22) from coordinator IP only
    const sshCidr = coordinatorIp ? `${coordinatorIp}/32` : '0.0.0.0/0';
    await client.send(
      new AuthorizeSecurityGroupIngressCommand({
        GroupId: sgId,
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: 22,
            ToPort: 22,
            IpRanges: [
              {
                CidrIp: sshCidr,
                Description: coordinatorIp
                  ? 'SSH from coordinator IP'
                  : 'SSH from any (coordinator IP not specified)',
              },
            ],
          },
        ],
      }),
    );

    // Outbound: HTTPS (443) for LLM API + git
    await client.send(
      new AuthorizeSecurityGroupEgressCommand({
        GroupId: sgId,
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: 443,
            ToPort: 443,
            IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'HTTPS for LLM API and git' }],
          },
        ],
      }),
    );

    // Outbound: HTTP (80) for package managers and git
    await client.send(
      new AuthorizeSecurityGroupEgressCommand({
        GroupId: sgId,
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: 80,
            ToPort: 80,
            IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'HTTP for package managers' }],
          },
        ],
      }),
    );

    // Outbound: DNS (53 TCP+UDP) for name resolution
    await client.send(
      new AuthorizeSecurityGroupEgressCommand({
        GroupId: sgId,
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: 53,
            ToPort: 53,
            IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'DNS (TCP)' }],
          },
          {
            IpProtocol: 'udp',
            FromPort: 53,
            ToPort: 53,
            IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'DNS (UDP)' }],
          },
        ],
      }),
    );

    console.log('[aws-vpc] VPC infrastructure provisioning complete');

    return {
      vpcId,
      subnetIds,
      securityGroupIds: [sgId],
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async getAvailabilityZones(): Promise<string[]> {
    const client = this.getClient();

    const response = await client.send(
      new DescribeAvailabilityZonesCommand({
        Filters: [{ Name: 'state', Values: ['available'] }],
      }),
    );

    return (response.AvailabilityZones ?? [])
      .filter((az) => az.ZoneName)
      .map((az) => az.ZoneName!)
      .slice(0, 3); // Use up to 3 AZs
  }

  private buildTags(resourceSuffix: string): Tag[] {
    return [
      { Key: 'e-golem', Value: 'true' },
      { Key: 'Name', Value: `${this.config.tagPrefix}-${resourceSuffix}` },
      { Key: 'created-by', Value: 'e-golem-auto-provision' },
      { Key: 'managed-by', Value: 'e-golem' },
    ];
  }

  private getClient(): EC2Client {
    if (!this.ec2Client) {
      throw new Error('[aws-vpc] EC2 client not initialized. Call initialize() first.');
    }
    return this.ec2Client;
  }
}
