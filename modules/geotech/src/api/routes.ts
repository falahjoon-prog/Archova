import { decodeId, type IdKind } from '@archova/domain';
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
import type { GeotechService, InvestigationFields } from '../application/geotech';
import { toEarthworksDto, toFlagDto, toInvestigationDto, toTestDto } from './mappers';

const ref = (kind: IdKind, value: string, path: string) => {
  const uuid = decodeId(kind, value);
  if (!uuid)
    throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
  return uuid;
};

function investigationFields(b: Record<string, unknown>): InvestigationFields {
  const out: InvestigationFields = {};
  const set = <K extends keyof InvestigationFields>(k: K) => {
    if (b[k] !== undefined) (out as Record<string, unknown>)[k] = b[k];
  };
  (
    [
      'kind',
      'title',
      'location',
      'latitude',
      'longitude',
      'depthM',
      'groundwaterDepthM',
      'investigatedOn',
      'summary',
    ] as const
  ).forEach(set);
  if (b.consultantCompanyId !== undefined)
    out.consultantCompanyId =
      b.consultantCompanyId === null
        ? null
        : ref('company', b.consultantCompanyId as string, 'consultantCompanyId');
  if (b.fileIds !== undefined)
    out.fileIds = (b.fileIds as string[]).map((f) => ref('file', f, 'fileIds'));
  return out;
}

export function geotechRoutes(database: Database, geotech: GeotechService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const project = (p: { projectId: string }) => {
    const id = decodeId('project', p.projectId);
    if (!id) throw new AppError('project.not_found');
    return id;
  };
  const found = (
    kind: IdKind,
    value: string,
    code:
      'geotech.investigation_not_found' | 'geotech.test_not_found' | 'geotech.earthworks_not_found',
  ) => {
    const id = decodeId(kind, value);
    if (!id) throw new AppError(code);
    return id;
  };
  const inv = (p: { investigationId: string }) =>
    found('geotechInvestigation', p.investigationId, 'geotech.investigation_not_found');
  const okInv = (status: number, r: Parameters<typeof toInvestigationDto>[0]) => ({
    status,
    body: toInvestigationDto(r),
    headers: { etag: etag(r.version) },
  });

  return defineRoutes({
    listGeotechInvestigations: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        geotech.listInvestigations(s, project(input.params), {
          ...(q.kind ? { kind: q.kind } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toInvestigationDto), nextCursor: page.nextCursor },
      };
    },
    createGeotechInvestigation: async (input) =>
      okInv(
        201,
        await tx(input, (s) =>
          geotech.createInvestigation(s, project(input.params), {
            ...investigationFields(input.body),
            kind: input.body.kind,
            title: input.body.title,
          }),
        ),
      ),
    getGeotechInvestigation: async (input) =>
      okInv(
        200,
        await read(input, (s) =>
          geotech.getInvestigation(s, project(input.params), inv(input.params)),
        ),
      ),
    updateGeotechInvestigation: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return okInv(
        200,
        await tx(input, (s) =>
          geotech.updateInvestigation(
            s,
            project(input.params),
            inv(input.params),
            expected,
            investigationFields(input.body),
          ),
        ),
      );
    },
    listGeotechTests: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        geotech.listTests(s, project(input.params), {
          ...(q.investigationId
            ? { investigationId: ref('geotechInvestigation', q.investigationId, 'investigationId') }
            : {}),
          ...(q.kind ? { kind: q.kind } : {}),
          ...(q.result ? { result: q.result } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return { status: 200, body: { data: page.data.map(toTestDto), nextCursor: page.nextCursor } };
    },
    createGeotechTest: async (input) => {
      const b = input.body;
      const row = await tx(input, (s) =>
        geotech.addTest(s, project(input.params), {
          ...b,
          investigationId: b.investigationId
            ? ref('geotechInvestigation', b.investigationId, 'investigationId')
            : null,
        }),
      );
      return { status: 201, body: toTestDto(row) };
    },
    deleteGeotechTest: async (input) => {
      await tx(input, (s) =>
        geotech.deleteTest(
          s,
          project(input.params),
          found('geotechTest', input.params.testId, 'geotech.test_not_found'),
        ),
      );
      return { status: 204 };
    },
    listGeotechEarthworks: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        geotech.listEarthworks(s, project(input.params), {
          ...(q.zone ? { zone: q.zone } : {}),
          ...(q.kind ? { kind: q.kind } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toEarthworksDto), nextCursor: page.nextCursor },
      };
    },
    createGeotechEarthworks: async (input) => ({
      status: 201,
      body: toEarthworksDto(
        await tx(input, (s) => geotech.addEarthworks(s, project(input.params), input.body)),
      ),
    }),
    deleteGeotechEarthworks: async (input) => {
      await tx(input, (s) =>
        geotech.deleteEarthworks(
          s,
          project(input.params),
          found('geotechEarthworks', input.params.entryId, 'geotech.earthworks_not_found'),
        ),
      );
      return { status: 204 };
    },
    getGeotechEarthworksSummary: async (input) => ({
      status: 200,
      body: await read(input, (s) => geotech.earthworksSummary(s, project(input.params))),
    }),
    listGeotechFlags: async (input) => ({
      status: 200,
      body: {
        data: (await read(input, (s) => geotech.flags(s, project(input.params)))).map(toFlagDto),
      },
    }),
  });
}
