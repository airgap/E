// ---------------------------------------------------------------------------
// Cloud Executor — barrel export
// ---------------------------------------------------------------------------

export { CloudExecutor } from './cloud-executor';
export { SSHKeyManager, sshKeyManager } from './ssh-keys';
export { CloudCostTracker, cloudCostTracker } from './cost-tracker';
export type { CostSummary } from './cost-tracker';
export { ZombieDetector } from './zombie-detector';
export type { ZombieEventCallback } from './zombie-detector';
export { RegionSelector } from './region-selector';
export type { RegionSelectionResult } from './region-selector';
export {
  generateCloudInitScript,
  generateContainerBootstrapScript,
  buildGolemSpecJson,
} from './cloud-init';
export {
  CloudError,
  ProvisionFailedError,
  QuotaExceededError,
  RegionUnavailableError,
  InstanceTerminatedError,
  AuthFailedError,
  NetworkError,
  ConfigurationError,
  TimeoutError,
  isCloudError,
  wrapProviderError,
} from './cloud-errors';

// AWS Provider
export {
  AWSProvider,
  AWSAuthManager,
  AWSEC2Manager,
  AWSECSManager,
  AWSVPCManager,
  AWSPricingManager,
} from './aws';
export type { EC2LaunchResult, ResolvedVPCContext } from './aws';
