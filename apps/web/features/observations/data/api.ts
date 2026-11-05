import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';
import type { Observation } from '../lib/types';
import type { ObservationsSource } from './source';

type ApiObservation = components['schemas']['Observation'];

const P = '/v1/orgs/{orgId}/projects/{projectId}/observations' as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export const toObservation = (o: ApiObservation): Observation => ({
  id: o.id,
  numberLabel: o.numberLabel,
  type: o.type,
  hazard: o.hazard,
  description: o.description,
  location: o.location,
  priority: o.priority,
  assigneeCompanyId: o.assigneeCompanyId,
  raisedByCompanyId: o.raisedByCompanyId,
  status: o.status,
  dueDate: o.dueDate,
  isOverdue: o.isOverdue,
  swmsId: o.swmsId,
  resolutionNote: o.resolutionNote,
  availableActions: o.availableActions,
  createdAt: o.createdAt,
  version: o.version,
});

/** The live source. Reads the first 100 observations; filters are applied by the API. */
export function createObservationsApi(orgId: string): ObservationsSource {
  return {
    async list(projectId, f) {
      const r = unwrap(
        await api.GET(P, {
          params: {
            path: { orgId, projectId },
            query: {
              status: f.status,
              type: f.type,
              priority: f.priority,
              assigneeCompanyId: f.assigneeCompanyId,
              overdue: f.overdue === undefined ? undefined : f.overdue ? 'true' : 'false',
              limit: 100,
            },
          },
        }),
      );
      return r.data.map(toObservation);
    },
    async create(projectId, input) {
      return toObservation(
        unwrap(
          await api.POST(P, {
            params: { path: { orgId, projectId }, header: idempotencyKey() },
            body: input,
          }),
        ),
      );
    },
    async transition(projectId, o, t) {
      return toObservation(
        unwrap(
          await api.POST(`${P}/{observationId}/transition`, {
            params: {
              path: { orgId, projectId, observationId: o.id },
              header: ifMatch(o.version),
            },
            body: { action: t.action, ...(t.reason ? { reason: t.reason } : {}) },
          }),
        ),
      );
    },
  };
}
