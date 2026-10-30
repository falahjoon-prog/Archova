// F3 RFI answer draft (ai/01 F3, product/03 RFI "Nova"): a response to an RFI that already exists, for the person who
// will answer it. Nova reads the question, the responses so far and the files attached to them (the caller's own
// read access applies), searches the project under the caller's access scopes, and drafts what that supports. It
// says what is left for the person to decide and never decides for them. Nova sends nothing: the draft fills the
// response box and the person edits and sends it, passing `suggestionId` so the response records where it came from.
// The draft is kept as a pending `ai_suggestions` row that only the person who asked can see or decide.
import {
  rfiAnswerPrompt,
  type PromptPassage,
  type RfiAnswerAttachment,
  type SitePhoto,
} from '@archova/ai-prompts';
import { uuidv7 } from '@archova/domain';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import { sheetLines } from '../domain/drawing-compare';
import { reviewRfiAnswer, type ReviewedRfiAnswer } from '../domain/rfi-answer';
import { readPdfText } from '../infra/pdf';
import { suggestions } from '../infra/tables';
import type { AnswerSource } from './ask';
import type { ReadableFile } from './drawing-register';
import type { Gateway } from './gateway';
import { searchChunks, toPassage, type ChunkHit } from './search';
import { MAX_PHOTO_BYTES, toSitePhoto } from './site-photo';

/** What `rfis.api.forAnswerDraft` returns: the RFI the caller can see and could respond to, and its responses. */
export interface RfiForAnswer {
  id: string;
  number: string | null;
  subject: string;
  status: string;
  question: string;
  responses: Array<{
    id: string;
    official: boolean;
    text: string;
    fileIds: string[];
    /** Written by the caller. */
    fromCaller: boolean;
  }>;
}

export interface RfiAnswerDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask' | 'embed'>;
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
  /** The scopes the caller holds in the project for documents and RFIs. */
  accessScopes: (scope: TenantScope, projectId: string) => Promise<string[]>;
  /** `rfis.api.forAnswerDraft`: the RFI and its responses, or the error `respond` would give the caller. */
  rfi: (scope: TenantScope, projectId: string, rfiId: string) => Promise<RfiForAnswer>;
  readFile: (scope: TenantScope, fileId: string, maxBytes: number) => Promise<ReadableFile>;
}

/** The `ai_suggestions` row kind; `targetType` `rfi` with the RFI as the target. */
export const RFI_ANSWER_TASK = 'rfi.answer';
export const RFI_ANSWER_TARGET = 'rfi';

/** `ai_suggestions.payload` for `rfi.answer`: what Nova proposed, as ids the pilot metrics can compare with the response. */
export interface RfiAnswerPayload {
  rfiId: string;
  answer: string;
  basis: ReviewedRfiAnswer['basis'];
  needsDecision: string[];
  /** The drawings, clauses and earlier RFIs the draft cites (no quotes). */
  references: Array<{
    sourceType: AnswerSource['sourceType'];
    sourceId: string;
    revisionId: string;
    page: number;
  }>;
}

export interface RfiAnswerDraft extends Omit<ReviewedRfiAnswer, 'references'> {
  runId: string;
  /** The saved `ai_suggestions` row; pass it as `aiSuggestionId` when the response is sent, then decide it. */
  suggestionId: string;
  rfiId: string;
  references: Array<AnswerSource & { quote: string }>;
  /** Files attached to the responses and whether Nova could read them, newest first. */
  attachments: Array<{ fileId: string; name: string; read: boolean }>;
}

/** Passages sent with the question: enough for the sheets and clauses it names, small enough for a quick draft. */
const PASSAGES = 8;
/** Chunks of this very RFI are left out of the search, so ask for a few more than are sent. */
const SPARE = 4;
/** Files looked at, newest first, and the most of each kind sent to the model. */
const FILES_LOOKED_AT = 6;
const MAX_PHOTOS = 3;
const MAX_PDFS = 3;
/** Read limit for an attachment: a consultant's PDF is often bigger than a phone photo. */
const MAX_ATTACHMENT_BYTES = 20_000_000;
const PDF_PAGES = 3;
const PDF_CHARS = 6000;
/** Characters of the question, subject and direction used to search. */
const SEARCH_CHARS = 3000;

