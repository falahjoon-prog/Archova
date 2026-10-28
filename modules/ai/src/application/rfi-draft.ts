// F3 RFI auto-draft (ai/01 F3, product/03 RFI "Nova"): a note typed on site becomes an RFI subject and question,
// with references to the drawings and spec clauses the caller can open, the RFIs already asked on the same subject,
// and who answered them. Nova never sends an RFI: the draft fills the RFI form and the PM edits and sends it,
// passing `suggestionId` so the RFI records where it came from. The draft is kept as a pending `ai_suggestions` row
// that only the person who asked can see or decide. Retrieval is one search under the caller's access scopes (ai/04 §3). A drawing markup can stand in
// for, or add to, the typed note: its words and the sheet text around it go to the model, and the draft says where
// to pin the RFI.
import {
  rfiDraftPrompt,
  type PromptPassage,
  type RfiDraftMarkup,
  type RfiDraftPhoto,
} from '@archova/ai-prompts';
import { uuidv7 } from '@archova/domain';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import { suggestions } from '../infra/tables';
import {
  markupContext,
  reviewRfiDraft,
  similarityPhrases,
  suggestAssignees,
  type MarkupShape,
  type ReviewedRfiDraft,
  type SimilarRfi,
} from '../domain/rfi-draft';
import type { AnswerSource } from './ask';
import { MAX_INLINE_BYTES, type ReadableFile } from './drawing-register';
import type { DrawingRevisionRef } from './drawing-compare';
import type { Gateway } from './gateway';
import { searchChunks, toPassage, type ChunkHit } from './search';
import { MAX_PHOTO_BYTES, toSitePhoto } from './site-photo';
import { readSheetLines } from './sheet-text';

export interface RfiDraftDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask' | 'embed' | 'ocr'>;
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
  /** `documents.api.aiAccessScopes`: the scopes the caller holds in the project. */
  accessScopes: (scope: TenantScope, projectId: string) => Promise<string[]>;
  /** `rfis.api.findSimilar`: RFIs the caller can see matching any phrase, best first. */
  similarRfis: (
    scope: TenantScope,
    projectId: string,
    input: { phrases: string[]; limit: number },
  ) => Promise<SimilarRfi[]>;
  readFile: (scope: TenantScope, fileId: string, maxBytes: number) => Promise<ReadableFile>;
  getRevision: (scope: TenantScope, projectId: string, id: string) => Promise<DrawingRevisionRef>;
  /** `documents.api.getMarkup`: a markup the caller may see on the revision, or markup.not_found. */
  getMarkup: (
    scope: TenantScope,
    projectId: string,
    revisionId: string,
    markupId: string,
  ) => Promise<{ shapes: unknown }>;
}

/** The `ai_suggestions` row kind for a draft; `targetType` `project` with the project as the target. */
export const RFI_DRAFT_TASK = 'rfi.draft';

/** `ai_suggestions.payload` for `rfi.draft`: what Nova proposed, as ids the pilot metrics can compare with the RFI. */
export interface RfiDraftPayload {
  subject: string;
  question: string;
  discipline: ReviewedRfiDraft['discipline'];
  gaps: ReviewedRfiDraft['gaps'];
  /** The drawings and clauses the draft cites (no quotes). */
  references: Array<{
    sourceType: AnswerSource['sourceType'];
    sourceId: string;
    revisionId: string;
    page: number;
  }>;
  similarRfiIds: string[];
  suggestedAssigneeIds: string[];
  /** The sheet and spot the draft says to pin the RFI at. */
  pin: { drawingRevisionId: string; x: number; y: number } | null;
}

export interface RfiDraft extends Omit<ReviewedRfiDraft, 'references'> {
  runId: string;
  /** The saved `ai_suggestions` row; pass it as `aiSuggestionId` when the RFI is created, then decide it. */
  suggestionId: string;
  references: Array<AnswerSource & { quote: string }>;
  similarRfis: Array<Omit<SimilarRfi, 'assigneeUserIds'>>;
  /** Users asked the most similar RFIs; the PM picks the assignee. */
  suggestedAssigneeIds: string[];
  /** The marked sheet and where to pin the RFI, when the draft came from a markup. */
  drawing: {
    revisionId: string;
    sheetNumber: string;
    title: string;
    rev: string;
    pin: { x: number; y: number };
    /** The sheet was read with OCR: the person should check the quoted text against the drawing. */
    scanned: boolean;
  } | null;
}

/** Passages sent with the note: enough for the sheets and clauses it names, small enough for a quick draft. */
const PASSAGES = 8;
const SIMILAR = 5;

