// F1 drawing register auto-fill (ai/01 §2, ai/03 §3). Reads each sheet's title block with Nova, checks every field
// against the sheet, matches it to the register and stores the result as a suggestion a person accepts, edits or
// rejects. `ai` never writes the register itself (backend 08 §1): an accepted suggestion is published as an event
// for the documents module to apply.
//
// Phase 1 runs this inline from the API for one file at a time; scanned sheets are read with OCR first. The
// ai-worker takes it over from `files.object.ready.v1` when apps/worker lands.
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import {
  TITLE_BLOCK_FIELDS,
  drawingTitleBlockPrompt,
  type TitleBlockField,
  type TitleBlockInput,
} from '@archova/ai-prompts';
import { uuidv7 } from '@archova/domain';
import {
  AppError,
  decodeCursor,
  toPage,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import { ocrToTextItems } from '../domain/ocr';
import {
  matchToRegister,
  reviewTitleBlock,
  selectTitleBlockText,
  type RegisterEntry,
  type RegisterMatch,
  type ReviewedField,
} from '../domain/titleblock';
import { readPdfText, readScannedPages } from '../infra/pdf';
import { suggestions, type SuggestionStatus } from '../infra/tables';
import type { Gateway } from './gateway';

export const TITLEBLOCK_TASK = drawingTitleBlockPrompt.id;
/** Max file size processed inline; larger sets wait for the worker. */
export const MAX_INLINE_BYTES = 150 * 1024 * 1024;
const MAX_SHEETS_PER_RUN = 300;
const CONCURRENCY = 4;
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface ReadableFile {
  file: { id: string; filename: string; mime: string; projectId: string | null };
  bytes: Uint8Array;
}

export interface DrawingRegisterDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask' | 'ocr'>;
  /** files.readFileBytes: applies the caller's read permission. */
  readFile: (scope: TenantScope, fileId: string, maxBytes: number) => Promise<ReadableFile>;
  /** access.assert */
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
}

/** What a drawing sheet suggestion holds (`ai_suggestions.payload`). */
export interface SheetSuggestionPayload {
  fileId: string;
  page: number;
  sheetLabel: string;
  isDrawing: boolean;
  fields: Record<TitleBlockField, ReviewedField>;
  flagged: TitleBlockField[];
  match: RegisterMatch | null;
  /** Read with OCR from a scanned page: the person should check it against the sheet. */
  scanned?: boolean;
  /** Set when a person decides: the fields as accepted or edited. */
  decided?: Partial<Record<TitleBlockField, string | null>>;
}

export interface ExtractionResult {
  suggestions: Array<typeof suggestions.$inferSelect>;
  pageCount: number;
  /** Pages with no text, even after OCR. */
  skippedPages: number[];
  refusedPages: number[];
}

/** Permission needed to run or decide each suggestion task. */
const TASK_PERMISSIONS: Readonly<Record<string, string>> = {
  [TITLEBLOCK_TASK]: 'ai.drawing_register.extract',
  // F33: the builder approves or rejects the draft here; edits happen in the induction editor (ai/12 §2 I1).
  'induction.draft': 'ai.induction.draft',
};

