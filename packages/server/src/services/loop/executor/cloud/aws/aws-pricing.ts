// ---------------------------------------------------------------------------
// AWS Pricing Manager
// ---------------------------------------------------------------------------
// Provides cost estimation using AWS Price List API with fallback to
// reference pricing data. Supports both EC2 (spot/on-demand) and
// ECS Fargate pricing.
//
// Acceptance Criterion 11: Cost estimation uses current spot/on-demand
// pricing from AWS Price List API.
// ---------------------------------------------------------------------------

import {
  PricingClient,
  GetProductsCommand,
  type PricingClientConfig,
} from '@aws-sdk/client-pricing';
import {
  EC2Client,
  DescribeSpotPriceHistoryCommand,
  type _InstanceType,
} from '@aws-sdk/client-ec2';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import type {
  CostEstimateRequest,
  CostEstimateResult,
  CloudBackendType,
  AWSFargatePricing,
} from '@e/shared';
import { AWS_REFERENCE_PRICING, DEFAULT_FARGATE_PRICING } from '@e/shared';

/**
 * Cached pricing entry with TTL.
 */
interface PricingCacheEntry {
  onDemandHourly: number;
  spotHourly: number | null;
  fetchedAt: number;
}

/** Cache TTL: 1 hour for pricing data. */
const PRICING_CACHE_TTL_MS = 3_600_000;

/**
 * AWS Pricing Manager — fetches and caches instance pricing.
 *
 * Strategy:
 * 1. Try AWS Price List API for on-demand pricing
 * 2. Try EC2 Spot Price History API for spot pricing
 * 3. Fall back to reference pricing data for common instance types
 * 4. Use Fargate vCPU/memory pricing for container backend
 */
export class AWSPricingManager {
  private pricingClient: PricingClient | null = null;
  private ec2Client: EC2Client | null = null;
  private cache = new Map<string, PricingCacheEntry>();
  private fargatePricing: AWSFargatePricing = DEFAULT_FARGATE_PRICING;
  private currentRegion: string = 'us-east-1';

  /**
   * Initialize clients for a specific region.
   * Note: Pricing API is only available in us-east-1 and ap-south-1,
   * so we always use us-east-1 for the pricing client.
   */
  initialize(region: string, credentials: AwsCredentialIdentityProvider): void {
    this.currentRegion = region;

    // Pricing API is only in us-east-1 and ap-south-1
    this.pricingClient = new PricingClient({
      region: 'us-east-1',
      credentials,
    });

    // EC2 client for spot pricing (region-specific)
    this.ec2Client = new EC2Client({ region, credentials });
  }

  /**
   * Estimate the cost for a given instance configuration.
   */
  async estimateCost(request: CostEstimateRequest): Promise<CostEstimateResult> {
    if (request.backend === 'container') {
      return this.estimateFargateCost(request);
    }
    return this.estimateEC2Cost(request);
  }

  /**
   * Get the hourly rate for an EC2 instance type in a region.
   * Uses cache, then live API, then reference data.
   */
  async getEC2HourlyRate(
    instanceType: string,
    region: string,
    spot: boolean = false,
  ): Promise<number> {
    const cacheKey = `${instanceType}:${region}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.fetchedAt < PRICING_CACHE_TTL_MS) {
      return spot ? (cached.spotHourly ?? cached.onDemandHourly * 0.3) : cached.onDemandHourly;
    }

    // Try to fetch live pricing
    try {
      const entry = await this.fetchLivePricing(instanceType, region);
      if (entry) {
        this.cache.set(cacheKey, entry);
        return spot ? (entry.spotHourly ?? entry.onDemandHourly * 0.3) : entry.onDemandHourly;
      }
    } catch (err) {
      console.warn(
        `[aws-pricing] Failed to fetch live pricing for ${instanceType} in ${region}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Fall back to reference pricing
    return this.getReferencePricing(instanceType, spot);
  }

  /**
   * Get Fargate pricing for a region.
   */
  getFargatePricing(): AWSFargatePricing {
    return { ...this.fargatePricing };
  }

  // ---------------------------------------------------------------------------
  // Private: EC2 cost estimation
  // ---------------------------------------------------------------------------

