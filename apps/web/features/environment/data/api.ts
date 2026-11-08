import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';
import { uploadFile } from '@/shared/lib/uploads';
import type {
  Condition,
  ConditionDetail,
  EnvironmentDocument,
  MonitoringPoint,
  Plan,
  Reading,
  Summary,
} from '../lib/types';
import type { EnvironmentSource } from './source';

type ApiCondition = components['schemas']['EnvironmentCondition'];
type ApiDetail = components['schemas']['EnvironmentConditionDetail'];
type ApiDocument = components['schemas']['EnvironmentDocument'];
type ApiPlan = components['schemas']['EnvironmentPlan'];
type ApiSummary = components['schemas']['EnvironmentSummary'];
type ApiReading = components['schemas']['MonitoringReading'];
type ApiPoint = components['schemas']['MonitoringPoint'];

const P = '/v1/orgs/{orgId}/projects/{projectId}/environment' as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export const toCondition = (c: ApiCondition): Condition => ({
  id: c.id,
  numberLabel: c.numberLabel,
  title: c.title,
  requirement: c.requirement,
  category: c.category,
  source: c.source,
  sourceReference: c.sourceReference,
  frequency: c.frequency,
  responsibleCompanyId: c.responsibleCompanyId,
  status: c.status,
  dueDate: c.dueDate,
  lastReviewedOn: c.lastReviewedOn,
  isOverdue: c.isOverdue,
  evidenceCount: c.fileIds.length,
  availableActions: c.availableActions,
  version: c.version,
});

export const toDetail = (d: ApiDetail): ConditionDetail => ({
  condition: toCondition(d.condition),
  events: d.events.map((e) => ({
    id: e.id,
    action: e.action,
    toStatus: e.toStatus,
    note: e.note,
    evidenceCount: e.fileIds.length,
    at: e.at,
  })),
});

export const toPlan = (p: ApiPlan): Plan => ({
  title: p.title,
  permitReference: p.permitReference,
  summary: p.summary,
  status: p.status,
  reviewIntervalMonths: p.reviewIntervalMonths,
  nextReviewDate: p.nextReviewDate,
  approvedAt: p.approvedAt,
  version: p.version,
});

export const toDocument = (d: ApiDocument): EnvironmentDocument => ({
  id: d.id,
  title: d.title,
  docType: d.docType,
  reference: d.reference,
  issuedOn: d.issuedOn,
  expiresOn: d.expiresOn,
  expiry: d.expiry,
  version: d.version,
});

export const toReading = (r: ApiReading): Reading => ({
  id: r.id,
  pointId: r.pointId,
  pointName: r.pointName,
  unit: r.unit,
  value: r.value,
  takenAt: r.takenAt,
  status: r.status,
  note: r.note,
  evidenceCount: r.fileIds.length,
  responseNote: r.responseNote,
  respondedAt: r.respondedAt,
  incidentId: r.incidentId,
});

export const toPoint = (p: ApiPoint): MonitoringPoint => ({
  id: p.id,
  name: p.name,
  parameter: p.parameter,
  unit: p.unit,
  location: p.location,
  minLimit: p.minLimit,
  maxLimit: p.maxLimit,
  warnMargin: p.warnMargin,
  frequency: p.frequency,
  conditionId: p.conditionId,
  active: p.active,
  latest: p.latest ? toReading(p.latest) : null,
  recent: p.recent,
  openBreaches: p.openBreaches,
  isOverdue: p.isOverdue,
  isTrending: p.isTrending,
  version: p.version,
});

const toSummary = (s: ApiSummary): Summary => ({
  plan: s.plan ? toPlan(s.plan) : null,
  conditions: s.conditions,
  documents: s.documents,
  monitoring: s.monitoring,
  flags: s.flags.map((f) => ({ code: f.code, severity: f.severity, message: f.message })),
});

