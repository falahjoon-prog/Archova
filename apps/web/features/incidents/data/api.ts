import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';
import type { CorrectiveAction, Incident, IncidentDetail } from '../lib/types';
import type { IncidentSource } from './source';

type ApiIncident = components['schemas']['Incident'];
type ApiAction = components['schemas']['IncidentAction'];
type ApiDetail = components['schemas']['IncidentDetail'];

const P = '/v1/orgs/{orgId}/projects/{projectId}/incidents' as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export const toIncident = (i: ApiIncident): Incident => ({
  id: i.id,
  numberLabel: i.numberLabel,
  title: i.title,
  type: i.type,
  severity: i.severity,
  occurredAt: i.occurredAt,
  location: i.location,
  description: i.description,
  immediateActions: i.immediateActions,
  isNotifiable: i.isNotifiable,
  notifiableClass: i.notifiableClass,
  regulatorNotifiedAt: i.regulatorNotifiedAt,
  writtenNoticeRequestedAt: i.writtenNoticeRequestedAt,
  writtenNoticeDueAt: i.writtenNoticeDueAt,
  keepUntil: i.keepUntil,
  rootCause: i.rootCause,
  status: i.status,
  openActions: i.openActions,
  version: i.version,
});

const toAction = (a: ApiAction): CorrectiveAction => ({
  id: a.id,
  number: a.number,
  title: a.title,
  description: a.description,
  assigneeCompanyId: a.assigneeCompanyId,
  dueDate: a.dueDate,
  source: a.source,
  status: a.status,
  isOverdue: a.isOverdue,
  version: a.version,
});

export const toDetail = (d: ApiDetail): IncidentDetail => ({
  incident: toIncident(d.incident),
  people: d.people.map((p) => ({
    id: p.id,
    personName: p.personName,
    companyId: p.companyId,
    role: p.role,
    injury: p.injury,
  })),
  injuryHidden: d.injuryHidden,
  photoFileIds: d.photoFileIds,
  actions: d.actions.map(toAction),
  events: d.events.map((e) => ({
    id: e.id,
    action: e.action,
    toStatus: e.toStatus,
    note: e.note,
    at: e.at,
  })),
  closeBlockers: d.closeBlockers,
  canManage: d.canManage,
});

/** The live source. Reads the first 100 incidents; the filters are applied by the API. */
export function createIncidentsApi(orgId: string): IncidentSource {
  const get = async (projectId: string, id: string) =>
    toDetail(
      unwrap(
        await api.GET(`${P}/{incidentId}`, {
          params: { path: { orgId, projectId, incidentId: id } },
        }),
      ),
    );
  return {
    async list(projectId, f) {
      const r = unwrap(
        await api.GET(P, {
          params: {
            path: { orgId, projectId },
            query: { status: f.status, type: f.type, limit: 100 },
          },
        }),
      );
      return r.data.map(toIncident);
    },
    get,
    async report(projectId, input) {
      return toDetail(
        unwrap(
          await api.POST(P, {
            params: { path: { orgId, projectId }, header: idempotencyKey() },
            body: {
              title: input.title,
              type: input.type,
              occurredAt: input.occurredAt,
              ...(input.location ? { location: input.location } : {}),
              ...(input.description ? { description: input.description } : {}),
              ...(input.immediateActions ? { immediateActions: input.immediateActions } : {}),
              ...(input.people?.length ? { people: input.people } : {}),
            },
          }),
        ),
      );
    },
    async classify(projectId, d, input) {
      return toDetail(
        unwrap(
          await api.PATCH(`${P}/{incidentId}`, {
            params: {
              path: { orgId, projectId, incidentId: d.incident.id },
              header: ifMatch(d.incident.version),
            },
            body: {
              severity: input.severity,
              isNotifiable: input.isNotifiable,
              notifiableClass: input.isNotifiable ? input.notifiableClass : null,
              regulatorNotifiedAt: input.regulatorNotifiedAt,
              writtenNoticeRequestedAt: input.writtenNoticeRequestedAt,
              rootCause: input.rootCause,
            },
          }),
        ),
      );
    },
    async transition(projectId, d, t) {
      return toDetail(
        unwrap(
          await api.POST(`${P}/{incidentId}/transition`, {
            params: {
              path: { orgId, projectId, incidentId: d.incident.id },
              header: ifMatch(d.incident.version),
            },
            body: { action: t.action, ...(t.reason ? { reason: t.reason } : {}) },
          }),
        ),
      );
    },
    async addAction(projectId, d, input) {
      return toDetail(
        unwrap(
          await api.POST(`${P}/{incidentId}/actions`, {
            params: {
              path: { orgId, projectId, incidentId: d.incident.id },
              header: idempotencyKey(),
            },
            body: {
              title: input.title,
              ...(input.description ? { description: input.description } : {}),
              ...(input.assigneeCompanyId ? { assigneeCompanyId: input.assigneeCompanyId } : {}),
              ...(input.dueDate ? { dueDate: input.dueDate } : {}),
              ...(input.source ? { source: input.source } : {}),
            },
          }),
        ),
      );
    },
    async setActionStatus(projectId, d, actionId, status) {
      const current = d.actions.find((a) => a.id === actionId);
      unwrap(
        await api.PATCH(`${P}/{incidentId}/actions/{actionId}`, {
          params: {
            path: { orgId, projectId, incidentId: d.incident.id, actionId },
            header: ifMatch(current?.version ?? 1),
          },
          body: { status },
        }),
      );
      return get(projectId, d.incident.id);
    },
    async sourceOptions(projectId) {
      const path = { orgId, projectId };
      const [ins, obs] = await Promise.all([
        api.GET('/v1/orgs/{orgId}/projects/{projectId}/inspections', {
          params: { path, query: { limit: 100 } },
        }),
        api.GET('/v1/orgs/{orgId}/projects/{projectId}/observations', {
          params: { path, query: { limit: 100 } },
        }),
      ]);
      return [
        ...unwrap(ins).data.map((i) => ({
          type: 'inspection' as const,
          id: i.id,
          label: `${i.numberLabel} · ${i.title}`,
        })),
        ...unwrap(obs).data.map((o) => ({
          type: 'observation' as const,
          id: o.id,
          label: `${o.numberLabel} · ${o.description.slice(0, 60)}`,
        })),
      ];
    },
    async fromSource(projectId, source) {
      const r = unwrap(
        await api.GET('/v1/orgs/{orgId}/projects/{projectId}/incident-actions', {
          params: {
            path: { orgId, projectId },
            query: { sourceType: source.type, sourceId: source.id },
          },
        }),
      );
      return r.data.map((x) => ({
        action: toAction(x.action),
        incidentId: x.incidentId,
        incidentNumberLabel: x.incidentNumberLabel,
        incidentTitle: x.incidentTitle,
      }));
    },
  };
}
