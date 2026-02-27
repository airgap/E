// ---------------------------------------------------------------------------
// AWS Provider — shared types
// ---------------------------------------------------------------------------
// AWS-specific configuration types for the AWSProvider CloudProvider
// implementation. Covers EC2, ECS Fargate, VPC, auth, and pricing.
// ---------------------------------------------------------------------------

import type { CloudProviderType } from './cloud-provider.js';

// ---------------------------------------------------------------------------
// AWS execution backend
// ---------------------------------------------------------------------------

/** AWS-specific backend: EC2 (VM) or ECS Fargate (container). */
export type AWSBackend = 'ec2' | 'ecs-fargate';

// ---------------------------------------------------------------------------
// EC2 configuration
// ---------------------------------------------------------------------------

/** EC2 instance purchasing model. */
export type EC2PurchaseModel = 'spot' | 'on-demand';

/** EC2-specific configuration. */
export interface AWSEC2Config {
  /** Instance type to launch (default: 't3.medium'). */
  instanceType: string;
  /** Whether to prefer spot instances (default: true). Automatically falls back to on-demand. */
  preferSpot: boolean;
  /** Maximum spot price as a fraction of on-demand (default: 0.9 = 90% of on-demand). */
  maxSpotPriceRatio: number;
  /** AMI ID to use. If null, uses Amazon Linux 2023 with cloud-init bootstrap. */
  amiId: string | null;
  /** Key pair name to inject (null = use ephemeral key via user-data). */
  keyPairName: string | null;
  /** EBS volume size in GB (default: 30). */
  volumeSizeGb: number;
  /** EBS volume type (default: 'gp3'). */
  volumeType: string;
  /** Whether to use ARM-based instances (t4g) for cost savings. */
  useArm: boolean;
}

/** Default EC2 configuration. */
export const DEFAULT_AWS_EC2_CONFIG: AWSEC2Config = {
  instanceType: 't3.medium',
  preferSpot: true,
  maxSpotPriceRatio: 0.9,
  amiId: null,
  keyPairName: null,
  volumeSizeGb: 30,
  volumeType: 'gp3',
  useArm: false,
};

// ---------------------------------------------------------------------------
// ECS Fargate configuration
// ---------------------------------------------------------------------------

/** ECS Fargate-specific configuration. */
export interface AWSECSFargateConfig {
  /** Container image to run (the golem container image). */
  containerImage: string;
  /** vCPU allocation (default: 1). Valid: 0.25, 0.5, 1, 2, 4, 8, 16. */
  cpu: number;
  /** Memory in MB (default: 2048 = 2GB). Must match CPU tier. */
  memoryMb: number;
  /** ECS cluster name (auto-created if not found). */
  clusterName: string;
  /** Task definition family prefix. */
  taskDefinitionFamily: string;
  /** Whether to assign a public IP to the task (default: true). */
  assignPublicIp: boolean;
  /** Platform version (default: 'LATEST'). */
  platformVersion: string;
  /** Container port for health checks. */
  containerPort: number;
}

/** Default ECS Fargate configuration. */
export const DEFAULT_AWS_ECS_FARGATE_CONFIG: AWSECSFargateConfig = {
  containerImage: '',
  cpu: 1,
  memoryMb: 2048,
  clusterName: 'e-golem',
  taskDefinitionFamily: 'e-golem-task',
  assignPublicIp: true,
  platformVersion: 'LATEST',
  containerPort: 8080,
};

// ---------------------------------------------------------------------------
// VPC / networking configuration
// ---------------------------------------------------------------------------

/** AWS VPC configuration. */
export interface AWSVPCConfig {
  /** VPC ID to use (null = auto-provision). */
  vpcId: string | null;
  /** Subnet IDs to use (empty = auto-provision). */
  subnetIds: string[];
  /** Security group IDs to use (empty = auto-provision). */
  securityGroupIds: string[];
  /** CIDR block for auto-provisioned VPC (default: '10.0.0.0/16'). */
  vpcCidr: string;
  /** CIDR blocks for auto-provisioned subnets. */
  subnetCidrs: string[];
  /** Coordinator IP for SSH ingress rules (null = auto-detect). */
  coordinatorIp: string | null;
  /** Tag prefix for auto-provisioned resources. */
  tagPrefix: string;
}

