// Public interface of @archova/mod-backoffice: the owner console's backend (backend 09). It changes nothing by
// itself: catalogue changes go through `billing`, and every change that needs a second person is a request here.
import type { SupportProjectDto } from '@archova/contracts';
import { defineModule, type KernelServices } from '@archova/kernel';
import {
  createAccountService,
  type AccountService,
  type AdjustmentService,
  type CatalogueService,
} from '@archova/mod-billing';
import { customerRoutes, internalRoutes } from './api/routes';
import { createCustomerService } from './application/customers';
import { createFlagService } from './application/flags';
import { createOrgActionService, type OrgActionDeps } from './application/org-actions';
import {
  createSupportAccessService,
  type SupportSessionNotice,
} from './application/support-access';
import { createRequestService, type RequestService } from './application/requests';
import { createStaffService } from './application/staff';

export { BACKOFFICE_PERMISSIONS, ROLE_PERMISSIONS, permissionsFor } from './permissions';
export type { InternalHandlers, InternalInput, InternalResult } from './api/routes';
export type { StaffContext } from './application/staff';
export type { SupportSessionNotice } from './application/support-access';
export type { DirectoryEntry } from './application/customers';

export interface BackofficeConfig {
  /** Password sign-in for staff: local runs and the demo cell only. */
  localLogin: boolean;
  /** Solo-owner mode delay for pricing publishes (24 hours in production, Sam 12 §4). */
  soloCoolingOffHours: number;
  /** Support access needs a hardware-key sign-in. Defaults to on whenever password sign-in is off (hosted). */
  requireSupportHardwareKey?: boolean;
}

export function createBackofficeModule(
  services: Pick<KernelServices, 'database'>,
  deps: {
    catalogue: CatalogueService;
    accounts: AccountService;
    adjustments: AdjustmentService;
    credits: OrgActionDeps['credits'];
    supportReads: () => {
      projects(
        orgId: string,
        staffId: string,
        projectIds: string[] | null,
      ): Promise<SupportProjectDto[]>;
    };
    /** Tells the company's owners and admins that a support session opened. */
    notifySupportSession: (notice: SupportSessionNotice) => Promise<void>;
    config: BackofficeConfig;
    now?: () => Date;
  },
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
    adjustments: deps.adjustments,
    staff,
    soloCoolingOffHours: deps.config.soloCoolingOffHours,
    ...(deps.now ? { now: deps.now } : {}),
  });
  const orgActions = createOrgActionService({
    database: services.database,
    accounts: deps.accounts,
    adjustments: deps.adjustments,
    requests,
    credits: deps.credits,
    ...(deps.now ? { now: deps.now } : {}),
  });
  const support = createSupportAccessService({
    database: services.database,
    reads: deps.supportReads,
    notify: deps.notifySupportSession,
    requireHardwareKey: deps.config.requireSupportHardwareKey ?? !deps.config.localLogin,
    ...(deps.now ? { now: deps.now } : {}),
  });
  const flags = createFlagService({ database: services.database, staff });
  return {
    definition: defineModule({ name: 'backoffice' }),
    /** /internal/v1 is mounted by apps/api from `internal`; the only customer route is the org's own flag set. */
    routes: customerRoutes({ flags }),
    internal: internalRoutes({
      staff,
      requests,
      customers,
      catalogue: deps.catalogue,
      flags,
      orgActions,
      support,
    }),
    api: {
      /** The staff session behind a console cookie; null when absent, expired or revoked. */
      resolveStaff: staff.resolve,
      requireStepUp: staff.requireStepUp,
      /** Keeps the tenant directory current; `platform` calls it inside its own transaction. */
      directory: { upsert: customers.upsert },
      /** Customer-side support access: the org's own admin grants, revokes and reads (platform calls these). */
      support: {
        list: support.list,
        grant: support.grant,
        revoke: support.revoke,
        banner: support.banner,
        hasOpenSession: support.hasOpenSession,
        /** Staff account actions (trial, plan, suspension, credits) as the customer's admins read them. */
        listStaffActions: orgActions.listForCustomer,
      },
      /** Server-side flag evaluation for one org (backend 09 §5); a flag never grants an unlicensed module. */
      flags: { isOn: flags.isOn, forOrg: flags.forOrg },
      /** Creates or updates a staff account; used by the seed command only. */
      upsertLocalStaff: staff.upsertLocal,
    },
  };
}

/**
 * The trial-expiry scheduled job's entry point (apps/worker): expires one org's lapsed trial and updates the customer
 * list in the same transaction. Needs no console services, so the worker does not build the whole module.
 */
export function expireLapsedTrial(
  database: KernelServices['database'],
  orgId: string,
  now: Date,
): Promise<boolean> {
  const credits = () => {
    throw new Error('Nova credits are not available to the trial-expiry job');
  };
  return createOrgActionService({
    database,
    accounts: createAccountService(),
    credits,
    // Only `expireTrial` runs here; discounts, overrides and refunds are console actions and are never reached.
    adjustments: {} as AdjustmentService,
    requests: {} as RequestService,
    now: () => now,
  }).expireTrial(orgId, now);
}

/** The trial-backfill job's entry point (apps/worker): see `AccountService.backfillTrialEnd`. */
export function backfillTrialEndDate(
  database: KernelServices['database'],
  org: { id: string; name: string; slug: string; createdAt: Date },
  now: Date,
): Promise<boolean> {
  return createOrgActionService({
    database,
    accounts: createAccountService(),
    credits: () => {
      throw new Error('Nova credits are not available to the trial-backfill job');
    },
    adjustments: {} as AdjustmentService,
    requests: {} as RequestService,
    now: () => now,
  }).backfillTrial(org, now);
}

export type BackofficeModule = ReturnType<typeof createBackofficeModule>;
