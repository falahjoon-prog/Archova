// Public interface of @archova/mod-backoffice: the owner console's backend (backend 09). It changes nothing by
// itself: catalogue changes go through `billing`, and every change that needs a second person is a request here.
import { defineModule, type KernelServices } from '@archova/kernel';
import type { CatalogueService } from '@archova/mod-billing';
import { internalRoutes } from './api/routes';
import { createCustomerService } from './application/customers';
import { createFlagService } from './application/flags';
import { createRequestService } from './application/requests';
import { createStaffService } from './application/staff';

export { BACKOFFICE_PERMISSIONS, ROLE_PERMISSIONS, permissionsFor } from './permissions';
export type { InternalHandlers, InternalInput, InternalResult } from './api/routes';
export type { StaffContext } from './application/staff';
export type { DirectoryEntry } from './application/customers';

export interface BackofficeConfig {
  /** Password sign-in for staff: local runs and the demo cell only. */
  localLogin: boolean;
  /** Solo-owner mode delay for pricing publishes (24 hours in production, Sam 12 §4). */
  soloCoolingOffHours: number;
}

export function createBackofficeModule(
  services: Pick<KernelServices, 'database'>,
  deps: { catalogue: CatalogueService; config: BackofficeConfig; now?: () => Date },
) {
  const staff = createStaffService({
    database: services.database,
    localLogin: deps.config.localLogin,
    ...(deps.now ? { now: deps.now } : {}),
  });
  const customers = createCustomerService(services);
  const requests = createRequestService({
    database: services.database,
    catalogue: deps.catalogue,
    staff,
    soloCoolingOffHours: deps.config.soloCoolingOffHours,
    ...(deps.now ? { now: deps.now } : {}),
  });
  const flags = createFlagService({ database: services.database, staff });
  return {
    definition: defineModule({ name: 'backoffice' }),
    /** No customer routes: /internal/v1 is mounted by apps/api from `internal`. */
    routes: {},
    internal: internalRoutes({ staff, requests, customers, catalogue: deps.catalogue, flags }),
    api: {
      /** The staff session behind a console cookie; null when absent, expired or revoked. */
      resolveStaff: staff.resolve,
      requireStepUp: staff.requireStepUp,
      /** Keeps the tenant directory current; `platform` calls it inside its own transaction. */
      directory: { upsert: customers.upsert },
      /** Server-side flag evaluation for one org (backend 09 §5); a flag never grants an unlicensed module. */
      flags: { isOn: flags.isOn },
      /** Creates or updates a staff account; used by the seed command only. */
      upsertLocalStaff: staff.upsertLocal,
    },
  };
}

export type BackofficeModule = ReturnType<typeof createBackofficeModule>;
