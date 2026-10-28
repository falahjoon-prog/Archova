// F31 import mapping (ai/11 F31, integrations/07 §3): the import screen sends each column's header, a few values and,
// for status-like columns, the distinct values in the file; Nova suggests which Archova field each column fills and
// what each status value means. Nova writes no records: the person confirms or changes the mapping before the
// import runs, and the screen passes `suggestionId` when it starts the import job so the final mapping can be
// compared with the suggestion (the "at least 90% of columns right" bar). Only a few values per column leave the
// building, and the suggestion keeps none of them: its payload holds headers, fields and status meanings. The row is
// private to the person who asked, like other drafts built from their files.
import {
  fieldsOf,
  importMappingPrompt,
  type ImportEntity,
  type ImportField,
  type ImportMappingInput,
} from '@archova/ai-prompts';
import { uuidv7 } from '@archova/domain';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import {
  reviewImportMapping,
  type MappedValues,
  type ReviewedImportMapping,
} from '../domain/import-mapping';
import { suggestions } from '../infra/tables';
import type { Gateway } from './gateway';

export interface ImportMappingDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask'>;
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
}

/** The `ai_suggestions` row kind; `targetType` `project` with the project as the target. */
export const IMPORT_MAPPING_TASK = 'import.mapping';
export const IMPORT_MAPPING_PERMISSION = 'ai.import_mapping.suggest';

/** `ai_suggestions.payload` for `import.mapping`: the mapping as suggested, without any of the file's values. */
export interface ImportMappingPayload {
  entity: ImportEntity;
  columns: Array<{
    index: number;
    header: string;
    field: string | null;
    confidence: ReviewedImportMapping['columns'][number]['confidence'];
    warning: ReviewedImportMapping['columns'][number]['warning'];
  }>;
  values: MappedValues[];
  missingRequired: string[];
}

export interface ImportMappingSuggestion extends ReviewedImportMapping {
  runId: string;
  /** The saved `ai_suggestions` row; pass it when the import job starts, then decide it. */
  suggestionId: string;
  entity: ImportEntity;
  /** The fields a column can fill, so the screen can offer them when the person changes a suggestion. */
  fields: readonly ImportField[];
}

/** Trims and bounds what comes from the file; the contract has the same limits, this keeps a direct caller honest. */
function cleaned(input: ImportMappingInput): ImportMappingInput {
  return {
    entity: input.entity,
    columns: input.columns.map((c) => ({
      header: c.header.trim().slice(0, 200),
      samples: c.samples.map((s) => s.trim()).filter(Boolean),
      ...(c.distinct ? { distinct: c.distinct.map((s) => s.trim()).filter(Boolean) } : {}),
    })),
  };
}

export function createImportMappingService(deps: ImportMappingDeps) {
  const { database } = deps;

  async function suggest(
    ctx: TenantContext,
    projectId: string,
    raw: ImportMappingInput,
    signal?: AbortSignal,
  ): Promise<ImportMappingSuggestion> {
    const input = cleaned(raw);
    if (!input.columns.some((c) => c.header || c.samples.length))
      throw new AppError('validation_failed', 'The file has no column headers or values to read.', [
        { path: 'columns', message: 'Empty' },
      ]);
    await database.withTenantTx(
      ctx,
      (scope) => deps.assert(scope, IMPORT_MAPPING_PERMISSION, { projectId }),
      { readOnly: true },
    );
    const run = await deps.gateway.runTask(ctx, importMappingPrompt, input, {
      projectId,
      ...(signal ? { signal } : {}),
    });
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't read this file's columns. Try again.");

    const reviewed = reviewImportMapping(run.output, input.entity, input.columns);
    const payload: ImportMappingPayload = {
      entity: input.entity,
      columns: reviewed.columns.map(({ index, header, field, confidence, warning }) => ({
        index,
        header,
        field,
        confidence,
        warning,
      })),
      values: reviewed.values,
      missingRequired: reviewed.missingRequired,
    };
    const suggestionId = await database.withTenantTx(ctx, async (scope) => {
      const [row] = await scope.tx
        .insert(suggestions)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          targetType: 'project',
          targetId: projectId,
          task: IMPORT_MAPPING_TASK,
          promptVersion: importMappingPrompt.version,
          payload,
          status: 'pending',
          runId: run.runId,
          createdBy: scope.ctx.userId,
          updatedBy: scope.ctx.userId,
        })
        .returning({ id: suggestions.id });
      return row!.id;
    });
    return {
      runId: run.runId,
      suggestionId,
      entity: input.entity,
      fields: fieldsOf(input.entity),
      ...reviewed,
    };
  }

  return { suggest };
}

export type ImportMappingService = ReturnType<typeof createImportMappingService>;
