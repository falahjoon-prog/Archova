// F22 quote reading (ai/10 E3, product/10 EST-US4): an estimator has a subcontractor's PDF quote for a tender package;
// Nova reads it into priced lines, exclusions, qualifications and provisional sums, each linked to the page and words
// it came from, with a check of the lines against the total the quote prints. Nova creates no quote: the estimator
// compares the reading with the PDF, edits it, picks the company and saves the quote, passing `suggestionId` so the
// quote records where it came from (EST-AC5) and the "lines and prices read correctly" bar can be measured. The reading
// is kept as a pending `ai_suggestions` row that only the person who asked can see or decide: a subcontractor's prices
// are commercial in confidence until the builder chooses to compare them.
import { MAX_QUOTE_SCOPE_LINES, quoteReadPrompt, type QuoteScopeLine } from '@archova/ai-prompts';
import { uuidv7 } from '@archova/domain';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import { reviewQuoteRead, type ReviewedQuoteRead } from '../domain/quote-read';
import { suggestions } from '../infra/tables';
import type { ReadableFile } from './drawing-register';
import type { Gateway } from './gateway';
import { readQuoteText } from './quote-text';

/** Quote PDFs are small; a larger file is a scan of a whole document set, not a quote. */
export const MAX_QUOTE_BYTES = 30 * 1024 * 1024;

export interface QuoteReadDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask' | 'ocr'>;
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
  readFile: (scope: TenantScope, fileId: string, maxBytes: number) => Promise<ReadableFile>;
  /**
   * `estimating.api.scopeForQuoteReading`: the package's trade and scope lines. Throws `tender.not_found` when the
   * caller can't see the package and `tender.invalid_state` when it is not taking quotes.
   */
  quotePackage: (
    scope: TenantScope,
    projectId: string,
    packageId: string,
  ) => Promise<{ id: string; trade: string; scope: QuoteScopeLine[] }>;
}

/** The `ai_suggestions` row kind; `targetType` `tender_package` with the package as the target. */
export const QUOTE_READ_TASK = quoteReadPrompt.id;
/** Reading a quote and deciding the reading both need the builder-side quote review permission. */
export const QUOTE_READ_PERMISSION = 'estimating.quotes.review';

/** `ai_suggestions.payload` for `quote.read`: the reading as Nova gave it after code checked it. */
export interface QuoteReadPayload extends ReviewedQuoteRead {
  packageId: string;
  fileId: string;
  pageCount: number;
  scannedPages: number[];
  skippedPages: number[];
}

export interface QuoteReading extends QuoteReadPayload {
  runId: string;
  /** The saved `ai_suggestions` row; pass it as `aiSuggestionId` when saving the quote, then decide it. */
  suggestionId: string;
  /** Pages were cut, or left out, to stay inside the limits. */
  truncated: boolean;
}

export function createQuoteReadService(deps: QuoteReadDeps) {
  const { database } = deps;

  async function read(
    ctx: TenantContext,
    projectId: string,
    input: { packageId: string; fileId: string },
    signal?: AbortSignal,
  ): Promise<QuoteReading> {
    const { pkg, file } = await database.withTenantTx(
      ctx,
      async (scope) => {
        await deps.assert(scope, QUOTE_READ_PERMISSION, { projectId });
        const pkg = await deps.quotePackage(scope, projectId, input.packageId);
        const file = await deps.readFile(scope, input.fileId, MAX_QUOTE_BYTES);
        // A file from another project is not this caller's to send to the model from here.
        if (file.file.projectId !== projectId)
          throw new AppError('file.not_in_project', 'Attach files uploaded to this project.', [
            { path: 'fileId', message: 'Not a file of this project' },
          ]);
        return { pkg, file };
      },
      { readOnly: true },
    );

    const text = await readQuoteText(deps.gateway, ctx, projectId, file);
    if (!text.pages.length)
      throw new AppError('validation_failed', "Nova couldn't find any text in this PDF.", [
        { path: 'fileId', message: 'No readable text' },
      ]);
    // The model gets the scope as the estimator wrote it, bounded to what the prompt takes.
    const scopeLines = pkg.scope.slice(0, MAX_QUOTE_SCOPE_LINES).map((s) => ({
      ...s,
      description: s.description.slice(0, 300),
      unit: s.unit.slice(0, 20),
    }));
    const run = await deps.gateway.runTask(
      ctx,
      quoteReadPrompt,
      { trade: pkg.trade.slice(0, 100), scope: scopeLines, pages: text.pages },
      { projectId, ...(signal ? { signal } : {}) },
    );
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't read this quote. Try again.");

    const payload: QuoteReadPayload = {
      ...reviewQuoteRead(run.output, scopeLines, text.pages),
      packageId: pkg.id,
      fileId: input.fileId,
      pageCount: text.pageCount,
      scannedPages: text.scannedPages,
      skippedPages: text.skippedPages,
    };
    const suggestionId = await database.withTenantTx(ctx, async (scope) => {
      const [row] = await scope.tx
        .insert(suggestions)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          targetType: 'tender_package',
          targetId: pkg.id,
          task: QUOTE_READ_TASK,
          promptVersion: quoteReadPrompt.version,
          payload,
          status: 'pending',
          runId: run.runId,
          createdBy: scope.ctx.userId,
          updatedBy: scope.ctx.userId,
        })
        .returning({ id: suggestions.id });
      return row!.id;
    });
    return { ...payload, runId: run.runId, suggestionId, truncated: text.truncated };
  }

  return { read };
}

export type QuoteReadService = ReturnType<typeof createQuoteReadService>;
