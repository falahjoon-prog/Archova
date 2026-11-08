// The `/internal/v1` contract: owner-console operations for Archova staff only (ADR-0008, backend 09 §1).
// Kept apart from the customer OpenAPI spec so the customer clients never see these operations. Only `apps/api`
// (the `backoffice` module) implements them and only `apps/admin` calls them.
import { z } from 'zod';

export const STAFF_ROLES = [
  'owner',
  'pricing_approver',
  'billing_ops',
  'sales',
  'support',
  'security_lead',
  'finance_read',
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Modules a plan can include. Only keys that exist in code can be sold (Sam 12 §1). */
export const PLAN_MODULE_KEYS = [
  'documents',
  'rfis',
  'submittals',
  'diary',
  'defects',
  'quality',
  'safety',
  'insurance',
  'photos',
  'meetings',
  'correspondence',
  'workforce',
  'inductions',
  'variations',
  'claims',
  'estimating',
  'ownerportal',
  'bim',
  'ai',
] as const;
export type PlanModuleKey = (typeof PLAN_MODULE_KEYS)[number];

export const REQUEST_KINDS = ['pricebook.publish', 'plan.publish', 'refund'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
export const REQUEST_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'executed',
  'failed',
  'cancelled',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

const slug = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]{1,29}$/,
    'Lower-case letters, digits and underscores, starting with a letter',
  );
const reason = z.string().trim().min(5).max(500);
const uuid = z.string().uuid();

export const PRICE_UNITS = ['free', 'user_month', 'year'] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

export const PriceInput = z
  .object({
    planCode: slug,
    unit: z.enum(PRICE_UNITS),
    /** "From A$24,000 a year" style prices (Business, Enterprise). */
    fromPrice: z.boolean().default(false),
    /** Whole cents, ex GST. Null only for free plans. */
    amountCents: z.number().int().min(0).max(100_000_000).nullable(),
  })
  .refine((p) => (p.unit === 'free') === (p.amountCents === null), {
    message: 'Free plans have no amount; every other unit needs one',
    path: ['amountCents'],
  });
export type PriceInput = z.infer<typeof PriceInput>;

export const PlanDraftInput = z.object({
  name: z.string().trim().min(2).max(60),
  blurb: z.string().trim().min(2).max(200),
  features: z.array(z.string().trim().min(2).max(120)).max(12),
  modules: z.array(z.enum(PLAN_MODULE_KEYS)).max(PLAN_MODULE_KEYS.length),
  /** Nova credits included each month; null means the plan has no allowance (never for paid plans). */
  aiCreditsMonthly: z.number().int().min(0).max(10_000_000).nullable(),
  ctaLabel: z.string().trim().min(2).max(40),
  ctaHref: z.string().regex(/^\/[a-z0-9/_-]*$/, 'A path on the website, such as /demo'),
});
export type PlanDraftInput = z.infer<typeof PlanDraftInput>;

const orgRef = z.string().min(1).max(40);
const ticketRef = z.string().trim().min(2).max(60);
const orgOnly = z.object({ orgId: orgRef });
const withTicket = { reason, ticketRef };

/** A change to one flag. Orgs and cohorts take effect at once; all-orgs and percentage rollouts are Owner-only. */
export const FlagChangeInput = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('org'), orgId: orgRef, on: z.boolean(), reason }),
  z.object({ scope: z.literal('cohort'), cohortId: uuid, on: z.boolean(), reason }),
  z.object({ scope: z.literal('all'), on: z.boolean(), reason }),
  z.object({ scope: z.literal('percent'), percent: z.number().int().min(0).max(100), reason }),
]);
export type FlagChangeInput = z.infer<typeof FlagChangeInput>;

export type StaffDto = {
  id: string;
  email: string;
  name: string;
  roles: StaffRole[];
  permissions: string[];
  /** When the session last proved the password; step-up actions need this within 5 minutes. */
  authTime: string;
  stepUpValidUntil: string | null;
};

