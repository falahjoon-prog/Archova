// Composition root: the list of modules this app loads (backend 01 §2). Adding a module means adding it here.
import type { Database, KernelServices, MessageSender, RouteTable } from '@archova/kernel';
import { AI_PERMISSIONS, createAiModule, type AiConfig, type ModelProvider } from '@archova/mod-ai';
import { createAccessModule } from '@archova/mod-access';
import {
  TRIAL_ENTITLEMENTS,
  createBillingModule,
  type EntitlementProvider,
} from '@archova/mod-billing';
import { DIARY_PERMISSIONS, createDiaryModule } from '@archova/mod-diary';
import { DOCUMENTS_PERMISSIONS, createDocumentsModule } from '@archova/mod-documents';
import { createFilesModule, type MalwareScanner, type ObjectStore } from '@archova/mod-files';
import { createIdentityModule, type IdentityConfig } from '@archova/mod-identity';
import { createPlatformModule } from '@archova/mod-platform';
import { WORKFORCE_PERMISSIONS, createWorkforceModule } from '@archova/mod-workforce';
import { RFIS_PERMISSIONS, createRfisModule } from '@archova/mod-rfis';
import { createSyncModule } from '@archova/mod-sync';

/** Permission keys declared by feature modules, registered with `access` next to the foundation keys. */
export const MODULE_PERMISSIONS = [
  AI_PERMISSIONS,
  DOCUMENTS_PERMISSIONS,
  RFIS_PERMISSIONS,
  DIARY_PERMISSIONS,
  WORKFORCE_PERMISSIONS,
];

export interface ModuleOptions {
  identity: IdentityConfig;
  files: { store: ObjectStore; scanner: MalwareScanner };
  entitlements?: EntitlementProvider;
  ai: { config: AiConfig; provider?: ModelProvider };
  /** One-time codes for access links (X45). */
  messages: MessageSender;
  /** The web origin access links point at. */
  linkBaseUrl: string;
}

export async function loadModules(services: KernelServices, opts: ModuleOptions) {
  const identity = await createIdentityModule(services, opts.identity);
  const billing = createBillingModule(opts.entitlements ? { entitlements: opts.entitlements } : {});
  // access ↔ platform reference each other's public interfaces; resolve lazily.
  let access: ReturnType<typeof createAccessModule> | null = null;
  const platform = createPlatformModule(services, {
    identity: identity.api,
    access: () => access!.api,
    defaultEntitlements: TRIAL_ENTITLEMENTS,
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
    // Anyone who can sign in on a project can upload their own white card and licence photos.
    uploadPermissions: { workforce: 'workforce.attendance.sign_in_self' },
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

  const ai = createAiModule(services, {
    config: opts.ai.config,
    orgTimeZone: async (scope) => (await platform.api.getOrg(scope)).timezone,
    readFile: (scope, fileId, maxBytes) => files.api.readFileBytes(scope, fileId, maxBytes),
    assert: async (scope, key, target) => {
      await access!.api.assert(scope, key, target);
    },
    sources: (scope, projectId) => documents.api.aiSources(scope, projectId),
    accessScopes: (scope, projectId) => documents.api.aiAccessScopes(scope, projectId),
    similarRfis: (scope, projectId, input) => rfis.api.findSimilar(scope, projectId, input),
    getDrawingRevision: (scope, projectId, id) =>
      documents.api.getDrawingRevision(scope, projectId, id),
    getPreviousDrawingRevision: (scope, projectId, id) =>
      documents.api.getPreviousDrawingRevision(scope, projectId, id),
    getMarkup: (scope, projectId, revisionId, markupId) =>
      documents.api.getMarkup(scope, projectId, revisionId, markupId),
    openRfisOnDrawing: (scope, projectId, ids) => rfis.api.openOnDrawing(scope, projectId, ids),
    ...(opts.ai.provider ? { provider: opts.ai.provider } : {}),
  });

  const diary = createDiaryModule(services, {
    access: access.api,
    platform: platform.api,
    files: files.api,
  });

  const sync = createSyncModule();

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

  const all = [
    identity,
    platform,
    access,
    billing,
    files,
    ai,
    documents,
    rfis,
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
    files,
    ai,
    documents,
    rfis,
    sync,
    diary,
    workforce,
    routes,
  };
}

export type Modules = Awaited<ReturnType<typeof loadModules>>;