/** Default VPC configuration. */
export const DEFAULT_AWS_VPC_CONFIG: AWSVPCConfig = {
  vpcId: null,
  subnetIds: [],
  securityGroupIds: [],
  vpcCidr: '10.0.0.0/16',
  subnetCidrs: ['10.0.1.0/24', '10.0.2.0/24'],
  coordinatorIp: null,
  tagPrefix: 'e-golem',
};

// ---------------------------------------------------------------------------
// Auth configuration
// ---------------------------------------------------------------------------

/** AWS authentication configuration. */
export interface AWSAuthConfig {
  /** AWS region for API calls (default: 'us-east-1'). */
  region: string;
  /** Optional profile name from ~/.aws/credentials. */
  profile: string | null;
  /** Optional IAM role ARN for cross-account AssumeRole. */
  assumeRoleArn: string | null;
  /** Session name for AssumeRole (default: 'e-golem-session'). */
  assumeRoleSessionName: string;
  /** External ID for AssumeRole (required by some cross-account setups). */
  assumeRoleExternalId: string | null;
  /** Duration in seconds for assumed role session (default: 3600). */
  assumeRoleDurationSeconds: number;
  /** Whether to use GovCloud regions. */
  useGovCloud: boolean;
  /** GovCloud credential profile (if different from main profile). */
  govCloudProfile: string | null;
}

/** Default auth configuration. */
export const DEFAULT_AWS_AUTH_CONFIG: AWSAuthConfig = {
  region: 'us-east-1',
  profile: null,
  assumeRoleArn: null,
  assumeRoleSessionName: 'e-golem-session',
  assumeRoleExternalId: null,
  assumeRoleDurationSeconds: 3600,
  useGovCloud: false,
  govCloudProfile: null,
};

// ---------------------------------------------------------------------------
// Top-level AWS provider configuration
// ---------------------------------------------------------------------------

/** Full AWS provider configuration. */
export interface AWSProviderConfig {
  /** AWS authentication configuration. */
  auth: AWSAuthConfig;
  /** EC2 configuration. */
  ec2: AWSEC2Config;
  /** ECS Fargate configuration. */
  ecsFargate: AWSECSFargateConfig;
  /** VPC / networking configuration. */
  vpc: AWSVPCConfig;
  /** Preferred backend (default: 'ec2'). */
  preferredBackend: AWSBackend;
}

/** Default AWS provider configuration. */
export const DEFAULT_AWS_PROVIDER_CONFIG: AWSProviderConfig = {
  auth: DEFAULT_AWS_AUTH_CONFIG,
  ec2: DEFAULT_AWS_EC2_CONFIG,
  ecsFargate: DEFAULT_AWS_ECS_FARGATE_CONFIG,
  vpc: DEFAULT_AWS_VPC_CONFIG,
  preferredBackend: 'ec2',
};

// ---------------------------------------------------------------------------
// AWS commercial regions
// ---------------------------------------------------------------------------

/** All commercial AWS regions. */
export const AWS_COMMERCIAL_REGIONS: readonly string[] = [
  'us-east-1', // N. Virginia
  'us-east-2', // Ohio
  'us-west-1', // N. California
  'us-west-2', // Oregon
  'af-south-1', // Cape Town
  'ap-east-1', // Hong Kong
  'ap-south-1', // Mumbai
  'ap-south-2', // Hyderabad
  'ap-southeast-1', // Singapore
  'ap-southeast-2', // Sydney
  'ap-southeast-3', // Jakarta
  'ap-southeast-4', // Melbourne
  'ap-northeast-1', // Tokyo
  'ap-northeast-2', // Seoul
  'ap-northeast-3', // Osaka
  'ca-central-1', // Canada (Central)
  'ca-west-1', // Canada (Calgary)
  'eu-central-1', // Frankfurt
  'eu-central-2', // Zurich
  'eu-west-1', // Ireland
  'eu-west-2', // London
  'eu-west-3', // Paris
  'eu-south-1', // Milan
  'eu-south-2', // Spain
  'eu-north-1', // Stockholm
  'il-central-1', // Tel Aviv
  'me-south-1', // Bahrain
  'me-central-1', // UAE
  'sa-east-1', // Sao Paulo
] as const;

/** AWS GovCloud regions. */
export const AWS_GOVCLOUD_REGIONS: readonly string[] = ['us-gov-east-1', 'us-gov-west-1'] as const;

/** AWS China regions. */
export const AWS_CHINA_REGIONS: readonly string[] = [
  'cn-north-1', // Beijing
  'cn-northwest-1', // Ningxia
] as const;

// ---------------------------------------------------------------------------
// Pricing reference data
// ---------------------------------------------------------------------------

