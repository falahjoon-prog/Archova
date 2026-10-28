import { decodeId } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  etag,
  parseIfMatch,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { ImportService } from '../application/imports';
import { toImportJobDto, toImportRowDto } from './mappers';

const project = (p: { projectId: string }) => {
  const id = decodeId('project', p.projectId);
  if (!id) throw new AppError('project.not_found');
  return id;
};
const jobIdOf = (p: { importJobId: string }) => {
  const id = decodeId('importJob', p.importJobId);
  if (!id) throw new AppError('import.not_found');
  return id;
};

export function integrationsRoutes(database: Database, svc: ImportService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const job = (status: number, x: Awaited<ReturnType<ImportService['get']>>) => ({
    status,
    body: toImportJobDto(x),
    headers: { etag: etag(x.version) },
  });

  return defineRoutes({
    listImportJobs: async (input) => {
      const page = await read(input, (s) =>
        svc.list(s, project(input.params), {
          limit: input.query.limit,
          ...(input.query.cursor ? { cursor: input.query.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toImportJobDto), nextCursor: page.nextCursor },
      };
    },
    createImportJob: async (input) => {
      const fileId = decodeId('file', input.body.fileId);
      if (!fileId)
        throw new AppError('validation_failed', 'Invalid id', [
          { path: 'fileId', message: 'Invalid id' },
        ]);
      return job(
        201,
        await tx(input, (s) =>
          svc.create(s, project(input.params), {
            entity: input.body.entity,
            source: input.body.source ?? 'spreadsheet',
            fileId,
            ...(input.body.headerRow ? { headerRow: input.body.headerRow } : {}),
          }),
        ),
      );
    },
    getImportJob: async (input) =>
      job(200, await read(input, (s) => svc.get(s, project(input.params), jobIdOf(input.params)))),
    parseImportJob: async (input) =>
      job(
        200,
        await tx(input, (s) =>
          svc.parse(
            s,
            project(input.params),
            jobIdOf(input.params),
            parseIfMatch(input.headers['if-match']),
          ),
        ),
      ),
    setImportMapping: async (input) =>
      job(
        200,
        await tx(input, (s) =>
          svc.setMapping(
            s,
            project(input.params),
            jobIdOf(input.params),
            parseIfMatch(input.headers['if-match']),
            input.body,
          ),
        ),
      ),
    cancelImportJob: async (input) =>
      job(
        200,
        await tx(input, (s) =>
          svc.cancel(
            s,
            project(input.params),
            jobIdOf(input.params),
            parseIfMatch(input.headers['if-match']),
          ),
        ),
      ),
    listImportRows: async (input) => {
      const page = await read(input, (s) =>
        svc.rows(s, project(input.params), jobIdOf(input.params), {
          ...(input.query.status ? { status: input.query.status } : {}),
          limit: input.query.limit,
          ...(input.query.cursor ? { cursor: input.query.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toImportRowDto), nextCursor: page.nextCursor },
      };
    },
  });
}
