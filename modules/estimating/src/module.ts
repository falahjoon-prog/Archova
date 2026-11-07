import { defineModule, type KernelServices } from '@archova/kernel';
import { createBiddersService } from './application/bidders';
import { createBoardService } from './application/board';
import { createEstimateService } from './application/estimate';
import { createLibraryService } from './application/library';
import { createTenderLinkService } from './application/tender-links';
import { createTakeoffService } from './application/takeoff';
import { createTenderService, type EstimatingDeps } from './application/tender';
import type { Entitlements, MessageSender } from '@archova/kernel';
import { estimatingRoutes } from './api/routes';
import { ESTIMATING_PERMISSIONS } from './permissions';

export interface TenderLinkConfig {
  messages: MessageSender;
  entitlements: (orgId: string) => Promise<Entitlements>;
  /** The public web origin the invite links point at, e.g. `https://app.archova.com.au`. */
  baseUrl: string;
  senderName(userId: string): Promise<string>;
}

export function createEstimatingModule(
  services: KernelServices,
  deps: EstimatingDeps & { links: TenderLinkConfig },
) {
  const tenders = createTenderService(deps);
  const takeoff = createTakeoffService(deps);
  const library = createLibraryService(deps);
  const estimates = createEstimateService({ ...deps, library });
  const board = createBoardService(deps);
  const bidders = createBiddersService(deps);
  const tenderLinks = createTenderLinkService({
    database: services.database,
    access: deps.access,
    platform: deps.platform,
    entitlements: deps.links.entitlements,
    redis: services.redis,
    logger: services.logger,
    now: deps.now,
  });
  return {
    definition: defineModule({ name: 'estimating', permissions: ESTIMATING_PERMISSIONS }),
    routes: estimatingRoutes(
      services.database,
      tenders,
      takeoff,
      library,
      estimates,
      board,
      bidders,
      tenderLinks,
      {
        messages: deps.links.messages,
        baseUrl: deps.links.baseUrl,
        senderName: deps.links.senderName,
        logger: services.logger,
      },
    ),
    api: {
      scopeForQuoteReading: tenders.scopeForQuoteReading,
      quoteForNegotiation: tenders.quoteForNegotiation,
    },
  };
}

export type EstimatingModule = ReturnType<typeof createEstimatingModule>;
export type EstimatingApi = EstimatingModule['api'];
