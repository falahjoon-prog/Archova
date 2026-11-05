import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api, ensureCsrfToken } from '@/shared/lib/api';
import { uploadFile } from '@/shared/lib/uploads';

type S = components['schemas'];
export type ImportJob = S['ImportJob'];
export type ImportRow = S['ImportRow'];
export type ImportEntity = S['ImportEntity'];
export type ImportSource = S['ImportSource'];
export type ImportRowStatus = S['ImportRowStatus'];
export type MappingSuggestion = S['NovaImportMapping'];
export type MappingField = MappingSuggestion['fields'][number];

export interface MappingInput {
  columns: Record<string, number>;
  values: Record<string, Record<string, string>>;
}
export interface StartImportInput {
  file: File;
  entity: ImportEntity;
  source: ImportSource;
  headerRow: number;
}

const P = '/v1/orgs/{orgId}/projects/{projectId}/import-jobs' as const;
const J = '/v1/orgs/{orgId}/projects/{projectId}/import-jobs/{importJobId}' as const;
const PARSE = '/v1/orgs/{orgId}/projects/{projectId}/import-jobs/{importJobId}/parse' as const;
const MAPPING = '/v1/orgs/{orgId}/projects/{projectId}/import-jobs/{importJobId}/mapping' as const;
const CANCEL = '/v1/orgs/{orgId}/projects/{projectId}/import-jobs/{importJobId}/cancel' as const;
const ROWS = '/v1/orgs/{orgId}/projects/{projectId}/import-jobs/{importJobId}/rows' as const;
const SUGGEST = '/v1/orgs/{orgId}/projects/{projectId}/ai/import-mappings' as const;

const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });

/** Live API only: staged rows exist only on the server. Applying a dry run is not in the API yet. */
export function createImportsApi(orgId: string) {
  const path = (projectId: string, importJobId: string) => ({ orgId, projectId, importJobId });
  return {
    async list(projectId: string): Promise<ImportJob[]> {
      return unwrap(
        await api.GET(P, { params: { path: { orgId, projectId }, query: { limit: 100 } } }),
      ).data;
    },
    async get(projectId: string, id: string): Promise<ImportJob> {
      return unwrap(await api.GET(J, { params: { path: path(projectId, id) } }));
    },
    /** Uploads the CSV (scanned for malware first), starts the import and reads the file into staged rows. */
    async start(projectId: string, input: StartImportInput): Promise<ImportJob> {
      await ensureCsrfToken();
      const stored = await uploadFile(orgId, {
        file: input.file,
        projectId,
        module: 'integrations',
      });
      const job = unwrap(
        await api.POST(P, {
          params: {
            path: { orgId, projectId },
            header: { 'Idempotency-Key': crypto.randomUUID() },
          },
          body: {
            entity: input.entity,
            source: input.source,
            fileId: stored.id,
            headerRow: input.headerRow,
          },
        }),
      );
      return this.parse(projectId, job);
    },
    async parse(projectId: string, job: ImportJob): Promise<ImportJob> {
      return unwrap(
        await api.POST(PARSE, {
          params: { path: path(projectId, job.id), header: ifMatch(job.version) },
        }),
      );
    },
    async rows(
      projectId: string,
      id: string,
      status?: ImportRowStatus,
      limit = 100,
    ): Promise<ImportRow[]> {
      return unwrap(
        await api.GET(ROWS, {
          params: { path: path(projectId, id), query: { status, limit } },
        }),
      ).data;
    },
    /** Nova reads a few values from each column; nothing is imported. Costs a quarter of a Nova credit. */
    async suggest(
      projectId: string,
      job: ImportJob,
      rows: ImportRow[],
    ): Promise<MappingSuggestion> {
      const columns = job.headers.map((header, i) => {
        const cells = rows.map((r) => (r.raw[i] ?? '').trim()).filter(Boolean);
        const distinct = [...new Set(cells)];
        return {
          header: header.slice(0, 200),
          samples: distinct.slice(0, 5).map((v) => v.slice(0, 100)),
          ...(distinct.length <= 30 && distinct.length > 0
            ? { distinct: distinct.map((v) => v.slice(0, 100)) }
            : {}),
        };
      });
      return unwrap(
        await api.POST(SUGGEST, {
          params: { path: { orgId, projectId } },
          body: { entity: job.entity, columns: columns.slice(0, 80) },
        }),
      );
    },
    /** Saves the mapping and dry-runs every staged row. Nothing is created. */
    async setMapping(projectId: string, job: ImportJob, mapping: MappingInput): Promise<ImportJob> {
      return unwrap(
        await api.PUT(MAPPING, {
          params: { path: path(projectId, job.id), header: ifMatch(job.version) },
          body: mapping,
        }),
      );
    },
    async cancel(projectId: string, job: ImportJob): Promise<ImportJob> {
      return unwrap(
        await api.POST(CANCEL, {
          params: { path: path(projectId, job.id), header: ifMatch(job.version) },
        }),
      );
    },
  };
}
