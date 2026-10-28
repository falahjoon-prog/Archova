// Public interface of @archova/mod-ai: Nova's gateway (ai/03). Feature modules call `api.runTask`; nothing else in
// the codebase talks to an AI vendor (X26).
import type { ModelTier } from '@archova/ai-prompts';
import { defineModule, type KernelServices, type TenantScope } from '@archova/kernel';
import { createAdminService } from './application/admin';
import { createAskService } from './application/ask';
import { createInductionDraftService } from './application/induction-draft';
import { createInductionQaService } from './application/induction-qa';
import { createInductionTranslationService } from './application/induction-translation';
import { createProjectIndexService, type SourceRevision } from './application/project-index';
import { createDiarySummaryService } from './application/diary-summary';
import { createRfiDraftService } from './application/rfi-draft';
import {
  createDrawingCompareService,
  type DrawingRevisionRef,
  type RfiOnDrawing,
} from './application/drawing-compare';
import { createDrawingRegisterService, type ReadableFile } from './application/drawing-register';
import { createGateway } from './application/gateway';
import { aiRoutes } from './api/routes';
import type { ModelProvider } from './domain/provider';
import {
  DEFAULT_EMBEDDING_PRICE,
  DEFAULT_PRICES,
  type ModelPrice,
  type RoutingTable,
} from './domain/routing';
import type { SimilarRfi } from './domain/rfi-draft';
import type { TranslationLanguage } from './domain/translation';
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
export {
  ProviderError,
  type ModelProvider,
  type ModelRequest,
  type OcrLine,
  type OcrRequest,
  type OcrResponse,
} from './domain/provider';
export {
  DEFAULT_FAKE_RESPONDERS,
  createFakeProvider,
  fakeEmbedding,
  type FakeOcrResponder,
  type FakeProvider,
  type FakeResponder,
  type ProviderConfig,
} from './infra/providers';
export type { TaskRun, RunOptions, Gateway } from './application/gateway';
export type { ReadableFile, SheetSuggestionPayload } from './application/drawing-register';
export type { AskAnswer, AnswerSource } from './application/ask';
export type { IndexReport, SourceRevision } from './application/project-index';
export type { InductionDraftPayload } from './application/induction-draft';
export type { DiarySummaryPayload } from './application/diary-summary';
export type { RfiDraft } from './application/rfi-draft';
export type {
  DrawingCompare,
  DrawingComparePayload,
  DrawingRevisionRef,
  RfiOnDrawing,
} from './application/drawing-compare';
export {
  diffSheets,
  reviewCompare,
  sheetLines,
  type SheetChange,
  type SheetLine,
} from './domain/drawing-compare';
export {
  reviewRfiDraft,
  similarityPhrases,
  suggestAssignees,
  type ReviewedRfiDraft,
  type SimilarRfi,
} from './domain/rfi-draft';
export {
  diaryFacts,
  reviewDiarySummary,
  type DiaryDayForSummary,
  type ReviewedSummary,
  type SummarySource,
} from './domain/diary-summary';
export type {
  InductionTranslation,
  TranslatedQuestion,
  TranslatedSlide,
} from './application/induction-translation';
export {
  TRANSLATION_LANGUAGES,
  protectText,
  restoreText,
  type Glossary,
  type TranslationLanguage,
} from './domain/translation';
export {
  INDUCTION_ASK_SUPERVISOR,
  type InductionAnswer,
  type InductionVersionContent,
} from './application/induction-qa';
export { INDUCTION_FIXED_TEXT, reviewInductionDraft } from './domain/induction';
export {
  chunkPages,
  keywordQuery,
  reciprocalRankFusion,
  PIPELINE_VERSION,
} from './domain/retrieval';
export {
  compareRevisions,
  matchToRegister,
  reviewTitleBlock,
  selectTitleBlockText,
  type TextItem,
} from './domain/titleblock';

export interface AiConfig {
  provider: ProviderConfig;
  /** Model id per tier. Prices default to ai/02 §4 list prices. */
  models: Readonly<Record<ModelTier, string>>;
  prices?: Partial<Record<ModelTier, ModelPrice>>;
  /** Embedding model for Ask Nova retrieval (1024 dimensions). Defaults to the fake one. */
  embedding?: { model: string; pricePerMTok?: number };
}