export type PlanVersionDto = {
  id: string;
  version: number;
  status: 'draft' | 'pending_approval' | 'published' | 'retired';
  name: string;
  blurb: string;
  features: string[];
  modules: string[];
  aiCreditsMonthly: number | null;
  ctaLabel: string;
  ctaHref: string;
  publishedAt: string | null;
};
export type PlanDto = {
  code: string;
  sortOrder: number;
  published: PlanVersionDto | null;
  draft: PlanVersionDto | null;
};

export type PriceDto = PriceInput;
export type PriceBookDto = {
  id: string;
  version: string;
  status: 'draft' | 'pending_approval' | 'scheduled' | 'published' | 'retired';
  effectiveFrom: string | null;
  createdBy: string | null;
  publishedAt: string | null;
  prices: PriceDto[];
};
export type PriceChange = {
  planCode: string;
  unit: PriceUnit;
  before: { amountCents: number | null; fromPrice: boolean } | null;
  after: { amountCents: number | null; fromPrice: boolean } | null;
  kind: 'added' | 'removed' | 'increase' | 'decrease' | 'unchanged';
};
export type PriceBookPreview = {
  changes: PriceChange[];
  hasIncrease: boolean;
  /** An increase needs at least 60 days' notice (backend 09 §4); null when no increase. */
  earliestEffectiveFrom: string | null;
  problems: string[];
};

export type RequestDto = {
  id: string;
  kind: RequestKind;
  status: RequestStatus;
  subject: string;
  reason: string;
  /** What the requester saw when proposing the change: shown to the approver. */
  preview: Record<string, unknown> | null;
  requestedBy: { id: string; name: string };
  approvedBy: { id: string; name: string } | null;
  createdAt: string;
  decidedAt: string | null;
  executedAt: string | null;
  /** Solo-owner mode: the earliest time the requester may approve their own request. */
  coolingOffUntil: string | null;
  result: Record<string, unknown> | null;
  orgId: string | null;
};

export type OrgListItemDto = {
  orgId: string;
  name: string;
  slug: string;
  plan: string;
  state: string;
  seats: number | null;
  trialEndsAt: string | null;
  createdAt: string;
};

export const SUSPEND_CATEGORIES = ['abuse', 'fraud', 'security', 'legal_order'] as const;
export type SuspendCategory = (typeof SUSPEND_CATEGORIES)[number];

export const CREDIT_GRANT_KINDS = ['top_up', 'goodwill', 'promo'] as const;
export type CreditGrantKind = (typeof CREDIT_GRANT_KINDS)[number];

export type OrgAccountDto = {
  plan: string;
  state: string;
  trialEndsAt: string | null;
  trialExtendedDays: number;
  suspended: { category: SuspendCategory; at: string } | null;
};
export type OrgActionKind =
  | 'trial.extend'
  | 'plan.change'
  | 'suspend'
  | 'reactivate'
  | 'credits.grant'
  | 'discount.add'
  | 'discount.revoke'
  | 'override.grant'
  | 'override.revoke'
  | 'refund';

/** `limit.*` keys an override can replace. */
export const OVERRIDE_LIMIT_KEYS = [
  'limit.ai_credits',
  'limit.seats',
  'limit.active_projects',
  'limit.storage_gb',
] as const;

export type OrgDiscountDto = {
  id: string;
  percent: number;
  startsOn: string;
  endsOn: string;
  reason: string;
  ticketRef: string;
  /** Live while not revoked and not past `endsOn`. */
  status: 'active' | 'ended' | 'revoked';
};
export type OrgOverrideDto = {
  id: string;
  kind: 'module' | 'limit';
  key: string;
  limitValue: number | null;
  expiresAt: string;
  reason: string;
  ticketRef: string;
  status: 'live' | 'expired' | 'revoked';
};
export type OrgRefundDto = {
  id: string;
  invoiceRef: string;
  amountCents: number;
  paidCents: number;
  reason: string;
  ticketRef: string;
  status: 'pending_approval' | 'approved' | 'cancelled';
  at: string;
};

