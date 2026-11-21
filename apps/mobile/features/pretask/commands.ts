// Pre-task plans on the phone (safety `pretask-plans`). Reads here need a connection; saving a plan does not: it is
// kept on the phone and sent when the signal returns (see lib/actions/pretask-send.ts).
import { unwrap, type ApiClient } from '@archova/api-client';
import type { HazardSuggestion } from './nova';

export interface PretaskTarget {
  orgId: string;
  projectId: string;
}

const path = (t: PretaskTarget) => ({ orgId: t.orgId, projectId: t.projectId });

/** Plans for one work date (today's), newest first. */
export async function listPlansFor(api: ApiClient, t: PretaskTarget, workDate: string) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/pretask-plans', {
      params: { path: path(t), query: { limit: 50, workDate } as never },
    }),
  ).data;
}

/** The newest plans on the project, to start today's from. */
export async function listRecentPlans(api: ApiClient, t: PretaskTarget) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/pretask-plans', {
      params: { path: path(t), query: { limit: 10 } },
    }),
  ).data;
}

/** Nova's suggestions from this project's history. Nothing is created. */
export async function suggestHazards(
  api: ApiClient,
  t: PretaskTarget,
  swmsId?: string,
): Promise<HazardSuggestion[]> {
  const r = unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/pretask-plans/suggestions', {
      params: { path: path(t), query: swmsId ? { swmsId } : {} },
    } as never),
  ) as { data: { hazard: string; controls: string; riskBefore: never; because: string }[] };
  return r.data.map((s) => ({
    hazard: s.hazard,
    controls: s.controls,
    riskBefore: s.riskBefore,
    because: s.because,
  }));
}

export async function listSwmsOptions(api: ApiClient, t: PretaskTarget) {
  const r = unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/swms', {
      params: { path: path(t), query: { limit: 100 } as never },
    }),
  ) as { data: { id: string; numberLabel: string; title: string; status: string }[] };
  return r.data.map((s) => ({ id: s.id, label: `${s.numberLabel} ${s.title}` }));
}

export async function getPlanDetail(api: ApiClient, t: PretaskTarget, planId: string) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/pretask-plans/{planId}', {
      params: { path: { ...path(t), planId } },
    } as never),
  ) as {
    plan: {
      workDate: string;
      taskTitle: string;
      supervisorName: string;
      location: string | null;
      companyId: string | null;
      swmsId: string | null;
      hazards: { hazard: string; riskBefore: string; controls: string; riskAfter: string }[];
    };
    crew: { personName: string; companyId: string | null }[];
  };
}
