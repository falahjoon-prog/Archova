// Composition root: the list of modules this app loads (backend 01 §2). Adding a module means adding it here.
import type { Database, KernelServices, RouteTable } from '@archova/kernel';
import { AI_PERMISSIONS, createAiModule, type AiConfig, type ModelProvider } from '@archova/mod-ai';
import { createAccessModule } from '@archova/mod-access';
import {
  TRIAL_ENTITLEMENTS,
  createBillingModule,
  type EntitlementProvider,
} from '@archova/mod-billing';
import { DOCUMENTS_PERMISSIONS, createDocumentsModule } from '@archova/mod-documents';
import { createFilesModule, type MalwareScanner, type ObjectStore } from '@archova/mod-files';
import { createIdentityModule, type IdentityConfig } from '@archova/mod-identity';
import { createPlatformModule } from '@archova/mod-platform';
import { RFIS_PERMISSIONS, createRfisModule } from '@archova/mod-rfis';

/** Permission keys declared by feature modules, registered with `access` next to the foundation keys. */
export const MODULE_PERMISSIONS = [AI_PERMISSIONS, DOCUMENTS_PERMISSIONS, RFIS_PERMISSIONS];

export interface ModuleOptions {
  identity: IdentityConfig;
  files: { store: ObjectStore; scanner: MalwareScanner };
  entitlements?: EntitlementProvider;
  ai: { config: AiConfig; provider?: ModelProvider };
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
  });

  const documents = createDocumentsModule(services, {
    access: access.api,
    platform: platform.api,
    files: files.api,
    identity: identity.api,
  });

  const ai = createAiModule(services, {
    config: opts.ai.config,
    orgTimeZone: async (scope) => (await platform.api.getOrg(scope)).timezone,
    ...(opts.ai.provider ? { provider: opts.ai.provider } : {}),
  });

  const rfis = createRfisModule(services, {
    access: access.api,
    platform: platform.api,
    documents: documents.api,
    files: files.api,
  });

  const all = [identity, platform, access, billing, files, ai, documents, rfis];
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
    routes,
  };
}

export type Modules = Awaited<ReturnType<typeof loadModules>>;
