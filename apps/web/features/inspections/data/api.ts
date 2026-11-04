import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';
import type {
  Answer,
  Inspection,
  InspectionDetail,
  Template,
  TemplateDetail,
  TemplateItem,
} from '../lib/types';
import type { InspectionsSource } from './source';

type ApiTemplate = components['schemas']['InspectionTemplate'];
type ApiItem = components['schemas']['InspectionTemplateItem'];
type ApiTemplateDetail = components['schemas']['InspectionTemplateDetail'];
type ApiInspection = components['schemas']['Inspection'];
type ApiDetail = components['schemas']['InspectionDetail'];

const T = '/v1/orgs/{orgId}/projects/{projectId}/inspection-templates' as const;
const I = '/v1/orgs/{orgId}/projects/{projectId}/inspections' as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export const toTemplate = (t: ApiTemplate): Template => ({
  id: t.id,
  name: t.name,
  type: t.type,
  version: t.version,
  published: t.published,
});

const toItem = (i: ApiItem): TemplateItem => ({
  id: i.id,
  section: i.section,
  prompt: i.prompt,
  responseType: i.responseType,
  options: i.options,
  required: i.required,
  createsDefectOnFail: i.createsDefectOnFail,
});

export const toTemplateDetail = (d: ApiTemplateDetail): TemplateDetail => ({
  template: toTemplate(d.template),
  items: d.items.map(toItem),
});

export const toInspection = (i: ApiInspection): Inspection => ({
  id: i.id,
  numberLabel: i.numberLabel,
  templateId: i.templateId,
  templateVersion: i.templateVersion,
  title: i.title,
  location: i.location,
  status: i.status,
  scheduledFor: i.scheduledFor,
  signedByName: i.signedBy?.name ?? null,
  version: i.version,
});

export const toDetail = (d: ApiDetail): InspectionDetail => ({
  inspection: toInspection(d.inspection),
  items: d.items.map(toItem),
  responses: d.responses.map((r): Answer => ({
    templateItemId: r.templateItemId,
    value: r.value,
    result: r.result,
    note: r.note,
  })),
  missingRequiredItemIds: d.missingRequiredItemIds,
  failedItemIds: d.failedItemIds,
});

/** The live source. Reads the first 100 inspections; the status filter is applied by the API. */
export function createInspectionsApi(orgId: string): InspectionsSource {
  const path = (projectId: string) => ({ orgId, projectId });
  return {
    async templates(projectId) {
      const r = unwrap(await api.GET(T, { params: { path: path(projectId) } }));
      return r.data.map(toTemplate);
    },
    async template(projectId, id) {
      return toTemplateDetail(
        unwrap(
          await api.GET(`${T}/{templateId}`, {
            params: { path: { ...path(projectId), templateId: id } },
          }),
        ),
      );
    },
    async createTemplate(projectId, input) {
      return toTemplateDetail(
        unwrap(
          await api.POST(T, {
            params: { path: path(projectId), header: idempotencyKey() },
            body: input,
          }),
        ),
      );
    },
    async publishTemplate(projectId, id) {
      return toTemplateDetail(
        unwrap(
          await api.POST(`${T}/{templateId}/publish`, {
            params: { path: { ...path(projectId), templateId: id } },
          }),
        ),
      );
    },
    async newVersion(projectId, id) {
      return toTemplateDetail(
        unwrap(
          await api.POST(`${T}/{templateId}/versions`, {
            params: { path: { ...path(projectId), templateId: id } },
          }),
        ),
      );
    },
    async list(projectId, f) {
      const r = unwrap(
        await api.GET(I, {
          params: { path: path(projectId), query: { status: f.status, limit: 100 } },
        }),
      );
      return r.data.map(toInspection);
    },
    async get(projectId, id) {
      return toDetail(
        unwrap(
          await api.GET(`${I}/{inspectionId}`, {
            params: { path: { ...path(projectId), inspectionId: id } },
          }),
        ),
      );
    },
    async start(projectId, input) {
      return toDetail(
        unwrap(
          await api.POST(I, {
            params: { path: path(projectId), header: idempotencyKey() },
            body: input,
          }),
        ),
      );
    },
    async record(projectId, id, answers) {
      return toDetail(
        unwrap(
          await api.PUT(`${I}/{inspectionId}/responses`, {
            params: { path: { ...path(projectId), inspectionId: id } },
            body: { responses: answers },
          }),
        ),
      );
    },
    async submit(projectId, d, signedByName) {
      return toDetail(
        unwrap(
          await api.POST(`${I}/{inspectionId}/submit`, {
            params: {
              path: { ...path(projectId), inspectionId: d.inspection.id },
              header: ifMatch(d.inspection.version),
            },
            body: { signedByName },
          }),
        ),
      );
    },
    async close(projectId, d) {
      return toDetail(
        unwrap(
          await api.POST(`${I}/{inspectionId}/close`, {
            params: {
              path: { ...path(projectId), inspectionId: d.inspection.id },
              header: ifMatch(d.inspection.version),
            },
          }),
        ),
      );
    },
  };
}
