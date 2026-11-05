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
import type { HeaderPatch, DiaryService, LineValues } from '../application/diary';
import type { LineKind } from '../domain/diary';
import { decodeIds } from './decode';
import { LINE_ID_KIND, toDetailDto, toEntryDto, toLineDto } from './mappers';

type Tenant = { tenant: TenantContext | null };
interface DayInput extends Tenant {
  params: { projectId: string; date: string };
  headers: Readonly<Record<string, string | undefined>>;
}
interface LineInput extends DayInput {
  params: { projectId: string; date: string; lineId?: string };
  body: Record<string, unknown> | null;
  query: { amendmentReason?: string } | null;
}

const project = (p: { projectId: string }) => {
  const id = decodeId('project', p.projectId);
  if (!id) throw new AppError('project.not_found');
  return id;
};

export function diaryRoutes(database: Database, diary: DiaryService) {
  const tx = <T>(input: Tenant, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: Tenant, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const ok = (status: number, d: Awaited<ReturnType<DiaryService['detail']>>) => ({
    status,
    body: toDetailDto(d),
    headers: { etag: etag(d.entry.version) },
  });

  const lineId = (kind: LineKind, p: { lineId?: string }) => {
    const id = p.lineId ? decodeId(LINE_ID_KIND[kind], p.lineId) : null;
    if (!id) throw new AppError('diary_line.not_found');
    return id;
  };

  const split = (body: Record<string, unknown> | null) => {
    const { amendmentReason, ...rest } = body ?? {};
    return { values: decodeIds(rest) as LineValues, reason: amendmentReason as string | undefined };
  };

  const line = {
    create: (kind: LineKind) => async (input: LineInput) => {
      const { values, reason } = split(input.body);
      const row = await tx(input, (s) =>
        diary.createLine(s, project(input.params), input.params.date, kind, values, reason),
      );
      return { status: 201, body: toLineDto(kind, row), headers: { etag: etag(row.version) } };
    },
    update: (kind: LineKind) => async (input: LineInput) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const { values, reason } = split(input.body);
      const row = await tx(input, (s) =>
        diary.updateLine(
          s,
          project(input.params),
          input.params.date,
          kind,
          lineId(kind, input.params),
          expected,
          values,
          reason,
        ),
      );
      return { status: 200, body: toLineDto(kind, row), headers: { etag: etag(row.version) } };
    },
    remove: (kind: LineKind) => async (input: LineInput) => {
      await tx(input, (s) =>
        diary.deleteLine(
          s,
          project(input.params),
          input.params.date,
          kind,
          lineId(kind, input.params),
          input.query?.amendmentReason,
        ),
      );
      return { status: 204 };
    },
  };

  return defineRoutes({
    listDiaryEntries: async (input) => {
      const rows = await read(input, (s) =>
        diary.list(s, project(input.params), input.query.from, input.query.to),
      );
      return { status: 200, body: { data: rows.map(toEntryDto) } };
    },
    getDiaryEntry: async (input: DayInput) =>
      ok(200, await read(input, (s) => diary.detail(s, project(input.params), input.params.date))),
    saveDiaryEntry: async (input) => {
      const ifMatch = input.headers['if-match'];
      const expected = ifMatch ? parseIfMatch(ifMatch) : null;
      const { amendmentReason, ...rest } = input.body;
      const patch = decodeIds(rest) as HeaderPatch;
      return ok(
        200,
        await tx(input, (s) =>
          diary.saveHeader(
            s,
            project(input.params),
            input.params.date,
            expected,
            patch,
            amendmentReason,
          ),
        ),
      );
    },
    submitDiaryEntry: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const clientAt = input.body?.clientAt ? new Date(input.body.clientAt) : undefined;
      return ok(
        200,
        await tx(input, (s) =>
          diary.submit(s, project(input.params), input.params.date, expected, clientAt),
        ),
      );
    },
    signOffDiaryEntry: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return ok(
        200,
        await tx(input, (s) =>
          diary.signOff(s, project(input.params), input.params.date, expected),
        ),
      );
    },
    copyDiaryLabour: async (input) =>
      ok(
        200,
        await tx(input, (s) =>
          diary.copyLabourFrom(s, project(input.params), input.params.date, input.params.fromDate),
        ),
      ),
    createDiaryLabour: line.create('labour'),
    updateDiaryLabour: line.update('labour'),
    deleteDiaryLabour: line.remove('labour'),
    createDiaryPlant: line.create('plant'),
    updateDiaryPlant: line.update('plant'),
    deleteDiaryPlant: line.remove('plant'),
    createDiaryDelivery: line.create('delivery'),
    updateDiaryDelivery: line.update('delivery'),
    deleteDiaryDelivery: line.remove('delivery'),
    createDiaryDelay: line.create('delay'),
    updateDiaryDelay: line.update('delay'),
    deleteDiaryDelay: line.remove('delay'),
    createDiaryVisitor: line.create('visitor'),
    updateDiaryVisitor: line.update('visitor'),
    deleteDiaryVisitor: line.remove('visitor'),
    createDiaryEvent: line.create('event'),
    updateDiaryEvent: line.update('event'),
    deleteDiaryEvent: line.remove('event'),
    createDiaryStandDown: line.create('stand_down'),
    updateDiaryStandDown: line.update('stand_down'),
    deleteDiaryStandDown: line.remove('stand_down'),
  });
}
