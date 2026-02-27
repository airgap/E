// ---------------------------------------------------------------------------
// Region Selector
// ---------------------------------------------------------------------------
// Selects the best cloud region based on the configured strategy:
// - user-preferred: pick from user's ordered preference list
// - cheapest-available: sort by hourly cost
// - closest-to-repo-host: sort by network latency to repo host
// ---------------------------------------------------------------------------

import type {
  CloudProvider,
  RegionSelectionConfig,
  RegionSelectionStrategy,
  RegionCandidate,
} from '@e/shared';

/**
 * Region selection result with reasoning.
 */
export interface RegionSelectionResult {
  /** Selected region identifier. */
  region: string;
  /** Strategy used for selection. */
  strategy: RegionSelectionStrategy;
  /** Why this region was chosen. */
  reason: string;
  /** Estimated hourly cost. */
  estimatedHourlyCostUsd?: number;
  /** All candidates considered. */
  candidates: RegionCandidate[];
}

/**
 * Region Selector — picks the best cloud region based on strategy.
 *
 * Acceptance Criterion 8: Region selection supports user-preferred list,
 * cheapest-available, and closest-to-repo-host strategies.
 */
export class RegionSelector {
  private config: RegionSelectionConfig;

  constructor(config: RegionSelectionConfig) {
    this.config = config;
  }

  /**
   * Select the best region for a given provider and instance type.
   */
  async selectRegion(
    provider: CloudProvider,
    instanceType: string,
  ): Promise<RegionSelectionResult> {
    // Get available regions with cost/availability data
    const candidates = await provider.listRegions(instanceType);
    const available = candidates.filter((c) => c.available);

    if (available.length === 0) {
      // Try fallback regions if no candidates are available
      const fallbackResult = this.tryFallbackRegion(candidates);
      if (fallbackResult) return fallbackResult;

      throw new Error(
        `No available regions for instance type ${instanceType} on ${provider.providerType}`,
      );
    }

    switch (this.config.strategy) {
      case 'user-preferred':
        return this.selectUserPreferred(available, candidates);
      case 'cheapest-available':
        return this.selectCheapest(available, candidates);
      case 'closest-to-repo-host':
        return this.selectClosest(available, candidates);
      default:
        return this.selectUserPreferred(available, candidates);
    }
  }

  /**
   * Update the region selection configuration.
   */
  updateConfig(config: Partial<RegionSelectionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get the current configuration.
   */
  getConfig(): RegionSelectionConfig {
    return { ...this.config };
  }

  // --- Strategy implementations ---

  private selectUserPreferred(
    available: RegionCandidate[],
    allCandidates: RegionCandidate[],
  ): RegionSelectionResult {
    // Try preferred regions in order
    for (const preferred of this.config.preferredRegions) {
      const candidate = available.find((c) => c.region === preferred);
      if (candidate) {
        return {
          region: candidate.region,
          strategy: 'user-preferred',
          reason: `User-preferred region (priority ${this.config.preferredRegions.indexOf(preferred) + 1})`,
          estimatedHourlyCostUsd: candidate.estimatedHourlyCostUsd,
          candidates: allCandidates,
        };
      }
    }

    // Try fallback regions
    for (const fallback of this.config.fallbackRegions) {
      const candidate = available.find((c) => c.region === fallback);
      if (candidate) {
        return {
          region: candidate.region,
          strategy: 'user-preferred',
          reason: `Fallback region (preferred regions unavailable)`,
          estimatedHourlyCostUsd: candidate.estimatedHourlyCostUsd,
          candidates: allCandidates,
        };
      }
    }

    // Fall back to cheapest available
    return this.selectCheapest(available, allCandidates);
  }

  private selectCheapest(
    available: RegionCandidate[],
    allCandidates: RegionCandidate[],
  ): RegionSelectionResult {
    const sorted = [...available].sort(
      (a, b) => a.estimatedHourlyCostUsd - b.estimatedHourlyCostUsd,
    );
    const cheapest = sorted[0];

    return {
      region: cheapest.region,
      strategy: 'cheapest-available',
      reason: `Cheapest available ($${cheapest.estimatedHourlyCostUsd.toFixed(4)}/hr)`,
      estimatedHourlyCostUsd: cheapest.estimatedHourlyCostUsd,
      candidates: allCandidates,
    };
  }

  private selectClosest(
    available: RegionCandidate[],
    allCandidates: RegionCandidate[],
  ): RegionSelectionResult {
    // Filter to candidates with latency data
    const withLatency = available.filter((c) => c.latencyMs !== null && c.latencyMs !== undefined);

    if (withLatency.length > 0) {
      const sorted = [...withLatency].sort(
        (a, b) => (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity),
      );
      const closest = sorted[0];

      return {
        region: closest.region,
        strategy: 'closest-to-repo-host',
        reason: `Closest to repo host (${closest.latencyMs}ms latency)`,
        estimatedHourlyCostUsd: closest.estimatedHourlyCostUsd,
        candidates: allCandidates,
      };
    }

    // If no latency data, try to match by repo host region hint
    if (this.config.repoHostRegion) {
      const sameRegion = available.find((c) => c.region === this.config.repoHostRegion);
      if (sameRegion) {
        return {
          region: sameRegion.region,
          strategy: 'closest-to-repo-host',
          reason: `Same region as repo host (${this.config.repoHostRegion})`,
          estimatedHourlyCostUsd: sameRegion.estimatedHourlyCostUsd,
          candidates: allCandidates,
        };
      }

      // Try same geographic area (match prefix before the last dash)
      const prefix = this.config.repoHostRegion.replace(/-\d+$/, '');
      const sameArea = available.find((c) => c.region.startsWith(prefix));
      if (sameArea) {
        return {
          region: sameArea.region,
          strategy: 'closest-to-repo-host',
          reason: `Same geographic area as repo host (${prefix})`,
          estimatedHourlyCostUsd: sameArea.estimatedHourlyCostUsd,
          candidates: allCandidates,
        };
      }
    }

    // Fall back to cheapest if no latency data available
    return this.selectCheapest(available, allCandidates);
  }

  private tryFallbackRegion(allCandidates: RegionCandidate[]): RegionSelectionResult | null {
    // Check if any fallback regions exist in candidates (even unavailable)
    for (const fallback of this.config.fallbackRegions) {
      const candidate = allCandidates.find((c) => c.region === fallback);
      if (candidate) {
        return {
          region: candidate.region,
          strategy: this.config.strategy,
          reason: 'Fallback region (all preferred regions unavailable)',
          estimatedHourlyCostUsd: candidate.estimatedHourlyCostUsd,
          candidates: allCandidates,
        };
      }
    }
    return null;
  }
}
