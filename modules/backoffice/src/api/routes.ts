import type { z } from 'zod';
import type {
  internalOperations,
  InternalOperationId,
  OrgDetailDto,
  PlanDraftInput,
} from '@archova/contracts';
import { decodeId } from '@archova/domain';
import { AppError, defineRoutes, requireTenant } from '@archova/kernel';
import type { CatalogueService } from '@archova/mod-billing';
import type { CustomerService } from '../application/customers';
import type { FlagService } from '../application/flags';
import type { SupportAccessService } from '../application/support-access';
import type { OrgActionService } from '../application/org-actions';
import type { RequestService } from '../application/requests';
import type { StaffContext, StaffService } from '../application/staff';

type Ops = typeof internalOperations;
type Infer<T> = T extends z.ZodType ? z.infer<T> : Record<string, never>;

export interface InternalInput<K extends InternalOperationId> {
  params: Infer<Ops[K]['params']>;
  query: Infer<Ops[K]['query']>;
  body: Infer<Ops[K]['body']>;
  staff: StaffContext | null;
  ip: string | null;
  userAgent: string | null;
}

export interface InternalResult {
  status: number;
  body?: unknown;
  /** Sets the staff session cookie. */
  sessionCookie?: { token: string; maxAgeSeconds: number };
  clearSessionCookie?: boolean;
}

export type InternalHandlers = {
  [K in InternalOperationId]: (input: InternalInput<K>) => Promise<InternalResult>;
};

export interface InternalDeps {
  staff: StaffService;
  requests: RequestService;
  customers: CustomerService;
  catalogue: CatalogueService;
  flags: FlagService;
  orgActions: OrgActionService;
  support: SupportAccessService;
}

const me = (input: { staff: StaffContext | null }) => {
  if (!input.staff) throw new AppError('auth.unauthenticated', 'Sign in to continue.');
  return input.staff;
};

