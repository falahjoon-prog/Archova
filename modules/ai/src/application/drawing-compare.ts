// F21 drawing revision compare (ai/01 F21, product/02 "Nova"): "What changed?" on a drawing revision. Code diffs
// the text of the sheet against the revision it superseded (OCR for scans); Nova words the changes, and the open
// RFIs pinned to the sheet are listed, marked when a change sits near the pin. The wording is cached per revision
// pair and shared; RFIs are looked up per request, as the caller sees them. Where a page renderer is installed, the
// linework is compared too (`visual`, application/visual-compare.ts): code pixel-diffs the two renders and Nova words
// the regions it found.
import { and, eq } from 'drizzle-orm';
import { drawingCompareVisualPrompt, drawingComparePrompt } from '@archova/ai-prompts';
import { uuidv7 } from '@archova/domain';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import {
  diffSheets,
  isNearChange,
  reviewCompare,
  type ReviewedCompare,
  type SheetChange,
} from '../domain/drawing-compare';
import type { Raster } from '../domain/visual-diff';
import { drawingCompares, drawingVisualCompares } from '../infra/tables';
import { MAX_INLINE_BYTES, type ReadableFile } from './drawing-register';
import type { Gateway } from './gateway';
import { readSheetLines } from './sheet-text';
import {
  compareVisually,
  type VisualComparePayload,
  type VisualCompareResult,
  type VisualUnavailable,
} from './visual-compare';

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
  /**
   * Renders one page of a PDF as greyscale: the whole page, longer side 2,000 px, so two issues of the same sheet size
   * line up. Unset where no native canvas is installed (the API image): the linework pass is skipped and the result
   * carries `visual: null`.
   */
  rasterizePage?: (file: ReadableFile, pageIndex: number) => Promise<Raster>;
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

type SheetText = Awaited<ReturnType<typeof readSheetLines>>;
interface LoadedSheets {
  files: { from: ReadableFile; to: ReadableFile };
  before: SheetText;
  after: SheetText;
}

/** The linework half of a compare, with the run that worded it (null when nothing needed wording). */
export type DrawingVisual = VisualComparePayload & { runId: string | null };

export interface DrawingCompare extends DrawingComparePayload {
  runId: string | null;
  revisionId: string;
  againstRevisionId: string;
  /** Null where no page renderer is installed. */
  visual: DrawingVisual | null;
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

    /** Both sheets and their text, read once and only if the text compare or the linework pass needs them. */
    let sheets: Promise<LoadedSheets> | undefined;
    const loadSheets = async (): Promise<LoadedSheets> => {
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
      return { files, before, after };
    };
    const sheetsOnce = () => (sheets ??= loadSheets());

    let runId = found.cached?.runId ?? null;
    let payload = found.cached?.payload as DrawingComparePayload | undefined;
    if (!payload) {
      const { before, after } = await sheetsOnce();
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

    const changes = payload.changes;
    const visual = deps.rasterizePage
      ? await linework(ctx, projectId, { to, from }, changes, sheetsOnce, deps.rasterizePage)
      : null;

    const rfis = await database.withTenantTx(
      ctx,
      (scope) => deps.openRfisOnDrawing(scope, projectId, [from.id, to.id]),
      ro,
    );
    return {
      runId,
      revisionId: to.id,
      againstRevisionId: from.id,
      visual,
      ...payload,
      affectedRfis: rfis
        .map(({ pin, ...r }) => ({ ...r, nearChange: pin !== null && isNearChange(pin, changes) }))
        .sort((a, b) => Number(b.nearChange) - Number(a.nearChange)),
    };
  }

  /**
   * The linework half: the stored result for this revision pair, or render both pages, pixel-diff them and have Nova
   * word the regions. A step that can't run (no render, allowance used, Nova busy) gives an empty result with the
   * reason and is not stored, so the text half is never held back by it and the next open tries again.
   */
  async function linework(
    ctx: TenantContext,
    projectId: string,
    revisions: { to: DrawingRevisionRef; from: DrawingRevisionRef },
    changes: SheetChange[],
    loadSheets: () => Promise<LoadedSheets>,
    rasterizePage: NonNullable<DrawingCompareDeps['rasterizePage']>,
  ): Promise<DrawingVisual> {
    const { to, from } = revisions;
    const version = drawingCompareVisualPrompt.version;
    const cached = await database.withTenantTx(
      ctx,
      async (scope) => {
        const [row] = await scope.tx
          .select()
          .from(drawingVisualCompares)
          .where(
            and(
              eq(drawingVisualCompares.orgId, scope.ctx.orgId),
              eq(drawingVisualCompares.revisionId, to.id),
              eq(drawingVisualCompares.againstRevisionId, from.id),
              eq(drawingVisualCompares.promptVersion, version),
            ),
          )
          .limit(1);
        return row ?? null;
      },
      { readOnly: true },
    );
    if (cached) return { ...(cached.payload as VisualComparePayload), runId: cached.runId };

    const unavailable = (reason: VisualUnavailable): DrawingVisual => ({
      reliable: false,
      reason,
      regions: [],
      truncated: false,
      dropped: 0,
      shift: { dx: 0, dy: 0 },
      runId: null,
    });
    let result: VisualCompareResult;
    try {
      const { files, before, after } = await loadSheets();
      let rasters: { before: Raster; after: Raster };
      try {
        rasters = {
          before: await rasterizePage(files.from, from.pageIndex),
          after: await rasterizePage(files.to, to.pageIndex),
        };
      } catch {
        return unavailable('render_failed');
      }
      result = await compareVisually(deps.gateway, ctx, {
        projectId,
        sheet: { label: `${to.sheetNumber} ${to.title}`, fromRev: from.rev, toRev: to.rev },
        rasters,
        text: { before: before.lines, after: after.lines, changes },
      });
    } catch (e) {
      if (e instanceof AppError)
        return unavailable(e.code === 'ai.allowance_used' ? 'allowance_used' : 'unavailable');
      throw e;
    }
    if (result.complete) {
      const stored = result.payload;
      const storedRunId = result.runId;
      await database.withTenantTx(ctx, async (scope) => {
        await scope.tx
          .insert(drawingVisualCompares)
          .values({
            id: uuidv7(),
            orgId: scope.ctx.orgId,
            projectId,
            revisionId: to.id,
            againstRevisionId: from.id,
            promptVersion: version,
            payload: stored,
            runId: storedRunId,
            createdBy: scope.ctx.userId,
          })
          .onConflictDoNothing();
      });
    }
    return { ...result.payload, runId: result.runId };
  }

  return { compare };
}

export type DrawingCompareService = ReturnType<typeof createDrawingCompareService>;
