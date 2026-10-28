// F21 drawing revision compare (ai/01 F21, product/02 "Nova"): "What changed?" on a drawing revision. Code diffs
// the text of the sheet against the revision it superseded (OCR for scans); Nova words the changes, and the open
// RFIs pinned to the sheet are listed, marked when a change sits near the pin. The wording is cached per revision
// pair and shared; RFIs are looked up per request, as the caller sees them.
import { and, eq } from 'drizzle-orm';
import { drawingComparePrompt } from '@archova/ai-prompts';
import { uuidv7 } from '@archova/domain';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import {
  diffSheets,
  isNearChange,
  reviewCompare,
  type ReviewedCompare,
  type SheetChange,
} from '../domain/drawing-compare';
import { drawingCompares } from '../infra/tables';
import { MAX_INLINE_BYTES, type ReadableFile } from './drawing-register';
import type { Gateway } from './gateway';
import { readSheetLines } from './sheet-text';

/** What `documents` returns for a drawing revision (the fields Nova reads). */
export interface DrawingRevisionRef {
  id: string;
  sheetId: string | null;
  sheetNumber: string;
  title: string;
  rev: string;
  fileId: string;
  pageIndex: number;
  status: string;
}

/** An open RFI pinned to the sheet (`rfis.api.openOnDrawing`). */
export interface RfiOnDrawing {
  id: string;
  number: string | null;
  subject: string;
  status: string;
  pin: { x: number; y: number } | null;
}

export interface DrawingCompareDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask' | 'ocr'>;
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
  readFile: (scope: TenantScope, fileId: string, maxBytes: number) => Promise<ReadableFile>;
  getRevision: (scope: TenantScope, projectId: string, id: string) => Promise<DrawingRevisionRef>;
  getPreviousRevision: (
    scope: TenantScope,
    projectId: string,
    id: string,
  ) => Promise<DrawingRevisionRef | null>;
  openRfisOnDrawing: (
    scope: TenantScope,
    projectId: string,
    revisionIds: string[],
  ) => Promise<RfiOnDrawing[]>;
}

/** `ai_drawing_compares.payload`. */
export interface DrawingComparePayload extends ReviewedCompare {
  sheetNumber: string;
  fromRev: string;
  toRev: string;
  changes: SheetChange[];
  truncated: boolean;
  /** One of the sheets was read with OCR: the person should check against the drawing. */
  scanned: boolean;
}

export interface DrawingCompare extends DrawingComparePayload {
  runId: string | null;
  revisionId: string;
  againstRevisionId: string;
  affectedRfis: Array<Omit<RfiOnDrawing, 'pin'> & { nearChange: boolean }>;
}

export function createDrawingCompareService(deps: DrawingCompareDeps) {
  const { database } = deps;
  const ro = { readOnly: true } as const;

  async function compare(
    ctx: TenantContext,
    projectId: string,
    revisionId: string,
  ): Promise<DrawingCompare> {
    const found = await database.withTenantTx(
      ctx,
      async (scope) => {
        await deps.assert(scope, 'documents.drawings.read', { projectId });
        const to = await deps.getRevision(scope, projectId, revisionId);
        const from = await deps.getPreviousRevision(scope, projectId, revisionId);
        if (!from)
          throw new AppError(
            'ai.drawing_compare.no_previous_revision',
            'This is the first issue of this sheet, so there is nothing to compare it with.',
          );
        const [row] = await scope.tx
          .select()
          .from(drawingCompares)
          .where(
            and(
              eq(drawingCompares.orgId, scope.ctx.orgId),
              eq(drawingCompares.revisionId, to.id),
              eq(drawingCompares.againstRevisionId, from.id),
              eq(drawingCompares.promptVersion, drawingComparePrompt.version),
            ),
          )
          .limit(1);
        return { to, from, cached: row ?? null };
      },
      ro,
    );
    const { to, from } = found;

    let runId = found.cached?.runId ?? null;
    let payload = found.cached?.payload as DrawingComparePayload | undefined;
    if (!payload) {
      const files = await database.withTenantTx(
        ctx,
        async (scope) => ({
          from: await deps.readFile(scope, from.fileId, MAX_INLINE_BYTES),
          to: await deps.readFile(scope, to.fileId, MAX_INLINE_BYTES),
        }),
        { readOnly: true, statementTimeout: '60s' },
      );
      const feature = drawingComparePrompt.feature;
      const before = await readSheetLines(
        deps.gateway,
        ctx,
        projectId,
        feature,
        files.from,
        from.pageIndex + 1,
      );
      const after = await readSheetLines(
        deps.gateway,
        ctx,
        projectId,
        feature,
        files.to,
        to.pageIndex + 1,
      );
      if (!before.lines.length || !after.lines.length)
        throw new AppError(
          'ai.drawing_compare.no_text',
          "Nova couldn't read any text on one of these sheets, so it can't say what changed. Use the overlay compare.",
        );
      const { changes, truncated } = diffSheets(before.lines, after.lines);
      const base = {
        sheetNumber: to.sheetNumber,
        fromRev: from.rev,
        toRev: to.rev,
        changes,
        truncated,
        scanned: before.scanned || after.scanned,
      };
      if (!changes.length) {
        payload = {
          ...base,
          headline: `No text changed from revision ${from.rev} to ${to.rev}. Check the overlay for changes to linework.`,
          items: [],
          unexplained: [],
          dropped: 0,
        };
      } else {
        const run = await deps.gateway.runTask(
          ctx,
          drawingComparePrompt,
          {
            sheet: `${to.sheetNumber} ${to.title}`,
            fromRev: from.rev,
            toRev: to.rev,
            changes: changes.map(({ x: _x, y: _y, ...c }) => c),
            truncated,
          },
          { projectId },
        );
        if (run.status !== 'ok')
          throw new AppError(
            'ai.invalid_output',
            "Nova couldn't describe these changes. Try again.",
          );
        runId = run.runId;
        payload = {
          ...base,
          ...reviewCompare(run.output, changes, { fromRev: from.rev, toRev: to.rev }),
        };
      }
      const stored = payload;
      await database.withTenantTx(ctx, async (scope) => {
        await scope.tx
          .insert(drawingCompares)
          .values({
            id: uuidv7(),
            orgId: scope.ctx.orgId,
            projectId,
            revisionId: to.id,
            againstRevisionId: from.id,
            promptVersion: drawingComparePrompt.version,
            payload: stored,
            runId,
            createdBy: scope.ctx.userId,
          })
          // Two people opening it at once: the first row wins, both see a correct result.
          .onConflictDoNothing();
      });
    }

    const rfis = await database.withTenantTx(
      ctx,
      (scope) => deps.openRfisOnDrawing(scope, projectId, [from.id, to.id]),
      ro,
    );
    const changes = payload.changes;
    return {
      runId,
      revisionId: to.id,
      againstRevisionId: from.id,
      ...payload,
      affectedRfis: rfis
        .map(({ pin, ...r }) => ({ ...r, nearChange: pin !== null && isNearChange(pin, changes) }))
        .sort((a, b) => Number(b.nearChange) - Number(a.nearChange)),
    };
  }

  return { compare };
}

export type DrawingCompareService = ReturnType<typeof createDrawingCompareService>;
