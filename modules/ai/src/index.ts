// Public interface of @archova/mod-ai: Nova's gateway (ai/03). Feature modules call `api.runTask`; nothing else in
// the codebase talks to an AI vendor (X26).
import type { ModelTier, QuoteScopeLine } from '@archova/ai-prompts';
import { defineModule, type KernelServices, type TenantScope } from '@archova/kernel';
import { createAdminService } from './application/admin';
import { createAskService } from './application/ask';
import { createSemanticSearchService } from './application/semantic-search';
import { createInductionDraftService } from './application/induction-draft';
import { createInductionQaService } from './application/induction-qa';
import { createInductionTranslationService } from './application/induction-translation';
import { createProjectIndexService, type SourceRevision } from './application/project-index';
import type { DefectSource } from './domain/defect-source';
import type { DiarySource } from './domain/diary-source';
import type { RfiSource } from './domain/rfi-source';
import { createDiarySummaryService } from './application/diary-summary';
import { createDiaryWeeklyService } from './application/diary-weekly';
import type { DiaryDayForSummary } from './domain/diary-summary';
import { createRfiDraftService } from './application/rfi-draft';
import { createDefectTagService } from './application/defect-tag';
import { createImportMappingService } from './application/import-mapping';
import { createQuoteReadService } from './application/quote-read';
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
import type { NearbyDefect, ProjectCompany } from './domain/defect-tag';
import type { TranslationLanguage } from './domain/translation';
import type { Raster as VisualRaster } from './domain/visual-diff';
import { createProvider } from './infra/providers';
import { FAKE_EMBEDDING_MODEL, type AiConfig } from './config';
import { AI_PERMISSIONS } from './permissions';