/** The live source. Reads the first 200 conditions; filters are applied by the API. */
export function createEnvironmentApi(orgId: string): EnvironmentSource {
  const path = (projectId: string) => ({ orgId, projectId });
  return {
    async summary(projectId) {
      return toSummary(
        unwrap(await api.GET(`${P}/summary`, { params: { path: path(projectId) } })),
      );
    },
    async listConditions(projectId, f) {
      const r = unwrap(
        await api.GET(`${P}/conditions`, {
          params: {
            path: path(projectId),
            query: {
              status: f.status,
              category: f.category,
              overdue: f.overdue === undefined ? undefined : f.overdue ? 'true' : 'false',
              limit: 200,
            },
          },
        }),
      );
      return r.data.map(toCondition);
    },
    async getCondition(projectId, id) {
      return toDetail(
        unwrap(
          await api.GET(`${P}/conditions/{conditionId}`, {
            params: { path: { ...path(projectId), conditionId: id } },
          }),
        ),
      );
    },
    async createCondition(projectId, input) {
      return toDetail(
        unwrap(
          await api.POST(`${P}/conditions`, {
            params: { path: path(projectId), header: idempotencyKey() },
            body: input,
          }),
        ),
      ).condition;
    },
    async applyStarterPack(projectId) {
      const r = unwrap(
        await api.POST(`${P}/conditions/starter-pack`, {
          params: { path: path(projectId), header: idempotencyKey() },
        }),
      );
      return { created: r.created.length, skipped: r.skipped };
    },
    async transition(projectId, c, t) {
      const fileIds: string[] = [];
      for (const file of t.files ?? []) {
        fileIds.push((await uploadFile(orgId, { file, projectId, module: 'environment' })).id);
      }
      return toDetail(
        unwrap(
          await api.POST(`${P}/conditions/{conditionId}/transition`, {
            params: {
              path: { ...path(projectId), conditionId: c.id },
              header: ifMatch(c.version),
            },
            body: {
              action: t.action,
              ...(t.note ? { note: t.note } : {}),
              ...(fileIds.length ? { fileIds } : {}),
            },
          }),
        ),
      ).condition;
    },
    async listDocuments(projectId) {
      const r = unwrap(await api.GET(`${P}/documents`, { params: { path: path(projectId) } }));
      return r.data.map(toDocument);
    },
    async createDocument(projectId, input) {
      const stored = await uploadFile(orgId, {
        file: input.file,
        projectId,
        module: 'environment',
      });
      return toDocument(
        unwrap(
          await api.POST(`${P}/documents`, {
            params: { path: path(projectId), header: idempotencyKey() },
            body: {
              title: input.title,
              docType: input.docType,
              fileId: stored.id,
              ...(input.reference ? { reference: input.reference } : {}),
              ...(input.issuedOn ? { issuedOn: input.issuedOn } : {}),
              ...(input.expiresOn ? { expiresOn: input.expiresOn } : {}),
            },
          }),
        ),
      );
    },
    async deleteDocument(projectId, d) {
      unwrap(
        await api.DELETE(`${P}/documents/{environmentDocumentId}`, {
          params: { path: { ...path(projectId), environmentDocumentId: d.id } },
        }),
      );
    },
    async createPlan(projectId, input) {
      return toPlan(
        unwrap(
          await api.POST(`${P}/plan`, {
            params: { path: path(projectId), header: idempotencyKey() },
            body: input,
          }),
        ),
      );
    },
    async approvePlan(projectId, plan) {
      return toPlan(
        unwrap(
          await api.POST(`${P}/plan/approve`, {
            params: { path: path(projectId), header: ifMatch(plan.version) },
          }),
        ),
      );
    },
    async listPoints(projectId) {
      const r = unwrap(
        await api.GET(`${P}/monitoring-points`, { params: { path: path(projectId) } }),
      );
      return r.data.map(toPoint);
    },
    async createPoint(projectId, input) {
      return toPoint(
        unwrap(
          await api.POST(`${P}/monitoring-points`, {
            params: { path: path(projectId), header: idempotencyKey() },
            body: input,
          }),
        ),
      );
    },
    async logReading(projectId, point, input) {
      const fileIds: string[] = [];
      for (const file of input.files ?? []) {
        fileIds.push((await uploadFile(orgId, { file, projectId, module: 'environment' })).id);
      }
      return toReading(
        unwrap(
          await api.POST(`${P}/monitoring-points/{pointId}/readings`, {
            params: {
              path: { ...path(projectId), pointId: point.id },
              header: idempotencyKey(),
            },
            body: {
              value: input.value,
              ...(input.note ? { note: input.note } : {}),
              ...(fileIds.length ? { fileIds } : {}),
            },
          }),
        ),
      );
    },
    async listReadings(projectId, f) {
      const r = unwrap(
        await api.GET(`${P}/readings`, {
          params: {
            path: path(projectId),
            query: {
              status: f.status,
              open: f.open === undefined ? undefined : f.open ? 'true' : 'false',
              limit: 100,
            },
          },
        }),
      );
      return r.data.map(toReading);
    },
    async respond(projectId, reading, input) {
      const r = unwrap(
        await api.POST(`${P}/readings/{readingId}/respond`, {
          params: { path: { ...path(projectId), readingId: reading.id } },
          body: input,
        }),
      );
      return { reading: toReading(r.reading), incidentNumber: r.incidentNumber };
    },
  };
}