export function createRfiAnswerService(deps: RfiAnswerDeps) {
  const { database } = deps;
  const ro = { readOnly: true } as const;

  /**
   * The attachments Nova can use: photos and sketches as images, PDFs as their text layer (a scan has none and is
   * not read here). A file the caller can't open, or that is too big or unreadable, is skipped rather than failing
   * the draft.
   */
  async function readAttachments(
    scope: TenantScope,
    projectId: string,
    rfi: RfiForAnswer,
  ): Promise<{
    photos: SitePhoto[];
    pdfs: RfiAnswerAttachment[];
    listed: RfiAnswerDraft['attachments'];
  }> {
    const fileIds = [...new Set(rfi.responses.flatMap((r) => r.fileIds).reverse())].slice(
      0,
      FILES_LOOKED_AT,
    );
    const photos: SitePhoto[] = [];
    const pdfs: RfiAnswerAttachment[] = [];
    const listed: RfiAnswerDraft['attachments'] = [];
    for (const fileId of fileIds) {
      let read: ReadableFile;
      try {
        read = await deps.readFile(scope, fileId, MAX_ATTACHMENT_BYTES);
      } catch (e) {
        if (e instanceof AppError) {
          listed.push({ fileId, name: 'Unavailable file', read: false });
          continue;
        }
        throw e;
      }
      // A response can only attach files of its own project, but a file of another one is never sent from here.
      if (read.file.projectId && read.file.projectId !== projectId) {
        listed.push({ fileId, name: 'Unavailable file', read: false });
        continue;
      }
      const name = read.file.filename;
      let used = false;
      if (read.file.mime === 'application/pdf' && pdfs.length < MAX_PDFS) {
        const text = await pdfText(read.bytes);
        if (text) {
          pdfs.push({ name: name.slice(0, 200), text });
          used = true;
        }
      } else if (photos.length < MAX_PHOTOS && read.bytes.length <= MAX_PHOTO_BYTES) {
        try {
          photos.push(toSitePhoto(read, projectId));
          used = true;
        } catch (e) {
          if (!(e instanceof AppError)) throw e;
        }
      }
      listed.push({ fileId, name, read: used });
    }
    return { photos, pdfs, listed };
  }

  async function draft(
    ctx: TenantContext,
    projectId: string,
    rfiId: string,
    input: { direction?: string },
    signal?: AbortSignal,
  ): Promise<RfiAnswerDraft> {
    const direction = (input.direction ?? '').trim();
    const found = await database.withTenantTx(
      ctx,
      async (scope) => {
        await deps.assert(scope, 'rfis.rfis.respond', { projectId });
        const rfi = await deps.rfi(scope, projectId, rfiId);
        const scopes = await deps.accessScopes(scope, projectId);
        return { rfi, scopes, files: await readAttachments(scope, projectId, rfi) };
      },
      { readOnly: true, statementTimeout: '60s' },
    );
    const { rfi, scopes, files } = found;

    const responses = rfi.responses.slice(-12).map((r) => ({
      official: r.official,
      yours: r.fromCaller,
      text: r.text.slice(0, 4000),
    }));
    const taskInput = {
      number: rfi.number,
      subject: rfi.subject.slice(0, 300),
      question: rfi.question.slice(0, 6000),
      responses,
      attachments: files.pdfs,
      photos: files.photos,
      direction: direction.slice(0, 2000),
    };

    // What the answer is about, for retrieval: the subject, the question and what the person wants said.
    const query = [rfi.subject, rfi.question, direction]
      .filter(Boolean)
      .join('\n')
      .slice(0, SEARCH_CHARS);
    let rows: ChunkHit[] = [];
    if (scopes.length) {
      const { vectors } = await deps.gateway.embed(ctx, [query], {
        purpose: 'query',
        feature: rfiAnswerPrompt.feature,
        projectId,
      });
      const hits = await database.withTenantTx(
        ctx,
        (scope) =>
          searchChunks(scope, {
            projectId,
            scopes,
            query,
            vector: vectors[0]!,
            limit: PASSAGES + SPARE,
          }),
        ro,
      );
      rows = hits
        .filter((r) => !(r.sourceType === 'rfi' && r.sourceId === rfiId))
        .slice(0, PASSAGES);
    }
    const passages: PromptPassage[] = rows.map((r, i) => toPassage(r, `p${i + 1}`));
    const byPassage = new Map(passages.map((p, i) => [p.id, rows[i]!]));

    const run = await deps.gateway.runTask(ctx, rfiAnswerPrompt, taskInput, {
      projectId,
      passages,
      ...(signal ? { signal } : {}),
    });
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't draft a response. Try again.");

    const reviewed = reviewRfiAnswer(run.output, {
      known: [
        taskInput.subject,
        taskInput.question,
        ...responses.map((r) => r.text),
        ...files.pdfs.map((p) => p.text),
        direction,
      ].join('\n'),
      direction,
      citations: run.citations,
      // The answer names sheets and clauses by number, so titles count as part of the passage.
      passageText: new Map(passages.map((p) => [p.id, `${p.source.title}\n${p.text}`])),
    });
    const references = reviewed.references.map((c) => {
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
    });
    const payload: RfiAnswerPayload = {
      rfiId,
      answer: reviewed.answer,
      basis: reviewed.basis,
      needsDecision: reviewed.needsDecision,
      references: references.map((r) => ({
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        revisionId: r.revisionId,
        page: r.page,
      })),
    };
    const suggestionId = await database.withTenantTx(ctx, async (scope) => {
      const [row] = await scope.tx
        .insert(suggestions)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          targetType: RFI_ANSWER_TARGET,
          targetId: rfiId,
          task: RFI_ANSWER_TASK,
          promptVersion: rfiAnswerPrompt.version,
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
      rfiId,
      answer: reviewed.answer,
      basis: reviewed.basis,
      needsDecision: reviewed.needsDecision,
      unsupportedNumbers: reviewed.unsupportedNumbers,
      references,
      attachments: files.listed,
    };
  }

  return { draft };
}

export type RfiAnswerService = ReturnType<typeof createRfiAnswerService>;

/** The first pages of a PDF as printed rows, from its text layer; empty for a scan or a file that won't open. */
async function pdfText(bytes: Uint8Array): Promise<string> {
  try {
    const pdf = await readPdfText(bytes, { maxPages: PDF_PAGES });
    return pdf.pages
      .map((p) =>
        sheetLines(p.items, p)
          .map((l) => l.text)
          .join('\n'),
      )
      .filter((t) => t.trim())
      .join('\n\n')
      .slice(0, PDF_CHARS);
  } catch {
    return '';
  }
}
