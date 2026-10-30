// Typed calls to /internal/v1. Paths and methods come from the contract in @archova/contracts, so the console and
// the API cannot drift apart; every call is same-origin (the dev server or load balancer forwards /internal).
import {
  internalOperations,
  type CohortDto,
  type FlagChangeInput,
  type FlagDto,
  type InternalOperationId,
  type OrgDetailDto,
  type OrgListItemDto,
  type SuspendCategory,
  type SupportProjectDto,
  type Page,
  type PlanDraftInput,
  type PlanDto,
  type PriceBookDto,
  type PriceBookPreview,
  type PriceInput,
  type RequestDto,
  type RequestStatus,
  type StaffDto,
} from '@archova/contracts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors: Array<{ path: string; message: string }> = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface CallArgs {
  params?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

export async function call<T>(op: InternalOperationId, args: CallArgs = {}): Promise<T> {
  const def = internalOperations[op];
  let path: string = def.path.replace(/\{(\w+)\}/g, (_m, k: string) =>
    encodeURIComponent(args.params?.[k] ?? ''),
  );
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(args.query ?? {}))
    if (v !== undefined && v !== '') qs.set(k, String(v));
  if (qs.size) path += `?${qs}`;
  let res: Response;
  try {
    res = await fetch(path, {
      method: def.method,
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(args.body !== undefined || def.method !== 'GET'
          ? { 'content-type': 'application/json' }
          : {}),
      },
      ...(def.method !== 'GET' ? { body: JSON.stringify(args.body ?? {}) } : {}),
    });
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the console API. Is it running?');
  }
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const p = (json ?? {}) as {
      code?: string;
      detail?: string;
      title?: string;
      errors?: ApiError['fieldErrors'];
    };
    throw new ApiError(
      res.status,
      p.code ?? 'error',
      p.detail ?? p.title ?? `Request failed (${res.status})`,
      p.errors,
    );
  }
  return json as T;
}

export const api = {
  login: (body: { email: string; password: string }) => call<StaffDto>('login', { body }),
  logout: () => call<void>('logout'),
  stepUp: (password: string) => call<StaffDto>('stepUp', { body: { password } }),
  me: () => call<StaffDto>('getMe'),
  orgs: (query: { q?: string; cursor?: string; limit?: number }) =>
    call<Page<OrgListItemDto>>('listOrgs', { query }),
  org: (orgId: string) => call<OrgDetailDto>('getOrg', { params: { orgId } }),
  trialExtend: (orgId: string, body: { days: number; reason: string; ticketRef: string }) =>
    call<OrgDetailDto>('trialExtendOrg', { params: { orgId }, body }),
  changePlan: (orgId: string, body: { planCode: string; reason: string; ticketRef: string }) =>
    call<OrgDetailDto>('changeOrgPlan', { params: { orgId }, body }),
  suspend: (
    orgId: string,
    body: { category: SuspendCategory; reason: string; ticketRef: string },
  ) => call<OrgDetailDto>('suspendOrg', { params: { orgId }, body }),
  reactivate: (orgId: string, body: { reason: string; ticketRef: string }) =>
    call<OrgDetailDto>('reactivateOrg', { params: { orgId }, body }),
  startSupport: (orgId: string, body: { reason: string; ticketRef: string }) =>
    call<OrgDetailDto>('startSupportSession', { params: { orgId }, body }),
  endSupport: (orgId: string) => call<OrgDetailDto>('endSupportSession', { params: { orgId } }),
  supportProjects: (orgId: string) =>
    call<{ items: SupportProjectDto[] }>('listSupportProjects', { params: { orgId } }),
  plans: () => call<{ items: PlanDto[] }>('listPlans'),
  createPlan: (code: string, draft: PlanDraftInput) =>
    call<{ code: string }>('createPlan', { body: { code, draft } }),
  savePlanDraft: (code: string, draft: PlanDraftInput) =>
    call<void>('savePlanDraft', { params: { code }, body: draft }),
  discardPlanDraft: (code: string) => call<void>('discardPlanDraft', { params: { code } }),
  submitPlanDraft: (code: string, reason: string) =>
    call<RequestDto>('submitPlanDraft', { params: { code }, body: { reason } }),
  priceBooks: () => call<{ items: PriceBookDto[] }>('listPriceBooks'),
  createPriceBook: () => call<PriceBookDto>('createPriceBook'),
  savePriceBook: (id: string, body: { effectiveFrom: string | null; prices: PriceInput[] }) =>
    call<PriceBookDto>('savePriceBook', { params: { id }, body }),
  previewPriceBook: (id: string) => call<PriceBookPreview>('previewPriceBook', { params: { id } }),
  submitPriceBook: (id: string, reason: string) =>
    call<RequestDto>('submitPriceBook', { params: { id }, body: { reason } }),
  discardPriceBook: (id: string) => call<void>('discardPriceBook', { params: { id } }),
  requests: (query: { status?: RequestStatus; limit?: number } = {}) =>
    call<{ items: RequestDto[] }>('listRequests', { query }),
  approve: (id: string) => call<RequestDto>('approveRequest', { params: { id } }),
  reject: (id: string, reason: string) =>
    call<RequestDto>('rejectRequest', { params: { id }, body: { reason } }),
  cancel: (id: string) => call<RequestDto>('cancelRequest', { params: { id } }),
  flags: () => call<{ items: FlagDto[] }>('listFlags'),
  updateFlag: (key: string, body: FlagChangeInput) =>
    call<{ items: FlagDto[] }>('updateFlag', { params: { key }, body }),
  killFlag: (key: string, reason: string) =>
    call<{ items: FlagDto[] }>('killFlag', { params: { key }, body: { reason } }),
  cohorts: () => call<{ items: CohortDto[] }>('listCohorts'),
  createCohort: (body: { name: string; description: string }) =>
    call<CohortDto>('createCohort', { body }),
  addCohortMember: (id: string, orgId: string) =>
    call<{ items: CohortDto[] }>('addCohortMember', { params: { id }, body: { orgId } }),
  removeCohortMember: (id: string, orgId: string) =>
    call<void>('removeCohortMember', { params: { id, orgId } }),
  staff: () =>
    call<{
      items: Array<{
        id: string;
        email: string;
        name: string;
        status: string;
        roles: string[];
        createdAt: string;
      }>;
    }>('listStaff'),
};
