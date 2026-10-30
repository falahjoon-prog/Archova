// Composition root: the list of modules this app loads (backend 01 §2). Adding a module means adding it here.
import type { Database, KernelServices, MessageSender, RouteTable } from '@archova/kernel';
import {
  AI_PERMISSIONS,
  createAiModule,
  type AiConfig,
  type ModelProvider,
  type RasterizePage,
} from '@archova/mod-ai';
import { createAccessModule } from '@archova/mod-access';
import {
  TRIAL_ENTITLEMENTS,
  createBillingModule,
  type EntitlementProvider,
} from '@archova/mod-billing';
import { createBackofficeModule, type BackofficeConfig } from '@archova/mod-backoffice';
import { DEFECTS_PERMISSIONS, createDefectsModule } from '@archova/mod-defects';
import { ESTIMATING_PERMISSIONS, createEstimatingModule } from '@archova/mod-estimating';
import { INTEGRATIONS_PERMISSIONS, createIntegrationsModule } from '@archova/mod-integrations';
import { DIARY_PERMISSIONS, createDiaryModule, type DiaryApi } from '@archova/mod-diary';
import { DOCUMENTS_PERMISSIONS, createDocumentsModule } from '@archova/mod-documents';
import {
  createFilesModule,
  createMemoryTileUrls,
  type MalwareScanner,
  type ObjectStore,
  type TileUrls,
} from '@archova/mod-files';
import { createIdentityModule, type IdentityConfig } from '@archova/mod-identity';
import { createPlatformModule } from '@archova/mod-platform';
import { WORKFORCE_PERMISSIONS, createWorkforceModule } from '@archova/mod-workforce';
import { RFIS_PERMISSIONS, createRfisModule } from '@archova/mod-rfis';
import { SYNC_PERMISSIONS, createSyncModule } from '@archova/mod-sync';

/** Permission keys declared by feature modules, registered with `access` next to the foundation keys. */
export const MODULE_PERMISSIONS = [
  AI_PERMISSIONS,
  DOCUMENTS_PERMISSIONS,
  RFIS_PERMISSIONS,
  DEFECTS_PERMISSIONS,
  ESTIMATING_PERMISSIONS,
  INTEGRATIONS_PERMISSIONS,
  DIARY_PERMISSIONS,
  WORKFORCE_PERMISSIONS,
  SYNC_PERMISSIONS,
];

export interface ModuleOptions {
  identity: IdentityConfig;
  files: { store: ObjectStore; scanner: MalwareScanner; tiles?: TileUrls };
  entitlements?: EntitlementProvider;
  ai: { config: AiConfig; provider?: ModelProvider; rasterizePage?: RasterizePage };
  /** One-time codes for access links (X45). */
  messages: MessageSender;
  /** The web origin access links point at. */
  linkBaseUrl: string;
  backoffice: BackofficeConfig;
}

