// ---------------------------------------------------------------------------
// AWS Auth Manager
// ---------------------------------------------------------------------------
// Handles the AWS SDK credential chain: env vars → shared credentials →
// IAM roles → instance profile. Supports cross-account execution via
// IAM role assumption (sts:AssumeRole) for enterprise multi-account setups.
//
// Acceptance Criterion 6: AWS auth supports env vars (AWS_ACCESS_KEY_ID),
// shared credentials (~/.aws/credentials), IAM roles, and cross-account
// AssumeRole.
// ---------------------------------------------------------------------------

import {
  STSClient,
  AssumeRoleCommand,
  GetCallerIdentityCommand,
  type Credentials as STSCredentials,
} from '@aws-sdk/client-sts';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from '@smithy/types';
import type { AWSAuthConfig } from '@e/shared';
import { DEFAULT_AWS_AUTH_CONFIG } from '@e/shared';

/**
 * Result of an AssumeRole call with expiry tracking.
 */
interface AssumedRoleCredentials {
  credentials: AwsCredentialIdentity;
  expiration: Date;
  roleArn: string;
}

/**
 * AWS Auth Manager — manages credential resolution and cross-account access.
 *
 * Credential resolution order (AWS SDK default chain):
 * 1. Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN)
 * 2. Shared credentials file (~/.aws/credentials)
 * 3. AWS SSO / CLI configured profiles
 * 4. ECS container credentials
 * 5. EC2 instance metadata (instance profile / IAM role)
 *
 * For cross-account execution, wraps the base credentials with sts:AssumeRole
 * to obtain temporary credentials in the target account.
 */
export class AWSAuthManager {
  private config: AWSAuthConfig;
  private assumedRole: AssumedRoleCredentials | null = null;

  constructor(config: Partial<AWSAuthConfig> = {}) {
    this.config = { ...DEFAULT_AWS_AUTH_CONFIG, ...config };
  }

  /**
   * Get the effective AWS region, accounting for GovCloud.
   */
  getRegion(): string {
    if (this.config.useGovCloud) {
      return 'us-gov-west-1';
    }
    return this.config.region;
  }

  /**
   * Get the credential provider for creating AWS SDK clients.
   *
   * If an AssumeRole ARN is configured, wraps the base provider
   * with automatic role assumption and credential refresh.
   */
  getCredentialProvider(): AwsCredentialIdentityProvider {
    const baseProvider = this.buildBaseProvider();

    if (!this.config.assumeRoleArn) {
      return baseProvider;
    }

    // Wrap with AssumeRole for cross-account access
    return this.buildAssumeRoleProvider(baseProvider);
  }