/** Embedding model id the fake provider reports. */
export const FAKE_EMBEDDING_MODEL = 'fake-embed';

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
    /** files.readFileBytes: the caller's read check applies. */
    readFile: (scope: TenantScope, fileId: string, maxBytes: number) => Promise<ReadableFile>;
    /** access.assert */
    assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
    /** documents.api.aiSources: what to index, with access scopes. */
    sources: (scope: TenantScope, projectId: string) => Promise<SourceRevision[]>;
    /** documents.api.aiAccessScopes: what the caller may retrieve. */
    accessScopes: (scope: TenantScope, projectId: string) => Promise<string[]>;
    /** rfis.api.findSimilar: RFIs the caller can see on the same subject (F3). */
    similarRfis: (
      scope: TenantScope,
      projectId: string,
      input: { phrases: string[]; limit: number },
    ) => Promise<SimilarRfi[]>;
    /** documents.api.getDrawingRevision and getPreviousDrawingRevision (F21). */
    getDrawingRevision: (
      scope: TenantScope,
      projectId: string,
      id: string,
    ) => Promise<DrawingRevisionRef>;
    getPreviousDrawingRevision: (
      scope: TenantScope,
      projectId: string,
      id: string,
    ) => Promise<DrawingRevisionRef | null>;
    /** documents.api.getMarkup: a markup the caller may see (F3 from a markup). */
    getMarkup: (
      scope: TenantScope,
      projectId: string,
      revisionId: string,
      markupId: string,
    ) => Promise<{ shapes: unknown }>;
    /** rfis.api.openOnDrawing: open RFIs the caller can see pinned to these revisions (F21). */
    openRfisOnDrawing: (
      scope: TenantScope,
      projectId: string,
      revisionIds: string[],
    ) => Promise<RfiOnDrawing[]>;
    /** Tests pass a fake provider directly. */
    provider?: ModelProvider;
    /** Tests pass an enabled test language; defaults to TRANSLATION_LANGUAGES. */
    translationLanguages?: readonly TranslationLanguage[];
  },
) {
  const provider = deps.provider ?? createProvider(deps.config.provider);
  const gateway = createGateway({
    database: services.database,
    provider,
    routing: buildRoutingTable(deps.config.models, deps.config.prices),
    embedding: {
      model: deps.config.embedding?.model ?? FAKE_EMBEDDING_MODEL,
      pricePerMTok: deps.config.embedding?.pricePerMTok ?? DEFAULT_EMBEDDING_PRICE,
    },
    redis: services.redis,
    logger: services.logger,
    orgTimeZone: deps.orgTimeZone,
  });
  const admin = createAdminService({ orgTimeZone: deps.orgTimeZone });
  const drawingRegister = createDrawingRegisterService({
    database: services.database,
    gateway,
    readFile: deps.readFile,
    assert: deps.assert,
  });
  const askService = createAskService({
    database: services.database,
    gateway,
    assert: deps.assert,
    accessScopes: deps.accessScopes,
  });
  const projectIndex = createProjectIndexService({
    database: services.database,
    gateway,
    readFile: deps.readFile,
    assert: deps.assert,
    sources: deps.sources,
  });
  const inductionDrafts = createInductionDraftService({
    database: services.database,
    gateway,
    assert: deps.assert,
    accessScopes: deps.accessScopes,
  });
  const rfiDrafts = createRfiDraftService({
    database: services.database,
    gateway,
    assert: deps.assert,
    accessScopes: deps.accessScopes,
    similarRfis: deps.similarRfis,
    readFile: deps.readFile,
    getRevision: deps.getDrawingRevision,
    getMarkup: deps.getMarkup,
  });
  const drawingCompare = createDrawingCompareService({
    database: services.database,
    gateway,
    assert: deps.assert,
    readFile: deps.readFile,
    getRevision: deps.getDrawingRevision,
    getPreviousRevision: deps.getPreviousDrawingRevision,
    openRfisOnDrawing: deps.openRfisOnDrawing,
  });
  const diarySummary = createDiarySummaryService({ database: services.database, gateway });
  const inductionQa = createInductionQaService({ database: services.database, gateway });
  const inductionTranslation = createInductionTranslationService({
    database: services.database,
    gateway,
    ...(deps.translationLanguages ? { languages: deps.translationLanguages } : {}),
  });
  return {
    definition: defineModule({ name: 'ai', permissions: AI_PERMISSIONS }),
    routes: aiRoutes(
      services.database,
      admin,
      drawingRegister,
      askService,
      projectIndex,
      inductionDrafts,
      rfiDrafts,
      drawingCompare,
    ),
    permissions: AI_PERMISSIONS,
    provider,
    api: {
      runTask: gateway.runTask,
      getSettings: admin.getSettings,
      extractDrawingRegister: drawingRegister.extract,
      ask: askService.ask,
      indexProject: projectIndex.indexProject,
      draftInduction: inductionDrafts.draft,
      /** F3: an RFI subject, question and references from a typed note; nothing is saved. */
      draftRfi: rfiDrafts.draft,
      /** F21: what changed on a drawing revision since the one it superseded, with the open RFIs it affects. */
      compareDrawingRevision: drawingCompare.compare,
      /** F4: a draft summary of one diary day, from `diary.api.dayForSummary` (cached per entry version). */
      summariseDiaryDay: diarySummary.summariseDay,
      /** For `workforce`: index a published induction version for worker Q&A (ai/12 §2 I3). */
      indexInductionVersion: inductionQa.indexVersion,
      /** For `workforce`'s worker route, after the access link check: answer from that version only. */
      askInduction: inductionQa.ask,
      /** For `workforce`'s worker route: the version in the worker's language, cached (ai/12 §2 I4). */
      translateInduction: inductionTranslation.translate,
      /** Languages a worker may pick: only reviewed ones whose eval passes. */
      translationLanguages: inductionTranslation.availableLanguages,
    },
  };
}

export type AiModule = ReturnType<typeof createAiModule>;
export type AiApi = AiModule['api'];
