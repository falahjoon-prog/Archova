import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';
import type { Swms, SwmsDetail } from '../lib/types';
import type { SwmsSource } from './source';

type ApiSwms = components['schemas']['Swms'];
type ApiDetail = components['schemas']['SwmsDetail'];

const P = '/v1/orgs/{orgId}/projects/{projectId}/swms' as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export const toSwms = (s: ApiSwms): Swms => ({
  id: s.id,
  numberLabel: s.numberLabel,
  title: s.title,
  companyId: s.companyId,
  categories: s.highRiskWorkCategories,
  workDescription: s.content.workDescription ?? '',
  hazardsAndRisks: s.content.hazardsAndRisks ?? '',
  controlMeasures: s.content.controlMeasures ?? [],
  implementation: s.content.implementation ?? '',
  siteSpecific: s.content.siteSpecific ?? '',
  revision: s.revision,
  status: s.status,
  expiresOn: s.expiresOn,
  isExpired: s.isExpired,
  version: s.version,
});

export const toDetail = (d: ApiDetail): SwmsDetail => ({
  swms: toSwms(d.swms),
  events: d.events.map((e) => ({
    id: e.id,
    action: e.action,
    toStatus: e.toStatus,
    revision: e.revision,
    note: e.note,
    at: e.at,
  })),
  acknowledgements: d.acknowledgements.map((a) => ({
    workerName: a.workerName,
    revision: a.revision,
    at: a.at,
  })),
  gaps: d.gaps,
  advisories: d.advisories,
  availableActions: d.availableActions,
});

/** The live source. Reads the first 100 SWMS; the status filter is applied by the API. */
export function createSwmsApi(orgId: string): SwmsSource {
  return {
    async list(projectId, f) {
      const r = unwrap(
        await api.GET(P, {
          params: { path: { orgId, projectId }, query: { status: f.status, limit: 100 } },
        }),
      );
      return r.data.map(toSwms);
    },
    async get(projectId, id) {
      return toDetail(
        unwrap(
          await api.GET(`${P}/{swmsId}`, { params: { path: { orgId, projectId, swmsId: id } } }),
        ),
      );
    },
    async create(projectId, input) {
      const content = {
        ...(input.workDescription ? { workDescription: input.workDescription } : {}),
        ...(input.hazardsAndRisks ? { hazardsAndRisks: input.hazardsAndRisks } : {}),
        ...(input.controlMeasures?.length ? { controlMeasures: input.controlMeasures } : {}),
        ...(input.implementation ? { implementation: input.implementation } : {}),
        ...(input.siteSpecific ? { siteSpecific: input.siteSpecific } : {}),
        ...(input.whsPlanConsidered ? { whsPlanConsidered: input.whsPlanConsidered } : {}),
        ...(input.fallControlsConsidered
          ? { fallControlsConsidered: input.fallControlsConsidered }
          : {}),
      };
      return toDetail(
        unwrap(
          await api.POST(P, {
            params: { path: { orgId, projectId }, header: idempotencyKey() },
            body: {
              title: input.title,
              highRiskWorkCategories: input.categories,
              ...(input.companyId ? { companyId: input.companyId } : {}),
              ...(input.expiresOn ? { expiresOn: input.expiresOn } : {}),
              ...(Object.keys(content).length ? { content } : {}),
            },
          }),
        ),
      );
    },
    async transition(projectId, d, t) {
      return toDetail(
        unwrap(
          await api.POST(`${P}/{swmsId}/transition`, {
            params: {
              path: { orgId, projectId, swmsId: d.swms.id },
              header: ifMatch(d.swms.version),
            },
            body: {
              action: t.action,
              ...(t.reason ? { reason: t.reason } : {}),
              ...(t.confirmedUnderstandable ? { confirmedUnderstandable: true } : {}),
            },
          }),
        ),
      );
    },
    async acknowledge(projectId, d, workerName) {
      return toDetail(
        unwrap(
          await api.POST(`${P}/{swmsId}/acknowledge`, {
            params: { path: { orgId, projectId, swmsId: d.swms.id } },
            body: { workerName },
          }),
        ),
      );
    },
  };
}
