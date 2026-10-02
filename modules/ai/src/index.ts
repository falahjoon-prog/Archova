// Public interface of @archova/mod-ai: Nova's gateway (ai/03). Feature modules call `api.runTask`; nothing else in
// the codebase talks to an AI vendor (X26).
import type { ModelTier } from '@archova/ai-prompts';
import { defineModule, type KernelServices, type TenantScope } from '@archova/kernel';
import { createAdminService } from './application/admin';
import { createGateway } from './application/gateway';
import { aiRoutes } from './api/routes';
import type { ModelProvider } from './domain/provider';
import { DEFAULT_PRICES, type ModelPrice, type RoutingTable } from './domain/routing';
import { createProvider, type ProviderConfig } from './infra/providers';
import { AI_PERMISSIONS } from './permissions';

export { AI_PERMISSIONS } from './permissions';
export { TASK_CREDITS, decideBudget, effectiveAllowance } from './domain/credits';
export { checkCitations, type CheckedCitation } from './domain/citations';
export {
  AU_REGIONS,
  DEFAULT_PRICES,
  assertAustralianModelId,
  costMicros,
  isAustralianRegion,
  type ModelPrice,
  type RoutingTable,
} from './domain/routing';
export { ProviderError, type ModelProvider, type ModelRequest } from './domain/provider';
export {
  createFakeProvider,
  fakeEmbedding,
  type FakeProvider,
  type FakeResponder,
  type ProviderConfig,
} from './infra/providers';
export type { TaskRun, RunOptions, Gateway } from './application/gateway';

export interface AiConfig {
  provider: ProviderConfig;
  /** Model id per tier. Prices default to ai/02 §4 list prices. */
  models: Readonly<Record<ModelTier, string>>;
  prices?: Partial<Record<ModelTier, ModelPrice>>;
}

/** Model ids the fake provider reports; any id works with it. */
export const FAKE_MODELS: Readonly<Record<ModelTier, string>> = {
  fast: 'fake-fast',
  standard: 'fake-standard',
  advanced: 'fake-advanced',
};

export function buildRoutingTable(
  models: Readonly<Record<ModelTier, string>>,
  prices: Partial<Record<ModelTier, ModelPrice>> = {},
): RoutingTable {
  return {
    fast: { model: models.fast, price: prices.fast ?? DEFAULT_PRICES.fast },
    standard: { model: models.standard, price: prices.standard ?? DEFAULT_PRICES.standard },
    advanced: { model: models.advanced, price: prices.advanced ?? DEFAULT_PRICES.advanced },
  };
}

export function createAiModule(
  services: KernelServices,
  deps: {
    config: AiConfig;
    /** The org's IANA zone (X34), from `platform`. */
    orgTimeZone: (scope: TenantScope) => Promise<string>;
    /** Tests pass a fake provider directly. */
    provider?: ModelProvider;
  },
) {
  const provider = deps.provider ?? createProvider(deps.config.provider);
  const gateway = createGateway({
    database: services.database,
    provider,
    routing: buildRoutingTable(deps.config.models, deps.config.prices),
    redis: services.redis,
    logger: services.logger,
    orgTimeZone: deps.orgTimeZone,
  });
  const admin = createAdminService({ orgTimeZone: deps.orgTimeZone });
  return {
    definition: defineModule({ name: 'ai', permissions: AI_PERMISSIONS }),
    routes: aiRoutes(services.database, admin),
    permissions: AI_PERMISSIONS,
    provider,
    api: { runTask: gateway.runTask, getSettings: admin.getSettings },
  };
}

export type AiModule = ReturnType<typeof createAiModule>;
export type AiApi = AiModule['api'];