  private async estimateEC2Cost(request: CostEstimateRequest): Promise<CostEstimateResult> {
    const hourlyRate = await this.getEC2HourlyRate(
      request.instanceType,
      request.region,
      false, // Use on-demand for estimates (conservative)
    );

    const spotRate = await this.getEC2HourlyRate(request.instanceType, request.region, true);

    const durationHours = request.estimatedDurationMs / 3_600_000;
    const onDemandCost = hourlyRate * durationHours;
    const spotCost = spotRate * durationHours;

    return {
      estimatedCostUsd: spotCost, // Spot is default; cheaper
      hourlyRateUsd: spotRate,
      breakdown: {
        compute_spot: spotCost,
        compute_on_demand: onDemandCost,
        storage: 0.002 * durationHours, // ~$0.002/hr for 30GB gp3
        network: 0,
      },
      currency: 'USD',
    };
  }

  // ---------------------------------------------------------------------------
  // Private: Fargate cost estimation
  // ---------------------------------------------------------------------------

  private estimateFargateCost(request: CostEstimateRequest): CostEstimateResult {
    // Parse Fargate vCPU and memory from instance type string
    // Expected format: "fargate-{cpu}vcpu-{memory}gb" or just use defaults
    const { cpu, memoryGb } = this.parseFargateSpec(request.instanceType);

    const durationHours = request.estimatedDurationMs / 3_600_000;
    const cpuCost = this.fargatePricing.cpuPerHour * cpu * durationHours;
    const memoryCost = this.fargatePricing.memoryPerGbHour * memoryGb * durationHours;
    const totalCost = cpuCost + memoryCost;
    const hourlyRate =
      this.fargatePricing.cpuPerHour * cpu + this.fargatePricing.memoryPerGbHour * memoryGb;

    return {
      estimatedCostUsd: totalCost,
      hourlyRateUsd: hourlyRate,
      breakdown: {
        compute_cpu: cpuCost,
        compute_memory: memoryCost,
        network: 0,
      },
      currency: 'USD',
    };
  }

  private parseFargateSpec(instanceType: string): { cpu: number; memoryGb: number } {
    // Try parsing "fargate-{cpu}vcpu-{mem}gb" format
    const match = instanceType.match(/fargate[- ](\d+(?:\.\d+)?)vcpu[- ](\d+(?:\.\d+)?)gb/i);
    if (match) {
      return { cpu: parseFloat(match[1]), memoryGb: parseFloat(match[2]) };
    }
    // Default Fargate spec: 1 vCPU, 2 GB
    return { cpu: 1, memoryGb: 2 };
  }

  // ---------------------------------------------------------------------------
  // Private: Live pricing fetch
  // ---------------------------------------------------------------------------

  private async fetchLivePricing(
    instanceType: string,
    region: string,
  ): Promise<PricingCacheEntry | null> {
    const onDemand = await this.fetchOnDemandPrice(instanceType, region);
    const spot = await this.fetchSpotPrice(instanceType, region);

    if (onDemand === null && spot === null) return null;

    return {
      onDemandHourly: onDemand ?? this.getReferencePricing(instanceType, false),
      spotHourly: spot,
      fetchedAt: Date.now(),
    };
  }