export async function loadModules(services: KernelServices, opts: ModuleOptions) {
  const identity = await createIdentityModule(services, opts.identity);
  const billing = createBillingModule(
    services,
    opts.entitlements ? { entitlements: opts.entitlements } : {},
  );
  const backoffice = createBackofficeModule(services, {
    catalogue: billing.api.catalogue,
    config: opts.backoffice,
  });
  // access ↔ platform reference each other's public interfaces; resolve lazily.
  let access: ReturnType<typeof createAccessModule> | null = null;
  const platform = createPlatformModule(services, {
    identity: identity.api,
    access: () => access!.api,
    defaultEntitlements: TRIAL_ENTITLEMENTS,
    onOrgCreated: (scope, org, entitlements) =>
      backoffice.api.directory.upsert(scope.tx, {
        id: org.id,
        name: org.name,
        slug: org.slug,
        planCode: entitlements.plan,
        state: entitlements.state,
      }),
  });
  access = createAccessModule(services, {
    lookupProjectMember: (scope, projectId, userId) =>
      platform.api.getProjectMembership(scope, projectId, userId),
    extraPermissions: MODULE_PERMISSIONS,
  });
  const files = createFilesModule(services, {
    access: access.api,
    store: opts.files.store,
    scanner: opts.files.scanner,
    tiles: opts.files.tiles ?? createMemoryTileUrls(),
    uploadPermissions: {
      // Anyone who can sign in on a project can upload their own white card and licence photos.
      workforce: 'workforce.attendance.sign_in_self',
      // The assigned subcontractor's "after" photo when marking a defect ready for review (DEF-AC5).
      defects: 'defects.defects.respond',
      // A subcontractor attaches their quote PDF to a tender package they were invited to.
      estimating: 'estimating.quotes.submit',
    },
  });

  const documents = createDocumentsModule(services, {
    access: access.api,
    platform: platform.api,
    files: files.api,
    identity: identity.api,
  });

  const rfis = createRfisModule(services, {
    access: access.api,
    platform: platform.api,
    documents: documents.api,
    files: files.api,
  });

  const defects = createDefectsModule(services, {
    access: access.api,
    platform: platform.api,
    documents: documents.api,
    files: files.api,
  });

  // diary is created after ai (it doesn't need ai); the summary route reads the day through it lazily.
  let diaryApi: DiaryApi | null = null;
  const estimating = createEstimatingModule(services, {
    access: access.api,
    platform: platform.api,
    documents: documents.api,
    files: files.api,
  });

  const integrations = createIntegrationsModule(services, {
    platform: platform.api,
    files: files.api,
  });

  const ai = createAiModule(services, {
    config: opts.ai.config,
    orgTimeZone: async (scope) => (await platform.api.getOrg(scope)).timezone,
    readFile: (scope, fileId, maxBytes) => files.api.readFileBytes(scope, fileId, maxBytes),
    assert: async (scope, key, target) => {
      await access!.api.assert(scope, key, target);
    },
    can: (scope, key, target) => access!.api.can(scope, key, target),
    sources: (scope, projectId, only) => documents.api.aiSources(scope, projectId, only),
    accessScopes: (scope, projectId) => documents.api.aiAccessScopes(scope, projectId),
    rfiSources: (scope, projectId, only) => rfis.api.aiSources(scope, projectId, only),
    rfiAccessScopes: (scope, projectId) => rfis.api.aiAccessScopes(scope, projectId),
    defectSources: (scope, projectId, only) => defects.api.aiSources(scope, projectId, only),
    defectAccessScopes: (scope, projectId) => defects.api.aiAccessScopes(scope, projectId),
    diarySources: (scope, projectId, only) => diaryApi!.aiSources(scope, projectId, only),
    diaryAccessScopes: (scope, projectId) => diaryApi!.aiAccessScopes(scope, projectId),
    similarRfis: (scope, projectId, input) => rfis.api.findSimilar(scope, projectId, input),
    getDrawingRevision: (scope, projectId, id) =>
      documents.api.getDrawingRevision(scope, projectId, id),
    getPreviousDrawingRevision: (scope, projectId, id) =>
      documents.api.getPreviousDrawingRevision(scope, projectId, id),
    getMarkup: (scope, projectId, revisionId, markupId) =>
      documents.api.getMarkup(scope, projectId, revisionId, markupId),
    openRfisOnDrawing: (scope, projectId, ids) => rfis.api.openOnDrawing(scope, projectId, ids),
    projectCompanies: (scope, projectId) =>
      platform.api.projectCompaniesWithTrades(scope, projectId),
    openDefectsNear: (scope, projectId, input) => defects.api.openNear(scope, projectId, input),
    quotePackage: (scope, projectId, packageId) =>
      estimating.api.scopeForQuoteReading(scope, projectId, packageId),
    dayForSummary: (scope, projectId, date) => diaryApi!.dayForSummary(scope, projectId, date),
    ...(opts.ai.provider ? { provider: opts.ai.provider } : {}),
    ...(opts.ai.rasterizePage ? { rasterizePage: opts.ai.rasterizePage } : {}),
  });

  const diary = createDiaryModule(services, {
    access: access.api,
    platform: platform.api,
    files: files.api,
  });

  diaryApi = diary.api;

  const workforce = createWorkforceModule(services, {
    access: access.api,
    platform: platform.api,
    identity: identity.api,
    files: files.api,
    documents: documents.api,
    hooks: { onVersionPublished: (ctx, content) => ai.api.indexInductionVersion(ctx, content) },
    links: {
      access: access.api,
      platform: platform.api,
      files: files.api,
      entitlements: billing.api.entitlements.forOrg,
      messages: opts.messages,
      ai: {
        askInduction: ai.api.askInduction,
        translateInduction: ai.api.translateInduction,
        translationLanguages: ai.api.translationLanguages,
      },
      baseUrl: opts.linkBaseUrl,
      redis: services.redis,
      logger: services.logger,
    },
  });

  const sync = createSyncModule(services, {
    access: access.api,
    sources: [
      defects.api.syncSource,
      diary.api.syncSource,
      rfis.api.syncSource,
      documents.api.syncSource,
      workforce.api.syncSource,
    ],
    commands: [...defects.api.syncCommands],
    accessState: platform.api.getProjectAccessState,
  });

  const all = [
    identity,
    platform,
    access,
    billing,
    backoffice,
    files,
    ai,
    documents,
    rfis,
    defects,
    estimating,
    integrations,
    diary,
    workforce,
    sync,
  ];
  const routes: RouteTable = {};
  for (const m of all) {
    for (const [id, handler] of Object.entries(m.routes)) {
      if (id in routes) throw new Error(`Operation ${id} registered by two modules`);
      (routes as Record<string, unknown>)[id] = handler;
    }
  }
  return {
    database: services.database as Database,
    identity,
    platform,
    access,
    billing,
    backoffice,
    files,
    ai,
    documents,
    rfis,
    defects,
    estimating,
    integrations,
    sync,
    diary,
    workforce,
    routes,
  };
}

export type Modules = Awaited<ReturnType<typeof loadModules>>;
