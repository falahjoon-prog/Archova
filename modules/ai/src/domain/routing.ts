// Routing table: task tier → model, with prices for cost accounting (ai/02 §4, ai/05 §1).
// Versioned here, overridable per environment by config; swapping a model is a config change plus an eval run.
import type { ModelTier } from '@archova/ai-prompts';
import type { ModelUsage } from './provider';

/** US dollars per million tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelRoute {
  model: string;
  price: ModelPrice;
}

export type RoutingTable = Readonly<Record<ModelTier, ModelRoute>>;

/** The embedding model and its price in US dollars per million input tokens. */
export interface EmbeddingRoute {
  model: string;
  pricePerMTok: number;
}

/** Titan Text Embeddings V2 list price (ai/02 §6); confirm the Sydney price with the model id. */
export const DEFAULT_EMBEDDING_PRICE = 0.02;

/**
 * First-party list prices from ai/02 §4 (late Sept 2026). Bedrock AU prices must be confirmed before budgets are
 * final (ai/02 §3); set them per environment with the model ids.
 */
export const DEFAULT_PRICES: Readonly<Record<ModelTier, ModelPrice>> = {
  fast: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  standard: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  advanced: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

/**
 * When the primary tier is unavailable or rate limited after one retry, interactive work falls back
 * (ai/02 §4, ai/05 §4 "degrade, don't fail"). Background work waits instead.
 */
export const FALLBACK_TIER: Readonly<Record<ModelTier, ModelTier | null>> = {
  fast: null,
  standard: 'fast',
  advanced: 'standard',
};

/** Cost of one call in US micro-dollars: tokens × $/MTok is exactly micro-dollars. */
export function costMicros(usage: ModelUsage, price: ModelPrice): number {
  return Math.round(
    usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead +
      usage.cacheWriteTokens * price.cacheWrite,
  );
}

/** AWS regions in Australia: Sydney and Melbourne (X25). */
export const AU_REGIONS = ['ap-southeast-2', 'ap-southeast-4'] as const;

export function isAustralianRegion(region: string): boolean {
  return (AU_REGIONS as readonly string[]).includes(region);
}

/**
 * Bedrock cross-region inference profiles route by geography prefix. Only `au.` stays in Australia; `apac.`,
 * `us.`, `eu.` and `global.` can process data offshore, so they are refused (X25). Bare model ids run in the
 * client's own (Australian) region.
 */
export function assertAustralianModelId(modelId: string): void {
  const parts = modelId.split('.');
  const prefix = parts.length >= 3 ? parts[0] : null;
  if (prefix && prefix !== 'au') {
    throw new Error(
      `Model ${modelId} uses the "${prefix}." inference profile, which can process data outside Australia (X25). Use an "au." profile or an in-region model id.`,
    );
  }
}