export { AI_PERMISSIONS } from './permissions';
export { FAKE_EMBEDDING_MODEL, FAKE_MODELS, loadAiConfig, type AiConfig } from './config';
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
export type { SearchResult } from './application/semantic-search';
export type { IndexReport, SourceRevision } from './application/project-index';
export type { DefectSource } from './domain/defect-source';
export { RECORD_EVENT_TYPES, recordKindOf, type RecordKind } from './domain/record-events';
export type { DiarySource } from './domain/diary-source';
export type { RfiSource } from './domain/rfi-source';
export type { InductionDraftPayload } from './application/induction-draft';
export type { DiarySummaryPayload } from './application/diary-summary';
export type { DiaryWeeklyPayload } from './application/diary-weekly';
export { compareVisually } from './application/visual-compare';
export type {
  VisualComparePayload,
  VisualCompareRequest,
  VisualCompareResult,
} from './application/visual-compare';
export type { DescribedRegion } from './domain/visual-compare';
export type { VisualRaster };
/** Renders one PDF page as greyscale (the whole page, longer side 2,000 px) for the linework compare. */
export type RasterizePage = (file: ReadableFile, pageIndex: number) => Promise<VisualRaster>;
export type { RfiDraft } from './application/rfi-draft';
export type { DefectTagSuggestion } from './application/defect-tag';
export type { ImportMappingSuggestion } from './application/import-mapping';
export type { QuoteReading } from './application/quote-read';
export type { NearbyDefect, ProjectCompany } from './domain/defect-tag';
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
    /** access.can: like `assert`, but answers instead of throwing (who may see a suggestion). */
    can: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<boolean>;
    /** documents.api.aiSources: what to index, with access scopes. */
    sources: (scope: TenantScope, projectId: string) => Promise<SourceRevision[]>;
    /** documents.api.aiAccessScopes: what the caller may retrieve. */
    accessScopes: (scope: TenantScope, projectId: string) => Promise<string[]>;
    /** rfis.api.aiSources: sent RFIs with their responses, to index for Ask. */
    rfiSources: (scope: TenantScope, projectId: string, only?: string) => Promise<RfiSource[]>;
    /** rfis.api.aiAccessScopes: the Ask scopes the caller holds for RFIs. */
    rfiAccessScopes: (scope: TenantScope, projectId: string) => Promise<string[]>;
    /** defects.api.aiSources: issued defects with the notes on their history, to index for Ask. */
    defectSources: (
      scope: TenantScope,
      projectId: string,
      only?: string,
    ) => Promise<DefectSource[]>;
    /** defects.api.aiAccessScopes: the Ask scopes the caller holds for defects. */
    defectAccessScopes: (scope: TenantScope, projectId: string) => Promise<string[]>;
    /** diary.api.aiSources: submitted and signed-off days with all their lines, to index for Ask. */
    diarySources: (scope: TenantScope, projectId: string, only?: string) => Promise<DiarySource[]>;
    /** diary.api.aiAccessScopes: the Ask scopes the caller holds for the diary. */
    diaryAccessScopes: (scope: TenantScope, projectId: string) => Promise<string[]>;
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
    /** diary.api.dayForSummary: one diary day as the caller may read it, or null (F4). */
    dayForSummary: (
      scope: TenantScope,
      projectId: string,
      date: string,
    ) => Promise<DiaryDayForSummary | null>;
    /** platform.api.projectCompaniesWithTrades: who works on the project and the trades they list (F5). */
    projectCompanies: (scope: TenantScope, projectId: string) => Promise<ProjectCompany[]>;
    /** defects.api.openNear: open defects the caller can see pinned near a spot on a revision (F5). */
    openDefectsNear: (
      scope: TenantScope,
      projectId: string,
      input: { drawingRevisionId: string; x: number; y: number; radius: number },
    ) => Promise<NearbyDefect[]>;
    /** estimating.api.scopeForQuoteReading: a tender package's trade and scope lines, when it is taking quotes (F22). */
    quotePackage: (
      scope: TenantScope,
      projectId: string,
      packageId: string,
    ) => Promise<{ id: string; trade: string; scope: QuoteScopeLine[] }>;
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
    /**
     * Renders a PDF page as greyscale for the linework half of revision compare (F21): the whole page, longer side
     * 2,000 px. Only the AI worker image has a native canvas; unset in the API image, where compare stays text-only.
     */
    rasterizePage?: RasterizePage;
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
    can: deps.can,
  });
  // Ask and search retrieve documents, drawings and (builder staff only) RFIs, defects and the site diary; drafting
  // RFIs and inductions stays on documents.
  const askScopes = async (scope: TenantScope, projectId: string) => [
    ...(await deps.accessScopes(scope, projectId)),
    ...(await deps.rfiAccessScopes(scope, projectId)),
    ...(await deps.defectAccessScopes(scope, projectId)),
    ...(await deps.diaryAccessScopes(scope, projectId)),
  ];
  const askService = createAskService({
    database: services.database,
    gateway,
    assert: deps.assert,
    accessScopes: askScopes,
  });
  const semanticSearch = createSemanticSearchService({
    database: services.database,
    gateway,
    assert: deps.assert,
    accessScopes: askScopes,
  });
  const projectIndex = createProjectIndexService({
    database: services.database,
    gateway,
    readFile: deps.readFile,
    assert: deps.assert,
    sources: deps.sources,
    rfiSources: deps.rfiSources,
    defectSources: deps.defectSources,
    diarySources: deps.diarySources,
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
  const defectTags = createDefectTagService({
    database: services.database,
    gateway,
    assert: deps.assert,
    readFile: deps.readFile,
    getRevision: deps.getDrawingRevision,
    projectCompanies: deps.projectCompanies,
    openDefectsNear: deps.openDefectsNear,
  });
  const importMappings = createImportMappingService({
    database: services.database,
    gateway,
    assert: deps.assert,
  });
  const quoteReads = createQuoteReadService({
    database: services.database,
    gateway,
    assert: deps.assert,
    readFile: deps.readFile,
    quotePackage: deps.quotePackage,
  });
  const drawingCompare = createDrawingCompareService({
    database: services.database,
    gateway,
    assert: deps.assert,
    readFile: deps.readFile,
    getRevision: deps.getDrawingRevision,
    getPreviousRevision: deps.getPreviousDrawingRevision,
    openRfisOnDrawing: deps.openRfisOnDrawing,
    ...(deps.rasterizePage ? { rasterizePage: deps.rasterizePage } : {}),
  });
  const diarySummary = createDiarySummaryService({
    database: services.database,
    gateway,
    dayForSummary: deps.dayForSummary,
  });
  const diaryWeekly = createDiaryWeeklyService({
    database: services.database,
    gateway,
    dayForSummary: deps.dayForSummary,
  });
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
      semanticSearch,
      projectIndex,
      inductionDrafts,
      rfiDrafts,
      drawingCompare,
      diarySummary,
      diaryWeekly,
      defectTags,
      importMappings,
      quoteReads,
    ),
    permissions: AI_PERMISSIONS,
    provider,
    api: {
      runTask: gateway.runTask,
      getSettings: admin.getSettings,
      extractDrawingRegister: drawingRegister.extract,
      ask: askService.ask,
      /** F6: the passages matching a few words by meaning or keyword, within the caller's access; no model call. */
      searchProject: semanticSearch.search,
      indexProject: projectIndex.indexProject,
      /**
       * For background processes (the ai-worker): bring one RFI, defect or diary day in step with the register after it
       * changed. Checks no permission; the caller builds the context (backend 08 §2).
       */
      reindexRecord: projectIndex.reindexRecord,
      draftInduction: inductionDrafts.draft,
      /** F3: an RFI subject, question and references from a typed note; nothing is saved. */
      draftRfi: rfiDrafts.draft,
      /** F5: a title, trade, priority and assignee companies from a defect photo and its pin; nothing is saved. */
      tagDefect: defectTags.tag,
      /** F31: which field each column of an import file fills, and what its status values mean; nothing is imported. */
      suggestImportMapping: importMappings.suggest,
      /** F22: a subcontractor's PDF quote read into lines, exclusions and qualifications; no quote is saved. */
      readQuote: quoteReads.read,
      /** F21: what changed on a drawing revision since the one it superseded, with the open RFIs it affects. */
      compareDrawingRevision: drawingCompare.compare,
      /** F4: a draft summary of one diary day, from `diary.api.dayForSummary` (cached per entry version). */
      summariseDiaryDay: diarySummary.summariseDay,
      summariseDiaryWeek: diaryWeekly.summariseWeek,
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