export type OrgActionDto = {
  id: string;
  kind: OrgActionKind;
  summary: string;
  reason: string;
  ticketRef: string;
  by: string;
  at: string;
};
/** What a customer's own admins see of a staff account action; no reason, no staff name. */
export type StaffActionDto = {
  id: string;
  kind: OrgActionDto['kind'];
  summary: string;
  ticketRef: string;
  at: string;
};
export type OrgDetailDto = OrgListItemDto & {
  history: RequestDto[];
  account: OrgAccountDto | null;
  actions: OrgActionDto[];
  discounts: OrgDiscountDto[];
  overrides: OrgOverrideDto[];
  refunds: OrgRefundDto[];
};

export type SupportGrantDto = {
  id: string;
  ticketRef: string;
  level: 'view';
  /** Null = the whole company; otherwise support can only see these projects. */
  projectIds: string[] | null;
  grantedBy: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  status: 'active' | 'expired' | 'revoked';
};
export type SupportSessionDto = {
  id: string;
  grantId: string;
  staffName: string;
  ticketRef: string;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  status: 'open' | 'ended' | 'expired' | 'revoked';
};
/** Names and status only; a support session never sees documents, files or claims. */
/** A platform legal hold as staff see it. Customers never see these. */
export type OrgHoldDto = {
  id: string;
  projectId: string | null;
  reason: string;
  ticketRef: string;
  placedBy: string;
  placedAt: string;
  releasedBy: string | null;
  releasedAt: string | null;
  releaseReason: string | null;
};
export type SupportProjectDto = { id: string; name: string; number: string | null; status: string };
export type SupportAccessDto = { grants: SupportGrantDto[]; sessions: SupportSessionDto[] };

export type FlagOrgRef = { orgId: string; name: string };
export type FlagDto = {
  key: string;
  description: string;
  owner: string;
  removeBy: string;
  enabledForAll: boolean;
  percent: number;
  orgs: FlagOrgRef[];
  cohorts: Array<{ id: string; name: string }>;
  lastChange: { summary: string; reason: string; by: string; at: string } | null;
};
export type CohortDto = {
  id: string;
  name: string;
  description: string;
  members: FlagOrgRef[];
};

export type Page<T> = { items: T[]; nextCursor: string | null };

const noParams = null;
export interface InternalOperationDef {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  /** `none` only for sign-in. */
  auth: 'none' | 'staff';
  /** Permission key checked by the API before the handler runs (declared in the backoffice module). */
  permission?: string;
  /** Needs a fresh password check within the last 5 minutes (backend 09 §2). */
  stepUp?: boolean;
  params: z.ZodType | null;
  query: z.ZodType | null;
  body: z.ZodType | null;
}

const op = <T extends InternalOperationDef>(d: T) => d;
const id = z.object({ id: uuid });

