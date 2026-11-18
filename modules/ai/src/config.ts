// Nova's settings, read from the environment by every process that runs the module (the api and the ai-worker), so
// one set of variables configures both. The names keep their API_AI_ prefix for that reason.
import type { ModelTier } from '@archova/ai-prompts';
import { assertAustralianModelId, isAustralianRegion, type ModelPrice } from './domain/routing';
import type { ProviderConfig } from './infra/providers';

export interface AiConfig {
  provider: ProviderConfig;
  /** Model id per tier. Prices default to ai/02 §4 list prices. */
  models: Readonly<Record<ModelTier, string>>;
  prices?: Partial<Record<ModelTier, ModelPrice>>;
  /** Embedding model for Ask Nova retrieval (1024 dimensions). Defaults to the fake one. */
  embedding?: { model: string; pricePerMTok?: number };
  /** Tokens of documents and records one org may have embedded in a local day (ai/05 §4). Unset means the default. */
  embedDailyTokens?: number;
  /** Scanned pages one org may have read with OCR in a local day (ai/05 §4). Unset means the default. */
  ocrDailyPages?: number;
  /** SWMS drafting (F20). Off until Grace and the WHS lawyer clear it for pilots (compliance/08 §9). */
  swmsDrafts?: boolean;
}

/** Embedding model id the fake provider reports. */
export const FAKE_EMBEDDING_MODEL = 'fake-embed';

/** Model ids the fake provider reports; any id works with it. */
export const FAKE_MODELS: Readonly<Record<ModelTier, string>> = {
  fast: 'fake-fast',
  standard: 'fake-standard',
  advanced: 'fake-advanced',
};

const TIERS = ['fast', 'standard', 'advanced'] as const;

function url(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const v = env[key];
  if (!v) return undefined;
  try {
    new URL(v);
  } catch {
    throw new Error(`${key} must be a URL`);
  }
  return v;
}

function wholeNumber(env: NodeJS.ProcessEnv, key: string): number | undefined {
  const v = env[key];
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${key} must be a whole number above 0`);
  return n;
}

/**
 * The fake provider unless `API_AI_PROVIDER=bedrock`. Bedrock needs a model id for each tier, an Australian region
 * and Australian model ids (X25); anything else stops the process at start rather than at the first call.
 */
export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const kind = env.API_AI_PROVIDER ?? 'fake';
  if (kind !== 'fake' && kind !== 'bedrock')
    throw new Error(`API_AI_PROVIDER must be fake or bedrock, not ${kind}`);
  const embedDailyTokens = wholeNumber(env, 'API_AI_EMBED_DAILY_TOKENS');
  const ocrDailyPages = wholeNumber(env, 'API_AI_OCR_DAILY_PAGES');
  const swmsDrafts = ['1', 'true', 'on'].includes((env.API_AI_SWMS_DRAFTS ?? '').toLowerCase());
  const cap = {
    ...(swmsDrafts ? { swmsDrafts } : {}),
    ...(embedDailyTokens === undefined ? {} : { embedDailyTokens }),
    ...(ocrDailyPages === undefined ? {} : { ocrDailyPages }),
  };
  if (kind === 'fake') return { provider: { kind: 'fake' }, models: FAKE_MODELS, ...cap };

  const region = env.API_AI_REGION || 'ap-southeast-2';
  const endpoint = url(env, 'API_AI_BEDROCK_ENDPOINT');
  const ocrEndpoint = url(env, 'API_AI_TEXTRACT_ENDPOINT');
  const models: Record<ModelTier, string> = {
    fast: env.API_AI_MODEL_FAST ?? '',
    standard: env.API_AI_MODEL_STANDARD ?? '',
    advanced: env.API_AI_MODEL_ADVANCED ?? '',
  };
  const embeddingModel = env.API_AI_MODEL_EMBEDDING || 'amazon.titan-embed-text-v2:0';

  const unset = TIERS.filter((t) => !models[t]);
  if (unset.length)
    throw new Error(
      `API_AI_PROVIDER=bedrock needs model ids for: ${unset.map((t) => `API_AI_MODEL_${t.toUpperCase()}`).join(', ')}`,
    );
  if (!isAustralianRegion(region))
    throw new Error(`API_AI_REGION must be an Australian region (X25), not ${region}`);
  for (const t of TIERS) assertAustralianModelId(models[t]);
  assertAustralianModelId(embeddingModel);

  return {
    provider: {
      kind: 'bedrock',
      region,
      ...(endpoint ? { endpoint } : {}),
      ...(ocrEndpoint ? { ocrEndpoint } : {}),
    },
    models,
    embedding: { model: embeddingModel },
    ...cap,
  };
}
