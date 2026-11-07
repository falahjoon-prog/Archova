import { defineModule, type KernelServices } from '@archova/kernel';
import { linksRoutes } from './api/routes';
import { createLinksService, type LinksDeps } from './application/links';
import { LINKS_PERMISSIONS } from './permissions';

/**
 * Related items: a generic link between any two records on a project, shown as a panel on each record. It stores only
 * the pair and the reason; what each end looks like, and whether the caller may see it, comes from the owning tool's
 * `LinkSource`, so no tool's tables or permission rules are copied here.
 */
export function createLinksModule(services: KernelServices, deps: LinksDeps) {
  const service = createLinksService(deps);
  return {
    definition: defineModule({ name: 'links', permissions: LINKS_PERMISSIONS }),
    routes: linksRoutes(services.database, service),
    api: {
      /** Link two records the caller can open (a module that converts one record into another links them this way). */
      create: service.create,
      /** The records connected to one, to a few steps out, that the caller can open. Called by `ai` (Ask Nova) only. */
      graph: service.graph,
    },
  };
}

export type LinksModule = ReturnType<typeof createLinksModule>;
export type LinksApi = LinksModule['api'];