export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (t: T) => Promise<R>) {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function createDrawingRegisterService(deps: DrawingRegisterDeps) {
  const { database } = deps;

  /** The register as Nova knows it: accepted or edited sheet suggestions, latest decision per drawing number. */
  async function registerOf(scope: TenantScope, projectId: string): Promise<RegisterEntry[]> {
    const rows = await scope.tx
      .select({ payload: suggestions.payload })
      .from(suggestions)
      .where(
        and(
          eq(suggestions.orgId, scope.ctx.orgId),
          eq(suggestions.projectId, projectId),
          eq(suggestions.task, TITLEBLOCK_TASK),
          inArray(suggestions.status, ['accepted', 'edited']),
        ),
      )
      .orderBy(desc(suggestions.decidedAt));
    const seen = new Map<string, RegisterEntry>();
    for (const r of rows) {
      const p = r.payload as SheetSuggestionPayload;
      const number = p.decided?.number ?? p.fields.number.value;
      const revision = p.decided?.revision ?? p.fields.revision.value;
      if (number && revision && !seen.has(number)) seen.set(number, { number, revision });
    }
    return [...seen.values()];
  }

  async function extract(
    ctx: TenantContext,
    projectId: string,
    fileId: string,
  ): Promise<ExtractionResult> {
    const { file, bytes, register } = await database.withTenantTx(
      ctx,
      async (scope) => {
        const f = await deps.readFile(scope, fileId, MAX_INLINE_BYTES);
        if (f.file.projectId !== projectId) throw new AppError('file.not_found');
        return { ...f, register: await registerOf(scope, projectId) };
      },
      { readOnly: true, statementTimeout: '60s' },
    );

    const sheets: Array<{ page: number; input: TitleBlockInput; scanned?: boolean }> = [];
    let skippedPages: number[] = [];
    let pageCount = 1;
    if (file.mime === 'application/pdf') {
      const pdf = await readPdfText(bytes, { maxPages: MAX_SHEETS_PER_RUN });
      pageCount = pdf.pageCount;
      for (const p of pdf.pages) {
        const text = selectTitleBlockText(p.items, p);
        if (!text.trim()) skippedPages.push(p.page);
        else
          sheets.push({
            page: p.page,
            input: { sheetLabel: `${file.filename} p${p.page}`, titleBlockText: text },
          });
      }
      // Scans: OCR the page, then pick the title block from the OCR text like from a text layer, so every field
      // is still checked against what is on the sheet.
      if (skippedPages.length) {
        const scans = await readScannedPages(bytes, skippedPages);
        const read = await deps.gateway.ocr(
          ctx,
          scans.map((s) => s.png),
          { feature: drawingTitleBlockPrompt.feature, projectId },
        );
        scans.forEach((s, i) => {
          const text = selectTitleBlockText(ocrToTextItems(read[i]!.lines, s.placement), s);
          if (!text.trim()) return;
          sheets.push({
            page: s.page,
            input: { sheetLabel: `${file.filename} p${s.page}`, titleBlockText: text },
            scanned: true,
          });
          skippedPages = skippedPages.filter((p) => p !== s.page);
        });
        sheets.sort((a, b) => a.page - b.page);
      }
    } else if (IMAGE_MIMES.has(file.mime)) {
      sheets.push({
        page: 1,
        input: {
          sheetLabel: file.filename,
          titleBlockText: '',
          image: {
            mime: file.mime as 'image/png' | 'image/jpeg' | 'image/webp',
            base64: Buffer.from(bytes).toString('base64'),
          },
        },
      });
    } else {
      throw new AppError('validation_failed', 'Nova reads title blocks from PDFs and images.', [
        { path: 'fileId', message: 'Not a PDF or image' },
      ]);
    }

    const refusedPages: number[] = [];
    const results = await mapLimit(sheets, CONCURRENCY, async (s) => {
      const run = await deps.gateway.runTask(ctx, drawingTitleBlockPrompt, s.input, { projectId });
      if (run.status !== 'ok') {
        refusedPages.push(s.page);
        return null;
      }
      return {
        ...s,
        runId: run.runId,
        reviewed: reviewTitleBlock(run.output, s.input.titleBlockText),
      };
    });

    // Match against the register, and within this upload (two sheets with the same number need a person).
    const numbersInUpload = new Map<string, number>();
    for (const r of results) {
      const n = r?.reviewed.fields.number.value;
      if (n) numbersInUpload.set(n, (numbersInUpload.get(n) ?? 0) + 1);
    }
    const rows = results
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .map((r) => {
        const { fields, flagged, isDrawing, confidence } = r.reviewed;
        const number = fields.number.value;
        const match = number
          ? matchToRegister({ number, revision: fields.revision.value }, register)
          : null;
        if (number && (numbersInUpload.get(number) ?? 0) > 1 && !flagged.includes('number'))
          flagged.push('number');
        const payload: SheetSuggestionPayload = {
          fileId: file.id,
          page: r.page,
          sheetLabel: r.input.sheetLabel,
          isDrawing,
          fields,
          flagged,
          match,
          ...(r.scanned ? { scanned: true } : {}),
        };
        return {
          id: uuidv7(),
          orgId: ctx.orgId,
          projectId,
          targetType: 'file_page',
          targetId: file.id,
          task: TITLEBLOCK_TASK,
          promptVersion: drawingTitleBlockPrompt.version,
          payload,
          confidence,
          runId: r.runId,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        };
      });

    const saved = await database.withTenantTx(ctx, async (scope) => {
      // Re-running a file replaces its undecided suggestions.
      await scope.tx
        .delete(suggestions)
        .where(
          and(
            eq(suggestions.orgId, ctx.orgId),
            eq(suggestions.targetId, file.id),
            eq(suggestions.task, TITLEBLOCK_TASK),
            eq(suggestions.status, 'pending'),
          ),
        );
      return rows.length ? scope.tx.insert(suggestions).values(rows).returning() : [];
    });
    saved.sort(
      (a, b) =>
        (a.payload as SheetSuggestionPayload).page - (b.payload as SheetSuggestionPayload).page,
    );
    return {
      suggestions: saved,
      pageCount,
      skippedPages,
      refusedPages: refusedPages.sort((a, b) => a - b),
    };
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    q: { task?: string; status?: SuggestionStatus; limit: number; cursor?: string },
  ) {
    // Ids are UUIDv7, so id order is creation order (and avoids timestamp precision issues in cursors).
    const after = decodeCursor<{ id: string }>(q.cursor);
    const rows = await scope.tx
      .select()
      .from(suggestions)
      .where(
        and(
          eq(suggestions.orgId, scope.ctx.orgId),
          eq(suggestions.projectId, projectId),
          q.task ? eq(suggestions.task, q.task) : undefined,
          q.status ? eq(suggestions.status, q.status) : undefined,
          after ? lt(suggestions.id, after.id) : undefined,
        ),
      )
      .orderBy(desc(suggestions.id))
      .limit(q.limit + 1);
    return toPage(rows, q.limit, (r) => ({ id: r.id }));
  }

  /**
   * A person accepts, edits or rejects a suggestion (ai/04 §7). Recorded with who and when, and published as
   * `ai.suggestion.decided.v1` for audit and Nova's accept-rate metrics. Nothing applies the event, so a sheet is
   * never added twice: the web adds the set revision through `documents`, passing `aiSuggestionId`, and `documents`
   * marks it AI-assisted in its own audit event (agreed with Ben and Felix, 2 Oct 2026).
   */
  async function decide(
    scope: TenantScope,
    projectId: string,
    suggestionId: string,
    input: {
      decision: 'accepted' | 'edited' | 'rejected';
      fields?: Partial<Record<TitleBlockField, string | null>>;
    },
  ) {
    const [row] = await scope.tx
      .select()
      .from(suggestions)
      .where(
        and(
          eq(suggestions.orgId, scope.ctx.orgId),
          eq(suggestions.id, suggestionId),
          eq(suggestions.projectId, projectId),
        ),
      )
      .limit(1)
      .for('update');
    if (!row) throw new AppError('ai.suggestion.not_found');
    const permission = TASK_PERMISSIONS[row.task];
    if (!permission) throw new AppError('ai.suggestion.not_found');
    await deps.assert(scope, permission, { projectId });
    if (row.status !== 'pending')
      throw new AppError('conflict', 'This suggestion has already been decided.');
    const isSheet = row.task === TITLEBLOCK_TASK;
    if (input.decision === 'edited' && !isSheet)
      throw new AppError('validation_failed', 'Edit this draft in its editor, then accept it.', [
        { path: 'decision', message: 'Only accepted or rejected' },
      ]);
    if (input.decision === 'edited' && !input.fields)
      throw new AppError('validation_failed', 'Send the edited fields.', [
        { path: 'fields', message: 'Required when editing' },
      ]);

    const payload = row.payload as SheetSuggestionPayload;
    const accepted = isSheet
      ? (Object.fromEntries(TITLE_BLOCK_FIELDS.map((f) => [f, payload.fields[f].value])) as Record<
          TitleBlockField,
          string | null
        >)
      : undefined;
    const decided =
      input.decision === 'rejected' || !accepted ? undefined : { ...accepted, ...input.fields };
    const [updated] = await scope.tx
      .update(suggestions)
      .set({
        status: input.decision,
        payload: decided ? { ...payload, decided } : payload,
        decidedBy: scope.ctx.userId,
        decidedAt: new Date(),
        updatedBy: scope.ctx.userId,
        version: sql`${suggestions.version} + 1`,
      })
      .where(eq(suggestions.id, row.id))
      .returning();
    scope.events.add({
      type: 'ai.suggestion.decided.v1',
      projectId,
      entityType: 'ai_suggestion',
      entityId: row.id,
      entityVersion: updated!.version,
      data: {
        suggestionId: row.id,
        task: row.task,
        targetType: row.targetType,
        targetId: row.targetId,
        decision: input.decision,
        fields: decided ?? null,
        runId: row.runId,
      },
    });
    return updated!;
  }

  return { extract, list, decide, registerOf };
}

export type DrawingRegisterService = ReturnType<typeof createDrawingRegisterService>;