export function createRfiDraftService(deps: RfiDraftDeps) {
  const { database } = deps;
  const ro = { readOnly: true } as const;

  async function draft(
    ctx: TenantContext,
    projectId: string,
    input: {
      note: string;
      markup?: { revisionId: string; markupId: string };
      /** A site photo already uploaded to this project (a `files` id). */
      photo?: { fileId: string };
    },
    signal?: AbortSignal,
  ): Promise<RfiDraft> {
    const note = input.note.trim();
    const found = await database.withTenantTx(
      ctx,
      async (scope) => {
        await deps.assert(scope, 'rfis.rfis.create', { projectId });
        const scopes = await deps.accessScopes(scope, projectId);
        const photoFile = input.photo
          ? await deps.readFile(scope, input.photo.fileId, MAX_PHOTO_BYTES)
          : null;
        if (!input.markup) return { scopes, marked: null, photoFile };
        await deps.assert(scope, 'documents.drawings.read', { projectId });
        const revision = await deps.getRevision(scope, projectId, input.markup.revisionId);
        const markup = await deps.getMarkup(
          scope,
          projectId,
          input.markup.revisionId,
          input.markup.markupId,
        );
        const file = await deps.readFile(scope, revision.fileId, MAX_INLINE_BYTES);
        return { scopes, marked: { revision, shapes: markup.shapes, file }, photoFile };
      },
      { readOnly: true, statementTimeout: '60s' },
    );
    const { scopes } = found;

    const photo: RfiDraftPhoto | undefined = found.photoFile
      ? toSitePhoto(found.photoFile, projectId)
      : undefined;

    let drawing: RfiDraft['drawing'] = null;
    let markup: RfiDraftMarkup | undefined;
    let markupText = '';
    if (found.marked) {
      const { revision, shapes, file } = found.marked;
      const sheet = await readSheetLines(
        deps.gateway,
        ctx,
        projectId,
        rfiDraftPrompt.feature,
        file,
        revision.pageIndex + 1,
      );
      const context = markupContext(
        Array.isArray(shapes) ? (shapes as MarkupShape[]) : [],
        sheet.lines,
      );
      if (!context)
        throw new AppError(
          'validation_failed',
          'This markup has nothing drawn on it to ask about.',
          [{ path: 'markup', message: 'Draw or write on the sheet first.' }],
        );
      markup = {
        sheet: `${revision.sheetNumber} ${revision.title}`.trim(),
        rev: revision.rev,
        labels: context.labels,
        nearby: context.nearby,
      };
      markupText = [markup.sheet, markup.rev, ...markup.labels, ...markup.nearby].join('\n');
      drawing = {
        revisionId: revision.id,
        sheetNumber: revision.sheetNumber,
        title: revision.title,
        rev: revision.rev,
        pin: context.pin,
        scanned: sheet.scanned,
      };
    }
    // What the question is about, for retrieval: the note, or what the person wrote on the markup.
    const subject = [note, ...(markup?.labels ?? [])].filter(Boolean).join('\n');
    if (!subject && !photo)
      throw new AppError(
        'validation_failed',
        'Write a note, write on the markup or add a photo so Nova knows what to ask.',
        [{ path: 'note', message: 'A note is needed when there is no markup text or photo.' }],
      );

    let rows: ChunkHit[] = [];
    // A photo alone gives nothing to search with, so the draft rests on the photo and is told what is missing.
    if (scopes.length && subject) {
      const { vectors } = await deps.gateway.embed(ctx, [subject], {
        purpose: 'query',
        feature: rfiDraftPrompt.feature,
        projectId,
      });
      rows = await database.withTenantTx(
        ctx,
        (scope) =>
          searchChunks(scope, {
            projectId,
            scopes,
            query: subject,
            vector: vectors[0]!,
            limit: PASSAGES,
          }),
        ro,
      );
    }
    const passages: PromptPassage[] = rows.map((r, i) => toPassage(r, `p${i + 1}`));
    const byPassage = new Map(passages.map((p, i) => [p.id, rows[i]!]));

    const run = await deps.gateway.runTask(
      ctx,
      rfiDraftPrompt,
      { note, ...(markup ? { markup } : {}), ...(photo ? { photo } : {}) },
      { projectId, passages, ...(signal ? { signal } : {}) },
    );
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't draft this RFI. Try again.");

    const reviewed = reviewRfiDraft(run.output, {
      note: `${note}\n${markupText}`,
      citations: run.citations,
      // The question names sheets and clauses by number, so titles count as part of the passage.
      passageText: new Map(passages.map((p) => [p.id, `${p.source.title}\n${p.text}`])),
    });
    const similar = await database.withTenantTx(
      ctx,
      (scope) =>
        deps.similarRfis(scope, projectId, {
          phrases: similarityPhrases(run.output),
          limit: SIMILAR,
        }),
      ro,
    );
    const result = {
      runId: run.runId,
      ...reviewed,
      references: reviewed.references.map((c) => {
        const r = byPassage.get(c.passageId)!;
        return {
          sourceType: r.sourceType,
          sourceId: r.sourceId,
          revisionId: r.revisionId,
          revision: r.revisionLabel,
          title: r.title,
          reference: r.reference,
          page: r.page,
          quote: c.quote,
        };
      }),
      similarRfis: similar.map(({ assigneeUserIds: _, ...r }) => r),
      suggestedAssigneeIds: suggestAssignees(similar),
      drawing,
    };
    const payload: RfiDraftPayload = {
      subject: result.subject,
      question: result.question,
      discipline: result.discipline,
      gaps: result.gaps,
      references: result.references.map((r) => ({
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        revisionId: r.revisionId,
        page: r.page,
      })),
      similarRfiIds: result.similarRfis.map((r) => r.id),
      suggestedAssigneeIds: result.suggestedAssigneeIds,
      pin: result.drawing
        ? { drawingRevisionId: result.drawing.revisionId, ...result.drawing.pin }
        : null,
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
          task: RFI_DRAFT_TASK,
          promptVersion: rfiDraftPrompt.version,
          payload,
          status: 'pending',
          runId: run.runId,
          createdBy: scope.ctx.userId,
          updatedBy: scope.ctx.userId,
        })
        .returning({ id: suggestions.id });
      return row!.id;
    });
    return { ...result, suggestionId };
  }

  return { draft };
}

export type RfiDraftService = ReturnType<typeof createRfiDraftService>;
