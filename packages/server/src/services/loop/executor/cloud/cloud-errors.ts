// ---------------------------------------------------------------------------
// Cloud Provider Error Classes
// ---------------------------------------------------------------------------
// Provider-agnostic error types for structured error handling.
// Acceptance Criterion 9: ProvisionFailed, QuotaExceeded, RegionUnavailable,
// InstanceTerminated, AuthFailed.
// ---------------------------------------------------------------------------

import type { CloudErrorCode, CloudProviderType, CloudProviderError } from '@e/shared';

/**
 * Base error class for cloud provider errors.
 * Wraps the CloudProviderError interface into a throwable Error.
 */
export class CloudError extends Error {
  readonly code: CloudErrorCode;
  readonly provider: CloudProviderType;
  readonly region?: string;
  readonly instanceId?: string;
  readonly retryable: boolean;
  readonly retryDelayMs?: number | null;
  readonly providerError?: unknown;

  constructor(error: CloudProviderError) {
    super(error.message);
    this.name = `CloudError[${error.code}]`;
    this.code = error.code;
    this.provider = error.provider;
    this.region = error.region;
    this.instanceId = error.instanceId;
    this.retryable = error.retryable;
    this.retryDelayMs = error.retryDelayMs;
    this.providerError = error.providerError;
  }

  /** Convert back to the plain interface. */
  toCloudProviderError(): CloudProviderError {
    return {
      code: this.code,
      message: this.message,
      provider: this.provider,
      region: this.region,
      instanceId: this.instanceId,
      retryable: this.retryable,
      retryDelayMs: this.retryDelayMs,
      providerError: this.providerError,
    };
  }
}

/** Instance provisioning failed (e.g. launch API error). */
export class ProvisionFailedError extends CloudError {
  constructor(provider: CloudProviderType, message: string, opts?: Partial<CloudProviderError>) {
    super({
      code: 'ProvisionFailed',
      message,
      provider,
      retryable: true,
      retryDelayMs: 30_000,
      ...opts,
    });
    this.name = 'ProvisionFailedError';
  }
}

/** Cloud quota or limit exceeded. */
export class QuotaExceededError extends CloudError {
  constructor(provider: CloudProviderType, message: string, opts?: Partial<CloudProviderError>) {
    super({
      code: 'QuotaExceeded',
      message,
      provider,
      retryable: true,
      retryDelayMs: 60_000,
      ...opts,
    });
    this.name = 'QuotaExceededError';
  }
}

/** Requested region is unavailable. */
export class RegionUnavailableError extends CloudError {
  constructor(
    provider: CloudProviderType,
    region: string,
    message: string,
    opts?: Partial<CloudProviderError>,
  ) {
    super({
      code: 'RegionUnavailable',
      message,
      provider,
      region,
      retryable: true,
      retryDelayMs: 10_000,
      ...opts,
    });
    this.name = 'RegionUnavailableError';
  }
}

/** Instance was unexpectedly terminated. */
export class InstanceTerminatedError extends CloudError {
  constructor(
    provider: CloudProviderType,
    instanceId: string,
    message: string,
    opts?: Partial<CloudProviderError>,
  ) {
    super({
      code: 'InstanceTerminated',
      message,
      provider,
      instanceId,
      retryable: false,
      ...opts,
    });
    this.name = 'InstanceTerminatedError';
  }
}

/** Authentication or authorization failed. */
export class AuthFailedError extends CloudError {
  constructor(provider: CloudProviderType, message: string, opts?: Partial<CloudProviderError>) {
    super({
      code: 'AuthFailed',
      message,
      provider,
      retryable: false,
      ...opts,
    });
    this.name = 'AuthFailedError';
  }
}

/** Network connectivity error. */
export class NetworkError extends CloudError {
  constructor(provider: CloudProviderType, message: string, opts?: Partial<CloudProviderError>) {
    super({
      code: 'NetworkError',
      message,
      provider,
      retryable: true,
      retryDelayMs: 5_000,
      ...opts,
    });
    this.name = 'NetworkError';
  }
}

/** Configuration error (invalid parameters, missing config, etc.). */
export class ConfigurationError extends CloudError {
  constructor(provider: CloudProviderType, message: string, opts?: Partial<CloudProviderError>) {
    super({
      code: 'ConfigurationError',
      message,
      provider,
      retryable: false,
      ...opts,
    });
    this.name = 'ConfigurationError';
  }
}

/** Timeout waiting for instance readiness or operation completion. */
export class TimeoutError extends CloudError {
  constructor(provider: CloudProviderType, message: string, opts?: Partial<CloudProviderError>) {
    super({
      code: 'TimeoutError',
      message,
      provider,
      retryable: true,
      retryDelayMs: 15_000,
      ...opts,
    });
    this.name = 'TimeoutError';
  }
}

/**
 * Determine if an unknown error is a CloudError.
 */
export function isCloudError(err: unknown): err is CloudError {
  return err instanceof CloudError;
}

/**
 * Wrap an unknown provider error into a CloudError.
 */
export function wrapProviderError(
  provider: CloudProviderType,
  err: unknown,
  context?: string,
): CloudError {
  if (err instanceof CloudError) return err;

  const message = context
    ? `${context}: ${err instanceof Error ? err.message : String(err)}`
    : err instanceof Error
      ? err.message
      : String(err);

  return new CloudError({
    code: 'UnknownError',
    message,
    provider,
    retryable: false,
    providerError: err,
  });
}
