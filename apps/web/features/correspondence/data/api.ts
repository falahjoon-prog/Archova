// Correspondence against the correspondence module's endpoints (product/08 SCH-AC5, product/03). People and
// companies come back as ids; screens name them from the project directory.

import { unwrap } from '@archova/api-client';
import { api, ensureCsrfToken } from '@/shared/lib/api';
import { allPages } from '@/shared/lib/data-mode';
import { uploadFile } from '@/shared/lib/uploads';
import type {
  CorrespondenceDetail,
  CorrespondenceFilters,
  CorrespondenceInput,
  CorrespondenceItem,
  CorrespondenceTemplate,
  CorrespondenceType,
} from '../lib/types';

const P = '/v1/orgs/{orgId}/projects/{projectId}/correspondence' as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });
const unavailable = async (): Promise<never> => {
  throw new Error('Correspondence is not available in the sample-data preview.');
};

export interface CorrespondenceSource {
  projectTypes(projectId: string): Promise<CorrespondenceType[]>;
  orgTypes(): Promise<CorrespondenceType[]>;
  templates(): Promise<CorrespondenceTemplate[]>;
  addType(templateKey: string): Promise<CorrespondenceType>;
  archiveType(type: CorrespondenceType): Promise<CorrespondenceType>;
  list(projectId: string, f?: CorrespondenceFilters): Promise<CorrespondenceItem[]>;
  get(projectId: string, id: string): Promise<CorrespondenceDetail>;
  create(projectId: string, input: CorrespondenceInput): Promise<CorrespondenceDetail>;
  update(
    projectId: string,
    id: string,
    version: number,
    input: Partial<Pick<CorrespondenceInput, 'subject' | 'body' | 'toCompanyIds' | 'eventDate'>>,
  ): Promise<CorrespondenceDetail>;
  send(projectId: string, id: string, version: number): Promise<CorrespondenceDetail>;
  respond(
    projectId: string,
    id: string,
    input: { body: string; files: File[] },
  ): Promise<CorrespondenceDetail>;
  close(projectId: string, id: string, version: number): Promise<CorrespondenceDetail>;
  voidItem(
    projectId: string,
    id: string,
    version: number,
    reason: string,
  ): Promise<CorrespondenceDetail>;
}

/** Shown while the screens run on sample data: there is no preview register, so it starts empty. */
export const correspondencePreview: CorrespondenceSource = {
  projectTypes: async () => [],
  orgTypes: async () => [],
  templates: async () => [],
  list: async () => [],
  addType: unavailable,
  archiveType: unavailable,
  get: unavailable,
  create: unavailable,
  update: unavailable,
  send: unavailable,
  respond: unavailable,
  close: unavailable,
  voidItem: unavailable,
};

export function createCorrespondenceApi(orgId: string): CorrespondenceSource {
  const path = (projectId: string, correspondenceId: string) => ({
    orgId,
    projectId,
    correspondenceId,
  });

  return {
    projectTypes: async (projectId) =>
      unwrap(
        await api.GET('/v1/orgs/{orgId}/projects/{projectId}/correspondence-types', {
          params: { path: { orgId, projectId } },
        }),
      ).data,
    orgTypes: async () =>
      unwrap(
        await api.GET('/v1/orgs/{orgId}/correspondence-types', {
          params: { path: { orgId }, query: { includeArchived: 'true' } },
        }),
      ).data,
    templates: async () =>
      unwrap(
        await api.GET('/v1/orgs/{orgId}/correspondence-templates', {
          params: { path: { orgId } },
        }),
      ).data,
    addType: async (templateKey) => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/correspondence-types', {
          params: { path: { orgId }, header: idempotencyKey() },
          body: { templateKey },
        }),
      );
    },
    archiveType: async (type) => {
      await ensureCsrfToken();
      return unwrap(
        await api.PATCH('/v1/orgs/{orgId}/correspondence-types/{typeId}', {
          params: { path: { orgId, typeId: type.id }, header: ifMatch(type.version) },
          body: { archived: !type.archived },
        }),
      );
    },
    list: (projectId, f = {}) =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET(P, {
            params: {
              path: { orgId, projectId },
              query: {
                limit: 200,
                cursor,
                ...(f.status ? { status: f.status } : {}),
                ...(f.typeId ? { typeId: f.typeId } : {}),
                ...(f.awaitingResponse ? { awaitingResponse: 'true' as const } : {}),
                ...(f.q?.trim() ? { q: f.q.trim() } : {}),
              },
            },
          }),
        ),
      ),
    get: async (projectId, id) =>
      unwrap(await api.GET(`${P}/{correspondenceId}`, { params: { path: path(projectId, id) } })),
    create: async (projectId, input) => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(P, {
          params: { path: { orgId, projectId }, header: idempotencyKey() },
          body: {
            typeId: input.typeId,
            toCompanyIds: input.toCompanyIds,
            ...(input.subject.trim() ? { subject: input.subject.trim() } : {}),
            ...(input.body.trim() ? { body: input.body } : {}),
            ...(input.eventDate ? { eventDate: input.eventDate } : {}),
          },
        }),
      );
    },
    update: async (projectId, id, version, input) => {
      await ensureCsrfToken();
      return unwrap(
        await api.PATCH(`${P}/{correspondenceId}`, {
          params: { path: path(projectId, id), header: ifMatch(version) },
          body: {
            ...(input.subject !== undefined ? { subject: input.subject } : {}),
            ...(input.body !== undefined ? { body: input.body } : {}),
            ...(input.toCompanyIds !== undefined ? { toCompanyIds: input.toCompanyIds } : {}),
            ...(input.eventDate !== undefined ? { eventDate: input.eventDate || null } : {}),
          },
        }),
      );
    },
    send: async (projectId, id, version) => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${P}/{correspondenceId}/send`, {
          params: { path: path(projectId, id), header: ifMatch(version) },
        }),
      );
    },
    respond: async (projectId, id, input) => {
      await ensureCsrfToken();
      const fileIds = await Promise.all(
        input.files.map(
          async (file) =>
            (await uploadFile(orgId, { file, projectId, module: 'correspondence' })).id,
        ),
      );
      return unwrap(
        await api.POST(`${P}/{correspondenceId}/responses`, {
          params: { path: path(projectId, id) },
          body: { body: input.body.trim(), ...(fileIds.length ? { fileIds } : {}) },
        }),
      );
    },
    close: async (projectId, id, version) => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${P}/{correspondenceId}/close`, {
          params: { path: path(projectId, id), header: ifMatch(version) },
        }),
      );
    },
    voidItem: async (projectId, id, version, reason) => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${P}/{correspondenceId}/void`, {
          params: { path: path(projectId, id), header: ifMatch(version) },
          body: { reason: reason.trim() },
        }),
      );
    },
  };
}