/**
 * Reference spot/on-demand prices for common instance types (us-east-1).
 * Used as fallback when the AWS Price List API is unavailable.
 * Prices in USD per hour.
 */
export interface AWSInstancePricing {
  /** Instance type identifier. */
  instanceType: string;
  /** On-demand hourly price in USD. */
  onDemandHourly: number;
  /** Typical spot hourly price in USD (approximate). */
  spotHourly: number;
  /** vCPU count. */
  vcpus: number;
  /** Memory in GiB. */
  memoryGib: number;
  /** Architecture (x86_64 or arm64). */
  architecture: 'x86_64' | 'arm64';
}

/** Fargate pricing reference (per vCPU-hour and per GB-hour). */
export interface AWSFargatePricing {
  /** Per vCPU-hour price in USD. */
  cpuPerHour: number;
  /** Per GB-hour price in USD. */
  memoryPerGbHour: number;
}

/** Default Fargate pricing (us-east-1). */
export const DEFAULT_FARGATE_PRICING: AWSFargatePricing = {
  cpuPerHour: 0.04048,
  memoryPerGbHour: 0.004445,
};

/** Reference instance pricing for common types (us-east-1). */
export const AWS_REFERENCE_PRICING: AWSInstancePricing[] = [
  {
    instanceType: 't3.micro',
    onDemandHourly: 0.0104,
    spotHourly: 0.0031,
    vcpus: 2,
    memoryGib: 1,
    architecture: 'x86_64',
  },
  {
    instanceType: 't3.small',
    onDemandHourly: 0.0208,
    spotHourly: 0.0063,
    vcpus: 2,
    memoryGib: 2,
    architecture: 'x86_64',
  },
  {
    instanceType: 't3.medium',
    onDemandHourly: 0.0416,
    spotHourly: 0.0125,
    vcpus: 2,
    memoryGib: 4,
    architecture: 'x86_64',
  },
  {
    instanceType: 't3.large',
    onDemandHourly: 0.0832,
    spotHourly: 0.025,
    vcpus: 2,
    memoryGib: 8,
    architecture: 'x86_64',
  },
  {
    instanceType: 't3.xlarge',
    onDemandHourly: 0.1664,
    spotHourly: 0.0499,
    vcpus: 4,
    memoryGib: 16,
    architecture: 'x86_64',
  },
  {
    instanceType: 't4g.micro',
    onDemandHourly: 0.0084,
    spotHourly: 0.0025,
    vcpus: 2,
    memoryGib: 1,
    architecture: 'arm64',
  },
  {
    instanceType: 't4g.small',
    onDemandHourly: 0.0168,
    spotHourly: 0.005,
    vcpus: 2,
    memoryGib: 2,
    architecture: 'arm64',
  },
  {
    instanceType: 't4g.medium',
    onDemandHourly: 0.0336,
    spotHourly: 0.0101,
    vcpus: 2,
    memoryGib: 4,
    architecture: 'arm64',
  },
  {
    instanceType: 't4g.large',
    onDemandHourly: 0.0672,
    spotHourly: 0.0202,
    vcpus: 2,
    memoryGib: 8,
    architecture: 'arm64',
  },
  {
    instanceType: 'm5.large',
    onDemandHourly: 0.096,
    spotHourly: 0.037,
    vcpus: 2,
    memoryGib: 8,
    architecture: 'x86_64',
  },
  {
    instanceType: 'm5.xlarge',
    onDemandHourly: 0.192,
    spotHourly: 0.072,
    vcpus: 4,
    memoryGib: 16,
    architecture: 'x86_64',
  },
  {
    instanceType: 'm6g.large',
    onDemandHourly: 0.077,
    spotHourly: 0.029,
    vcpus: 2,
    memoryGib: 8,
    architecture: 'arm64',
  },
  {
    instanceType: 'm6g.xlarge',
    onDemandHourly: 0.154,
    spotHourly: 0.058,
    vcpus: 4,
    memoryGib: 16,
    architecture: 'arm64',
  },
  {
    instanceType: 'c5.large',
    onDemandHourly: 0.085,
    spotHourly: 0.0326,
    vcpus: 2,
    memoryGib: 4,
    architecture: 'x86_64',
  },
  {
    instanceType: 'c5.xlarge',
    onDemandHourly: 0.17,
    spotHourly: 0.0652,
    vcpus: 4,
    memoryGib: 8,
    architecture: 'x86_64',
  },
];