  /**
   * Validate that credentials are configured and have basic AWS access.
   * Calls sts:GetCallerIdentity to confirm creds are valid.
   *
   * @returns true if credentials are valid, false otherwise.
   */
  async validateCredentials(): Promise<boolean> {
    try {
      const stsClient = new STSClient({
        region: this.getRegion(),
        credentials: this.getCredentialProvider(),
      });

      const response = await stsClient.send(new GetCallerIdentityCommand({}));
      console.log(
        `[aws-auth] Credentials valid — Account: ${response.Account}, ` + `ARN: ${response.Arn}`,
      );
      return true;
    } catch (err) {
      console.error(
        `[aws-auth] Credential validation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * Get the AWS account ID for the current credentials.
   */
  async getAccountId(): Promise<string | null> {
    try {
      const stsClient = new STSClient({
        region: this.getRegion(),
        credentials: this.getCredentialProvider(),
      });

      const response = await stsClient.send(new GetCallerIdentityCommand({}));
      return response.Account ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Explicitly assume a role in a target account.
   * Useful for one-off cross-account operations.
   */
  async assumeRole(
    roleArn: string,
    sessionName?: string,
    externalId?: string,
    durationSeconds?: number,
  ): Promise<AwsCredentialIdentity> {
    const stsClient = new STSClient({
      region: this.getRegion(),
      credentials: this.buildBaseProvider(),
    });

    const command = new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: sessionName ?? this.config.assumeRoleSessionName,
      ...(externalId ? { ExternalId: externalId } : {}),
      DurationSeconds: durationSeconds ?? this.config.assumeRoleDurationSeconds,
    });

    const response = await stsClient.send(command);
    const creds = response.Credentials;
    if (!creds || !creds.AccessKeyId || !creds.SecretAccessKey) {
      throw new Error(`AssumeRole returned empty credentials for ${roleArn}`);
    }

    const identity: AwsCredentialIdentity = {
      accessKeyId: creds.AccessKeyId,
      secretAccessKey: creds.SecretAccessKey,
      sessionToken: creds.SessionToken,
      expiration: creds.Expiration,
    };

    this.assumedRole = {
      credentials: identity,
      expiration:
        creds.Expiration ?? new Date(Date.now() + this.config.assumeRoleDurationSeconds * 1000),
      roleArn,
    };

    console.log(
      `[aws-auth] Assumed role: ${roleArn}, expires: ${this.assumedRole.expiration.toISOString()}`,
    );
    return identity;
  }

  /**
   * Check if the currently assumed role credentials are still valid.
   */
  isAssumedRoleValid(): boolean {
    if (!this.assumedRole) return false;
    // Renew if less than 5 minutes remaining
    const bufferMs = 5 * 60 * 1000;
    return this.assumedRole.expiration.getTime() > Date.now() + bufferMs;
  }

  /**
   * Update the auth configuration.
   */
  updateConfig(config: Partial<AWSAuthConfig>): void {
    this.config = { ...this.config, ...config };
    // Invalidate cached assumed role credentials
    this.assumedRole = null;
  }

  /**
   * Get the current auth configuration.
   */
  getConfig(): AWSAuthConfig {
    return { ...this.config };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Build the base credential provider using the AWS SDK default chain.
   */
  private buildBaseProvider(): AwsCredentialIdentityProvider {
    const providerOpts: Record<string, unknown> = {};

    if (this.config.profile) {
      providerOpts.profile = this.config.profile;
    }

    // For GovCloud, use a different profile if specified
    if (this.config.useGovCloud && this.config.govCloudProfile) {
      providerOpts.profile = this.config.govCloudProfile;
    }

    return fromNodeProviderChain(providerOpts);
  }

  /**
   * Build a credential provider that automatically performs AssumeRole
   * and refreshes credentials before expiry.
   */
  private buildAssumeRoleProvider(
    baseProvider: AwsCredentialIdentityProvider,
  ): AwsCredentialIdentityProvider {
    return async () => {
      // Return cached assumed credentials if still valid
      if (this.isAssumedRoleValid()) {
        return this.assumedRole!.credentials;
      }

      // Perform AssumeRole using base credentials
      const stsClient = new STSClient({
        region: this.getRegion(),
        credentials: baseProvider,
      });

      const command = new AssumeRoleCommand({
        RoleArn: this.config.assumeRoleArn!,
        RoleSessionName: this.config.assumeRoleSessionName,
        ...(this.config.assumeRoleExternalId
          ? { ExternalId: this.config.assumeRoleExternalId }
          : {}),
        DurationSeconds: this.config.assumeRoleDurationSeconds,
      });

      const response = await stsClient.send(command);
      const creds = response.Credentials;
      if (!creds || !creds.AccessKeyId || !creds.SecretAccessKey) {
        throw new Error(`AssumeRole returned empty credentials for ${this.config.assumeRoleArn}`);
      }

      const identity: AwsCredentialIdentity = {
        accessKeyId: creds.AccessKeyId,
        secretAccessKey: creds.SecretAccessKey,
        sessionToken: creds.SessionToken,
        expiration: creds.Expiration,
      };

      this.assumedRole = {
        credentials: identity,
        expiration:
          creds.Expiration ?? new Date(Date.now() + this.config.assumeRoleDurationSeconds * 1000),
        roleArn: this.config.assumeRoleArn!,
      };

      console.log(
        `[aws-auth] Refreshed AssumeRole credentials for ${this.config.assumeRoleArn}, ` +
          `expires: ${this.assumedRole.expiration.toISOString()}`,
      );

      return identity;
    };
  }
}