  /**
   * Fetch on-demand pricing from the AWS Price List API.
   */
  private async fetchOnDemandPrice(instanceType: string, region: string): Promise<number | null> {
    if (!this.pricingClient) return null;

    try {
      // Map region code to region name for the Pricing API
      const regionName = this.getRegionName(region);

      const response = await this.pricingClient.send(
        new GetProductsCommand({
          ServiceCode: 'AmazonEC2',
          Filters: [
            { Type: 'TERM_MATCH', Field: 'instanceType', Value: instanceType },
            { Type: 'TERM_MATCH', Field: 'location', Value: regionName },
            { Type: 'TERM_MATCH', Field: 'operatingSystem', Value: 'Linux' },
            { Type: 'TERM_MATCH', Field: 'preInstalledSw', Value: 'NA' },
            { Type: 'TERM_MATCH', Field: 'tenancy', Value: 'Shared' },
            { Type: 'TERM_MATCH', Field: 'capacitystatus', Value: 'Used' },
          ],
          MaxResults: 1,
        }),
      );

      const priceList = response.PriceList ?? [];
      if (priceList.length === 0) return null;

      // Parse the price from the JSON response
      const product = typeof priceList[0] === 'string' ? JSON.parse(priceList[0]) : priceList[0];

      const terms = product?.terms?.OnDemand;
      if (!terms) return null;

      // Navigate the nested pricing structure
      const firstTerm = Object.values(terms)[0] as Record<string, unknown>;
      const priceDimensions = firstTerm?.priceDimensions as Record<string, unknown> | undefined;
      if (!priceDimensions) return null;

      const firstDimension = Object.values(priceDimensions)[0] as Record<string, unknown>;
      const pricePerUnit = firstDimension?.pricePerUnit as Record<string, string> | undefined;
      const usd = pricePerUnit?.USD;

      return usd ? parseFloat(usd) : null;
    } catch (err) {
      console.warn(
        `[aws-pricing] Price List API error: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Fetch current spot price from EC2 Spot Price History API.
   */
  private async fetchSpotPrice(instanceType: string, region: string): Promise<number | null> {
    if (!this.ec2Client) return null;

    try {
      const response = await this.ec2Client.send(
        new DescribeSpotPriceHistoryCommand({
          InstanceTypes: [instanceType as _InstanceType],
          ProductDescriptions: ['Linux/UNIX'],
          MaxResults: 1,
        }),
      );

      const history = response.SpotPriceHistory ?? [];
      if (history.length === 0) return null;

      const price = history[0].SpotPrice;
      return price ? parseFloat(price) : null;
    } catch (err) {
      console.warn(
        `[aws-pricing] Spot Price API error: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Reference pricing fallback
  // ---------------------------------------------------------------------------

  private getReferencePricing(instanceType: string, spot: boolean): number {
    const ref = AWS_REFERENCE_PRICING.find((p) => p.instanceType === instanceType);
    if (ref) {
      return spot ? ref.spotHourly : ref.onDemandHourly;
    }

    // Unknown instance type — return a conservative estimate
    // based on t3.medium pricing
    const defaultRef = AWS_REFERENCE_PRICING.find((p) => p.instanceType === 't3.medium')!;
    return spot ? defaultRef.spotHourly : defaultRef.onDemandHourly;
  }

  /**
   * Map AWS region code to the region name used by the Pricing API.
   */
  private getRegionName(regionCode: string): string {
    const regionMap: Record<string, string> = {
      'us-east-1': 'US East (N. Virginia)',
      'us-east-2': 'US East (Ohio)',
      'us-west-1': 'US West (N. California)',
      'us-west-2': 'US West (Oregon)',
      'af-south-1': 'Africa (Cape Town)',
      'ap-east-1': 'Asia Pacific (Hong Kong)',
      'ap-south-1': 'Asia Pacific (Mumbai)',
      'ap-south-2': 'Asia Pacific (Hyderabad)',
      'ap-southeast-1': 'Asia Pacific (Singapore)',
      'ap-southeast-2': 'Asia Pacific (Sydney)',
      'ap-southeast-3': 'Asia Pacific (Jakarta)',
      'ap-southeast-4': 'Asia Pacific (Melbourne)',
      'ap-northeast-1': 'Asia Pacific (Tokyo)',
      'ap-northeast-2': 'Asia Pacific (Seoul)',
      'ap-northeast-3': 'Asia Pacific (Osaka)',
      'ca-central-1': 'Canada (Central)',
      'ca-west-1': 'Canada West (Calgary)',
      'eu-central-1': 'EU (Frankfurt)',
      'eu-central-2': 'EU (Zurich)',
      'eu-west-1': 'EU (Ireland)',
      'eu-west-2': 'EU (London)',
      'eu-west-3': 'EU (Paris)',
      'eu-south-1': 'EU (Milan)',
      'eu-south-2': 'EU (Spain)',
      'eu-north-1': 'EU (Stockholm)',
      'il-central-1': 'Israel (Tel Aviv)',
      'me-south-1': 'Middle East (Bahrain)',
      'me-central-1': 'Middle East (UAE)',
      'sa-east-1': 'South America (Sao Paulo)',
      'us-gov-east-1': 'AWS GovCloud (US-East)',
      'us-gov-west-1': 'AWS GovCloud (US-West)',
    };
    return regionMap[regionCode] ?? regionCode;
  }
}