/** Operations the owner console calls (backend 09 §6). Framework-free: apps/api mounts them under /internal/v1. */
export function internalRoutes(d: InternalDeps): InternalHandlers {
  const ok = (body: unknown, status = 200): InternalResult => ({ status, body });
  const orgId = (ref: string) => {
    const id = decodeId('org', ref);
    if (!id) throw new AppError('org.not_found');
    return id;
  };
  const orgDetail = async (id: string): Promise<OrgDetailDto> => {
    const [org, history, account, actions, adjustments] = await Promise.all([
      d.customers.get(id),
      d.requests.list({ orgId: id, limit: 20 }),
      d.orgActions.account(id),
      d.orgActions.list(id),
      d.orgActions.adjustments(id),
    ]);
    return { ...org, history, account, actions, ...adjustments };
  };
  return {
    login: async (i) => {
      const { token, maxAgeSeconds } = await d.staff.login(i.body.email, i.body.password, {
        ip: i.ip,
        userAgent: i.userAgent,
      });
      const staff = await d.staff.resolve(token);
      return { status: 200, body: d.staff.toDto(staff!), sessionCookie: { token, maxAgeSeconds } };
    },
    logout: async (i) => {
      await d.staff.logout(me(i).sessionId);
      return { status: 204, clearSessionCookie: true };
    },
    stepUp: async (i) => {
      await d.staff.stepUp(me(i), i.body.password);
      const fresh = { ...me(i), authTime: new Date() };
      return ok(d.staff.toDto(fresh));
    },
    getMe: async (i) => ok(d.staff.toDto(me(i))),
    listOrgs: async (i) => ok(await d.customers.list(i.query)),
    getOrg: async (i) => {
      const id = decodeId('org', i.params.orgId);
      if (!id) throw new AppError('org.not_found');
      return ok(await orgDetail(id));
    },
    getOrgSupportAccess: async (i) => ok(await d.support.list(orgId(i.params.orgId))),
    startSupportSession: async (i) => {
      const id = orgId(i.params.orgId);
      await d.support.start(me(i), id, i.body.ticketRef);
      return ok(await d.support.list(id), 201);
    },
    listSupportProjects: async (i) =>
      ok({ items: await d.support.viewProjects(me(i), orgId(i.params.orgId)) }),
    endSupportSession: async (i) => {
      const id = orgId(i.params.orgId);
      await d.support.end(me(i), id, i.params.sessionId);
      return ok(await d.support.list(id));
    },
    trialExtendOrg: async (i) => {
      const id = orgId(i.params.orgId);
      await d.orgActions.extendTrial(me(i), id, i.body);
      return ok(await orgDetail(id));
    },
    changeOrgPlan: async (i) => {
      const id = orgId(i.params.orgId);
      await d.orgActions.changePlan(me(i), id, i.body);
      return ok(await orgDetail(id));
    },
    suspendOrg: async (i) => {
      const id = orgId(i.params.orgId);
      await d.orgActions.suspend(me(i), id, i.body);
      return ok(await orgDetail(id));
    },
    reactivateOrg: async (i) => {
      const id = orgId(i.params.orgId);
      await d.orgActions.reactivate(me(i), id, i.body);
      return ok(await orgDetail(id));
    },
    grantOrgCredits: async (i) => {
      const id = orgId(i.params.orgId);
      await d.orgActions.grantCredits(me(i), id, i.body);
      return ok(await orgDetail(id));
    },
    addOrgDiscount: async (i) => {
      const id = orgId(i.params.orgId);
      await d.orgActions.addDiscount(me(i), id, i.body);
      return ok(await orgDetail(id));
    },
    revokeOrgDiscount: async (i) => {
      const id = orgId(i.params.orgId);
      await d.orgActions.revokeDiscount(me(i), id, i.params.discountId, i.body);
      return ok(await orgDetail(id));
    },
    grantOrgOverride: async (i) => {
      const id = orgId(i.params.orgId);
      await d.orgActions.grantOverride(me(i), id, i.body);
      return ok(await orgDetail(id));
    },
    revokeOrgOverride: async (i) => {
      const id = orgId(i.params.orgId);
      await d.orgActions.revokeOverride(me(i), id, i.params.overrideId, i.body);
      return ok(await orgDetail(id));
    },
    refundOrg: async (i) => {
      const id = orgId(i.params.orgId);
      await d.orgActions.refund(me(i), id, i.body);
      return ok(await orgDetail(id));
    },
    listPlans: async () => ok({ items: await d.catalogue.listPlans() }),
    createPlan: async (i) => {
      await d.catalogue.createPlan(i.body.code, i.body.draft, me(i).staffId);
      return ok({ code: i.body.code }, 201);
    },
    savePlanDraft: async (i) => {
      await d.catalogue.savePlanDraft(i.params.code, i.body as PlanDraftInput, me(i).staffId);
      return { status: 204 };
    },
    discardPlanDraft: async (i) => {
      await d.catalogue.discardPlanDraft(i.params.code);
      return { status: 204 };
    },
    submitPlanDraft: async (i) => {
      const staff = me(i);
      const draft = await d.catalogue.submitPlanDraft(i.params.code);
      try {
        const plan = (await d.catalogue.listPlans()).find((p) => p.code === i.params.code);
        const request = await d.requests.create(staff, {
          kind: 'plan.publish',
          subjectRef: i.params.code,
          subjectLabel: `Plan ${draft.name}, version ${draft.version}`,
          reason: i.body.reason,
          preview: {
            planCode: i.params.code,
            version: draft.version,
            draft: plan?.draft ?? null,
            live: plan?.published ?? null,
          },
        });
        return ok(request, 201);
      } catch (e) {
        await d.catalogue.returnPlanDraft(i.params.code);
        throw e;
      }
    },
    listPriceBooks: async () => ok({ items: await d.catalogue.listPriceBooks() }),
    createPriceBook: async (i) => ok(await d.catalogue.createPriceBook(me(i).staffId), 201),
    getPriceBook: async (i) => ok(await d.catalogue.getPriceBook(i.params.id)),
    savePriceBook: async (i) => {
      await d.catalogue.savePriceBook(i.params.id, i.body);
      return ok(await d.catalogue.getPriceBook(i.params.id));
    },
    previewPriceBook: async (i) => ok(await d.catalogue.previewPriceBook(i.params.id)),
    submitPriceBook: async (i) => {
      const staff = me(i);
      const { version, preview } = await d.catalogue.submitPriceBook(i.params.id);
      try {
        const request = await d.requests.create(staff, {
          kind: 'pricebook.publish',
          subjectRef: i.params.id,
          subjectLabel: `Price book ${version}`,
          reason: i.body.reason,
          preview: preview as unknown as Record<string, unknown>,
        });
        return ok(request, 201);
      } catch (e) {
        await d.catalogue.returnPriceBook(i.params.id);
        throw e;
      }
    },
    discardPriceBook: async (i) => {
      await d.catalogue.discardPriceBook(i.params.id);
      return { status: 204 };
    },
    listRequests: async (i) => {
      let orgId: string | undefined;
      if (i.query.orgId) {
        const decoded = decodeId('org', i.query.orgId);
        if (!decoded) throw new AppError('org.not_found');
        orgId = decoded;
      }
      return ok({
        items: await d.requests.list({
          ...(i.query.status ? { status: i.query.status } : {}),
          ...(orgId ? { orgId } : {}),
          limit: i.query.limit,
        }),
      });
    },
    approveRequest: async (i) => ok(await d.requests.approve(me(i), i.params.id)),
    rejectRequest: async (i) => ok(await d.requests.reject(me(i), i.params.id, i.body.reason)),
    cancelRequest: async (i) => ok(await d.requests.cancel(me(i), i.params.id)),
    listFlags: async () => ok({ items: await d.flags.list() }),
    updateFlag: async (i) => {
      await d.flags.update(me(i), i.params.key, i.body);
      return ok({ items: await d.flags.list() });
    },
    killFlag: async (i) => {
      await d.flags.kill(me(i), i.params.key, i.body.reason);
      return ok({ items: await d.flags.list() });
    },
    listCohorts: async () => ok({ items: await d.flags.listCohorts() }),
    createCohort: async (i) => ok(await d.flags.createCohort(me(i), i.body), 201),
    addCohortMember: async (i) => {
      await d.flags.addMember(me(i), i.params.id, i.body.orgId);
      return ok({ items: await d.flags.listCohorts() });
    },
    removeCohortMember: async (i) => {
      await d.flags.removeMember(me(i), i.params.id, i.params.orgId);
      return { status: 204 };
    },
    listStaff: async () => ok({ items: await d.staff.list() }),
  };
}

/** What the org's own signed-in members may ask: which flags are on for them (never the rules behind them). */
export function customerRoutes(deps: { flags: FlagService }) {
  return defineRoutes({
    getFeatureFlags: async (input) => {
      const tenant = requireTenant(input);
      return {
        status: 200,
        body: { orgId: input.params.orgId, flags: await deps.flags.forOrg(tenant.orgId) },
        headers: { 'cache-control': 'private, no-store' },
      };
    },
  });
}