export const internalOperations = {
  login: op({
    method: 'POST',
    path: '/internal/v1/auth/login',
    auth: 'none',
    params: noParams,
    query: noParams,
    body: z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) }),
  }),
  logout: op({
    method: 'POST',
    path: '/internal/v1/auth/logout',
    auth: 'staff',
    params: noParams,
    query: noParams,
    body: null,
  }),
  stepUp: op({
    method: 'POST',
    path: '/internal/v1/auth/step-up',
    auth: 'staff',
    params: noParams,
    query: noParams,
    body: z.object({ password: z.string().min(1).max(200) }),
  }),
  getMe: op({
    method: 'GET',
    path: '/internal/v1/me',
    auth: 'staff',
    params: noParams,
    query: noParams,
    body: null,
  }),
  listOrgs: op({
    method: 'GET',
    path: '/internal/v1/orgs',
    auth: 'staff',
    permission: 'backoffice.customers.read',
    params: noParams,
    query: z.object({
      q: z.string().trim().max(100).optional(),
      cursor: z.string().max(200).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    }),
    body: null,
  }),
  getOrg: op({
    method: 'GET',
    path: '/internal/v1/orgs/{orgId}',
    auth: 'staff',
    permission: 'backoffice.customers.read',
    params: z.object({ orgId: orgRef }),
    query: noParams,
    body: null,
  }),
  trialExtendOrg: op({
    method: 'POST',
    path: '/internal/v1/orgs/{orgId}/actions/trial-extend',
    auth: 'staff',
    permission: 'backoffice.accounts.trial',
    params: orgOnly,
    query: noParams,
    body: z.object({ days: z.number().int().min(1).max(30), ...withTicket }),
  }),
  changeOrgPlan: op({
    method: 'POST',
    path: '/internal/v1/orgs/{orgId}/actions/change-plan',
    auth: 'staff',
    permission: 'backoffice.accounts.plan',
    stepUp: true,
    params: orgOnly,
    query: noParams,
    body: z.object({ planCode: z.string().min(1).max(30), ...withTicket }),
  }),
  suspendOrg: op({
    method: 'POST',
    path: '/internal/v1/orgs/{orgId}/actions/suspend',
    auth: 'staff',
    permission: 'backoffice.accounts.suspend',
    stepUp: true,
    params: orgOnly,
    query: noParams,
    body: z.object({ category: z.enum(SUSPEND_CATEGORIES), ...withTicket }),
  }),
  reactivateOrg: op({
    method: 'POST',
    path: '/internal/v1/orgs/{orgId}/actions/reactivate',
    auth: 'staff',
    permission: 'backoffice.accounts.suspend',
    stepUp: true,
    params: orgOnly,
    query: noParams,
    body: z.object(withTicket),
  }),
  grantOrgCredits: op({
    method: 'POST',
    path: '/internal/v1/orgs/{orgId}/actions/grant-credits',
    auth: 'staff',
    permission: 'backoffice.accounts.credits',
    stepUp: true,
    params: orgOnly,
    query: noParams,
    body: z.object({
      credits: z.number().positive().max(1000),
      kind: z.enum(CREDIT_GRANT_KINDS),
      ...withTicket,
    }),
  }),
  addOrgDiscount: op({
    method: 'POST',
    path: '/internal/v1/orgs/{orgId}/actions/discounts',
    auth: 'staff',
    permission: 'backoffice.accounts.discount',
    stepUp: true,
    params: orgOnly,
    query: noParams,
    body: z.object({
      percent: z.number().int().min(1).max(100),
      months: z.number().int().min(1).max(12),
      ...withTicket,
    }),
  }),
  revokeOrgDiscount: op({
    method: 'POST',
    path: '/internal/v1/orgs/{orgId}/actions/discounts/{discountId}/revoke',
    auth: 'staff',
    permission: 'backoffice.accounts.discount',
    stepUp: true,
    params: z.object({ orgId: orgRef, discountId: uuid }),
    query: noParams,
    body: z.object(withTicket),
  }),
  grantOrgOverride: op({
    method: 'POST',
    path: '/internal/v1/orgs/{orgId}/actions/overrides',
    auth: 'staff',
    permission: 'backoffice.accounts.override',
    stepUp: true,
    params: orgOnly,
    query: noParams,
    body: z.object({
      kind: z.enum(['module', 'limit']),
      key: z.string().trim().min(1).max(60),
      limitValue: z.number().int().min(0).max(1_000_000_000).nullable().default(null),
      days: z.number().int().min(1).max(365),
      ...withTicket,
    }),
  }),
  revokeOrgOverride: op({
    method: 'POST',
    path: '/internal/v1/orgs/{orgId}/actions/overrides/{overrideId}/revoke',
    auth: 'staff',
    permission: 'backoffice.accounts.override',
    stepUp: true,
    params: z.object({ orgId: orgRef, overrideId: uuid }),
    query: noParams,
    body: z.object(withTicket),
  }),
  refundOrg: op({
    method: 'POST',
    path: '/internal/v1/orgs/{orgId}/actions/refunds',
    auth: 'staff',
    permission: 'backoffice.accounts.refund',
    stepUp: true,
    params: orgOnly,
    query: noParams,
    body: z.object({
      invoiceRef: z.string().trim().min(1).max(60),
      /** Cents. Over 500000 (A$5,000) the refund waits for a second person. */
      amountCents: z.number().int().min(1).max(100_000_000),
      paidCents: z.number().int().min(1).max(100_000_000),
      ...withTicket,
    }),
  }),
  listOrgHolds: op({
    method: 'GET',
    path: '/internal/v1/orgs/{orgId}/legal-holds',
    auth: 'staff',
    permission: 'backoffice.holds.manage',
    params: orgOnly,
    query: noParams,
    body: null,
  }),
  placeOrgHold: op({
    method: 'POST',
    path: '/internal/v1/orgs/{orgId}/legal-holds',
    auth: 'staff',
    permission: 'backoffice.holds.manage',
    params: orgOnly,
    query: noParams,
    // Omit projectId to hold the whole org. `ticketRef` is the request that asked for the hold.
    body: z.object({ projectId: z.string().min(1).max(40).optional(), ...withTicket }),
  }),
  releaseOrgHold: op({
    method: 'POST',
    path: '/internal/v1/orgs/{orgId}/legal-holds/{holdId}/release',
    auth: 'staff',
    permission: 'backoffice.holds.manage',
    params: z.object({ orgId: orgRef, holdId: uuid }),
    query: noParams,
    body: z.object({ reason }),
  }),
  getOrgSupportAccess: op({
    method: 'GET',
    path: '/internal/v1/orgs/{orgId}/support-access',
    auth: 'staff',
    permission: 'backoffice.customers.read',
    params: orgOnly,
    query: noParams,
    body: null,
  }),
  startSupportSession: op({
    method: 'POST',
    path: '/internal/v1/orgs/{orgId}/support-access/sessions',
    auth: 'staff',
    permission: 'backoffice.support.access',
    stepUp: true,
    params: orgOnly,
    query: noParams,
    body: z.object({ ticketRef }),
  }),
  endSupportSession: op({
    method: 'POST',
    path: '/internal/v1/orgs/{orgId}/support-access/sessions/{sessionId}/end',
    auth: 'staff',
    permission: 'backoffice.support.access',
    params: z.object({ orgId: orgRef, sessionId: uuid }),
    query: noParams,
    body: null,
  }),
  listSupportProjects: op({
    method: 'GET',
    path: '/internal/v1/orgs/{orgId}/support-access/projects',
    auth: 'staff',
    permission: 'backoffice.support.access',
    params: orgOnly,
    query: noParams,
    body: null,
  }),
  listPlans: op({
    method: 'GET',
    path: '/internal/v1/plans',
    auth: 'staff',
    permission: 'backoffice.pricing.read',
    params: noParams,
    query: noParams,
    body: null,
  }),
  createPlan: op({
    method: 'POST',
    path: '/internal/v1/plans',
    auth: 'staff',
    permission: 'backoffice.pricing.edit',
    params: noParams,
    query: noParams,
    body: z.object({ code: slug, draft: PlanDraftInput }),
  }),
  savePlanDraft: op({
    method: 'PUT',
    path: '/internal/v1/plans/{code}/draft',
    auth: 'staff',
    permission: 'backoffice.pricing.edit',
    params: z.object({ code: slug }),
    query: noParams,
    body: PlanDraftInput,
  }),
  discardPlanDraft: op({
    method: 'DELETE',
    path: '/internal/v1/plans/{code}/draft',
    auth: 'staff',
    permission: 'backoffice.pricing.edit',
    params: z.object({ code: slug }),
    query: noParams,
    body: null,
  }),
  submitPlanDraft: op({
    method: 'POST',
    path: '/internal/v1/plans/{code}/draft/submit',
    auth: 'staff',
    permission: 'backoffice.pricing.edit',
    params: z.object({ code: slug }),
    query: noParams,
    body: z.object({ reason }),
  }),
  listPriceBooks: op({
    method: 'GET',
    path: '/internal/v1/price-books',
    auth: 'staff',
    permission: 'backoffice.pricing.read',
    params: noParams,
    query: noParams,
    body: null,
  }),
  createPriceBook: op({
    method: 'POST',
    path: '/internal/v1/price-books',
    auth: 'staff',
    permission: 'backoffice.pricing.edit',
    params: noParams,
    query: noParams,
    body: null,
  }),
  getPriceBook: op({
    method: 'GET',
    path: '/internal/v1/price-books/{id}',
    auth: 'staff',
    permission: 'backoffice.pricing.read',
    params: id,
    query: noParams,
    body: null,
  }),
  savePriceBook: op({
    method: 'PUT',
    path: '/internal/v1/price-books/{id}',
    auth: 'staff',
    permission: 'backoffice.pricing.edit',
    params: id,
    query: noParams,
    body: z.object({
      effectiveFrom: z.string().datetime().nullable(),
      prices: z.array(PriceInput).min(1).max(40),
    }),
  }),
  previewPriceBook: op({
    method: 'POST',
    path: '/internal/v1/price-books/{id}/preview',
    auth: 'staff',
    permission: 'backoffice.pricing.read',
    params: id,
    query: noParams,
    body: null,
  }),
  submitPriceBook: op({
    method: 'POST',
    path: '/internal/v1/price-books/{id}/submit',
    auth: 'staff',
    permission: 'backoffice.pricing.edit',
    params: id,
    query: noParams,
    body: z.object({ reason }),
  }),
  discardPriceBook: op({
    method: 'DELETE',
    path: '/internal/v1/price-books/{id}',
    auth: 'staff',
    permission: 'backoffice.pricing.edit',
    params: id,
    query: noParams,
    body: null,
  }),
  listRequests: op({
    method: 'GET',
    path: '/internal/v1/requests',
    auth: 'staff',
    permission: 'backoffice.requests.read',
    params: noParams,
    query: z.object({
      status: z.enum(REQUEST_STATUSES).optional(),
      orgId: orgRef.optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
    body: null,
  }),
  approveRequest: op({
    method: 'POST',
    path: '/internal/v1/requests/{id}/approve',
    auth: 'staff',
    permission: 'backoffice.requests.decide',
    stepUp: true,
    params: id,
    query: noParams,
    body: null,
  }),
  rejectRequest: op({
    method: 'POST',
    path: '/internal/v1/requests/{id}/reject',
    auth: 'staff',
    permission: 'backoffice.requests.decide',
    params: id,
    query: noParams,
    body: z.object({ reason }),
  }),
  cancelRequest: op({
    method: 'POST',
    path: '/internal/v1/requests/{id}/cancel',
    auth: 'staff',
    permission: 'backoffice.requests.read',
    params: id,
    query: noParams,
    body: null,
  }),
  listFlags: op({
    method: 'GET',
    path: '/internal/v1/flags',
    auth: 'staff',
    permission: 'backoffice.flags.read',
    params: noParams,
    query: noParams,
    body: null,
  }),
  updateFlag: op({
    method: 'PUT',
    path: '/internal/v1/flags/{key}',
    auth: 'staff',
    permission: 'backoffice.flags.edit',
    params: z.object({ key: slug }),
    query: noParams,
    body: FlagChangeInput,
  }),
  killFlag: op({
    method: 'POST',
    path: '/internal/v1/flags/{key}/kill',
    auth: 'staff',
    permission: 'backoffice.flags.edit',
    params: z.object({ key: slug }),
    query: noParams,
    body: z.object({ reason }),
  }),
  listCohorts: op({
    method: 'GET',
    path: '/internal/v1/cohorts',
    auth: 'staff',
    permission: 'backoffice.flags.read',
    params: noParams,
    query: noParams,
    body: null,
  }),
  createCohort: op({
    method: 'POST',
    path: '/internal/v1/cohorts',
    auth: 'staff',
    permission: 'backoffice.flags.edit',
    params: noParams,
    query: noParams,
    body: z.object({
      name: z.string().trim().min(2).max(60),
      description: z.string().trim().max(200).default(''),
    }),
  }),
  addCohortMember: op({
    method: 'POST',
    path: '/internal/v1/cohorts/{id}/members',
    auth: 'staff',
    permission: 'backoffice.flags.edit',
    params: id,
    query: noParams,
    body: z.object({ orgId: orgRef }),
  }),
  removeCohortMember: op({
    method: 'DELETE',
    path: '/internal/v1/cohorts/{id}/members/{orgId}',
    auth: 'staff',
    permission: 'backoffice.flags.edit',
    params: z.object({ id: uuid, orgId: orgRef }),
    query: noParams,
    body: null,
  }),
  listStaff: op({
    method: 'GET',
    path: '/internal/v1/staff',
    auth: 'staff',
    permission: 'backoffice.staff.read',
    params: noParams,
    query: noParams,
    body: null,
  }),
} as const;

export type InternalOperationId = keyof typeof internalOperations;
