import { and, asc, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import { fieldsOf, type ImportEntity } from '@archova/ai-prompts';
import { uuidv7 } from '@archova/domain';
import { AppError, decodeCursor, toPage, versionConflict, type TenantScope } from '@archova/kernel';
import type { FilesModule } from '@archova/mod-files';
import type { PlatformApi } from '@archova/mod-platform';
import { CsvTooLarge, isBlankRecord, parseCsv } from '../domain/csv';
import { missingRequired, normaliseRow, type Mapping } from '../domain/normalise';
import {
  importJobs,
  importRows,
  type ImportJobStatus,
  type ImportRowStatus,
  type ImportSource,
} from '../infra/tables';

export type ImportJobRow = typeof importJobs.$inferSelect;
export type ImportRowRow = typeof importRows.$inferSelect;

/** The most rows a job stages (integrations/07 §3); bigger files are split. */
export const MAX_ROWS = 50_000;
/** The biggest file read inside the API; bigger ones wait for the worker (files readBytes contract). */
export const MAX_INLINE_BYTES = 5_000_000;
const INSERT_CHUNK = 500;
const OPEN: ImportJobStatus[] = ['uploaded', 'parsed', 'mapped', 'validated', 'applying'];

export interface ImportsDeps {
  platform: Pick<PlatformApi, 'getProject'>;
  files: Pick<FilesModule['api'], 'getFile' | 'readFileBytes'>;
  now?: () => Date;
}

export interface MappingInput {
  columns: Record<string, number>;
  values?: Record<string, Record<string, string>>;
}

export function createImportService(deps: ImportsDeps) {
  const now = () => (deps.now ?? (() => new Date()))();

  async function load(scope: TenantScope, projectId: string, jobId: string) {
    const [row] = await scope.tx
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.id, jobId), eq(importJobs.projectId, projectId)))
      .limit(1);
    if (!row) throw new AppError('import.not_found');
    return row;
  }

  function mustBe(job: ImportJobRow, ...allowed: ImportJobStatus[]) {
    if (!allowed.includes(job.status))
      throw new AppError('import.invalid_state', `This import is ${job.status.replace('_', ' ')}.`);
  }

  async function bump(scope: TenantScope, job: ImportJobRow, values: Partial<ImportJobRow>) {
    const [updated] = await scope.tx
      .update(importJobs)
      .set({ ...values, version: job.version + 1, updatedAt: now() })
      .where(and(eq(importJobs.id, job.id), eq(importJobs.version, job.version)))
      .returning();
    if (!updated) throw versionConflict();
    return updated;
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: { limit: number; cursor?: string },
  ) {
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const rows = await scope.tx
      .select()
      .from(importJobs)
      .where(
        and(eq(importJobs.projectId, projectId), after ? lt(importJobs.id, after.id) : undefined),
      )
      .orderBy(desc(importJobs.id))
      .limit(opts.limit + 1);
    return toPage(rows, opts.limit, (r) => ({ id: r.id }));
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    input: { entity: ImportEntity; source: ImportSource; fileId: string; headerRow?: number },
  ) {
    await deps.platform.getProject(scope, projectId);
    const file = await deps.files.getFile(scope, input.fileId);
    if (file.projectId !== projectId)
      throw new AppError('file.not_in_project', 'That file belongs to another project.', [
        { path: 'fileId', message: 'File is not in this project' },
      ]);
    const [open] = await scope.tx
      .select({ id: importJobs.id })
      .from(importJobs)
      .where(and(eq(importJobs.projectId, projectId), inArray(importJobs.status, OPEN)))
      .limit(1);
    if (open)
      throw new AppError(
        'import.already_open',
        'This project already has an import in progress. Finish or cancel it first.',
      );
    const id = uuidv7();
    await scope.tx.insert(importJobs).values({
      id,
      orgId: scope.ctx.orgId,
      projectId,
      entity: input.entity,
      source: input.source,
      fileId: input.fileId,
      headerRow: input.headerRow ?? 1,
      mapping: { columns: {}, values: {} },
      startedBy: scope.ctx.userId,
    });
    return load(scope, projectId, id);
  }

  /** Reads the file and stages one row per record. Running it again replaces the staged rows. */
  async function parse(scope: TenantScope, projectId: string, jobId: string, expected: number) {
    const job = await load(scope, projectId, jobId);
    if (job.version !== expected) throw versionConflict();
    mustBe(job, 'uploaded', 'parsed', 'mapped', 'validated');
    const { bytes } = await deps.files.readFileBytes(scope, job.fileId, MAX_INLINE_BYTES);
    let records: string[][];
    try {
      records = parseCsv(new TextDecoder('utf-8').decode(bytes), MAX_ROWS + job.headerRow + 1_000);
    } catch (e) {
      if (e instanceof CsvTooLarge) throw tooMany();
      throw e;
    }
    const header = records[job.headerRow - 1];
    if (!header || isBlankRecord(header))
      throw new AppError('import.no_header', 'We could not find the heading row in that file.', [
        { path: 'headerRow', message: `Row ${job.headerRow} is empty` },
      ]);
    const headers = header.map((h) => h.trim());
    const staged: Array<{ rowNumber: number; cells: string[] }> = [];
    records.forEach((cells, i) => {
      if (i < job.headerRow || isBlankRecord(cells)) return;
      staged.push({ rowNumber: i + 1, cells: cells.map((c) => c.trim()) });
    });
    if (staged.length > MAX_ROWS) throw tooMany();

    await scope.tx.delete(importRows).where(eq(importRows.jobId, job.id));
    for (let i = 0; i < staged.length; i += INSERT_CHUNK)
      await scope.tx.insert(importRows).values(
        staged.slice(i, i + INSERT_CHUNK).map((r) => ({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          jobId: job.id,
          rowNumber: r.rowNumber,
          raw: r.cells,
        })),
      );
    return bump(scope, job, {
      status: 'parsed',
      headers,
      mapping: { columns: {}, values: {} },
      totalRows: staged.length,
      validRows: 0,
      invalidRows: 0,
    });
  }

  function tooMany() {
    return new AppError(
      'import.too_many_rows',
      `Imports are limited to ${MAX_ROWS} rows. Split the file.`,
    );
  }

  function checkMapping(entity: ImportEntity, headers: string[], input: MappingInput): Mapping {
    const fields = new Map(fieldsOf(entity).map((f) => [f.key, f]));
    const used = new Map<number, string>();
    for (const [key, index] of Object.entries(input.columns)) {
      const field = fields.get(key);
      if (!field)
        throw new AppError('import.invalid_mapping', 'That field is not part of this import.', [
          { path: `columns/${key}`, message: 'Unknown field' },
        ]);
      if (!Number.isInteger(index) || index < 0 || index >= headers.length)
        throw new AppError('import.invalid_mapping', 'That column is not in the file.', [
          { path: `columns/${key}`, message: 'Column out of range' },
        ]);
      const other = used.get(index);
      if (other)
        throw new AppError('import.invalid_mapping', 'A column can fill only one field.', [
          { path: `columns/${key}`, message: `Column already fills ${other}` },
        ]);
      used.set(index, key);
    }
    const values: Mapping['values'] = {};
    for (const [key, map] of Object.entries(input.values ?? {})) {
      const field = fields.get(key);
      if (!field || field.kind !== 'enum')
        throw new AppError(
          'import.invalid_mapping',
          'Only fields with set choices take value mappings.',
          [{ path: `values/${key}`, message: 'Not a choice field' }],
        );
      for (const [source, target] of Object.entries(map))
        if (!field.values?.some((v) => v.value === target))
          throw new AppError('import.invalid_mapping', 'That choice does not exist.', [
            { path: `values/${key}/${source}`, message: `"${target}" is not a choice` },
          ]);
      values[key] = map;
    }
    return { columns: input.columns, values };
  }

  /** Saves the person's column choices and runs the dry run over every staged row. */
  async function setMapping(
    scope: TenantScope,
    projectId: string,
    jobId: string,
    expected: number,
    input: MappingInput,
  ) {
    const job = await load(scope, projectId, jobId);
    if (job.version !== expected) throw versionConflict();
    mustBe(job, 'parsed', 'mapped', 'validated');
    const mapping = checkMapping(job.entity, job.headers, input);
    const fields = fieldsOf(job.entity);
    const missing = missingRequired(fields, mapping);
    if (missing.length)
      throw new AppError(
        'import.mapping_incomplete',
        'Some required fields have no column yet.',
        missing.map((m) => ({ path: `columns/${m}`, message: 'Required field has no column' })),
      );

    let valid = 0;
    let invalid = 0;
    const seen = new Set<string>();
    const hasNumber = fields.some((f) => f.key === 'number');
    let cursor = 0;
    for (;;) {
      const batch = await scope.tx
        .select()
        .from(importRows)
        .where(and(eq(importRows.jobId, job.id), gt(importRows.rowNumber, cursor)))
        .orderBy(asc(importRows.rowNumber))
        .limit(INSERT_CHUNK);
      if (batch.length === 0) break;
      const results = batch.map((row) => {
        const result = normaliseRow(fields, mapping, row.raw);
        const numberField = hasNumber ? result.fields.number : undefined;
        const sourceRef =
          numberField !== null && numberField !== undefined ? String(numberField) : null;
        const problems = [...result.problems];
        if (sourceRef !== null) {
          if (seen.has(sourceRef))
            problems.push({
              field: 'number',
              message: `Number ${sourceRef} appears more than once in the file`,
            });
          seen.add(sourceRef);
        }
        const ok = problems.length === 0;
        if (ok) valid++;
        else invalid++;
        return {
          id: row.id,
          normalised: result.fields,
          source_ref: sourceRef,
          status: (ok ? 'valid' : 'invalid') satisfies ImportRowStatus,
          errors: problems,
        };
      });
      // One statement per batch rather than one per row: a file can have tens of thousands of rows.
      await scope.tx.execute(sql`
        update integrations.import_rows r
           set normalised = v.normalised, source_ref = v.source_ref, status = v.status, errors = v.errors
          from jsonb_to_recordset(${JSON.stringify(results)}::jsonb)
               as v(id uuid, normalised jsonb, source_ref text, status text, errors jsonb)
         where r.id = v.id
      `);
      cursor = batch[batch.length - 1]!.rowNumber;
    }
    return bump(scope, job, {
      status: 'validated',
      mapping,
      validRows: valid,
      invalidRows: invalid,
    });
  }

  async function cancel(scope: TenantScope, projectId: string, jobId: string, expected: number) {
    const job = await load(scope, projectId, jobId);
    if (job.version !== expected) throw versionConflict();
    mustBe(job, 'uploaded', 'parsed', 'mapped', 'validated');
    return bump(scope, job, { status: 'cancelled', finishedAt: now() });
  }

  async function rows(
    scope: TenantScope,
    projectId: string,
    jobId: string,
    opts: { status?: ImportRowStatus; limit: number; cursor?: string },
  ) {
    const job = await load(scope, projectId, jobId);
    const after = decodeCursor<{ n: number }>(opts.cursor);
    const found = await scope.tx
      .select()
      .from(importRows)
      .where(
        and(
          eq(importRows.jobId, job.id),
          opts.status ? eq(importRows.status, opts.status) : undefined,
          after ? gt(importRows.rowNumber, after.n) : undefined,
        ),
      )
      .orderBy(asc(importRows.rowNumber))
      .limit(opts.limit + 1);
    return toPage(found, opts.limit, (r) => ({ n: r.rowNumber }));
  }

  return { list, get: load, create, parse, setMapping, cancel, rows };
}

export type ImportService = ReturnType<typeof createImportService>;
