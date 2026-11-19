// Subcontractor declaration reading: a builder has a subcontractor's workers' compensation certificate, payroll tax or
// wages declaration uploaded as a PDF; Nova reads it into the register's fields, each linked to the page and words it
// came from. Nova records nothing: the person checks the reading against the PDF and records the declaration
// themselves, the same as for every other Nova reading.
import { declarationReadPrompt } from '@archova/ai-prompts';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import { reviewDeclarationRead, type ReviewedDeclarationRead } from '../domain/declaration-read';
import type { ReadableFile } from './drawing-register';
import { readDeclarationText } from './declaration-text';
import type { Gateway } from './gateway';

/** Declarations are one to a few pages; a larger file is a document set, not a declaration. */
export const MAX_DECLARATION_BYTES = 15 * 1024 * 1024;
/** Reading needs the same permission as recording the declaration. */
export const DECLARATION_READ_PERMISSION = 'declarations.statements.manage';

export interface DeclarationReadDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask' | 'ocr'>;
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
  readFile: (scope: TenantScope, fileId: string, maxBytes: number) => Promise<ReadableFile>;
}

export interface DeclarationReading extends ReviewedDeclarationRead {
  runId: string;
  fileId: string;
  pageCount: number;
  scannedPages: number[];
  skippedPages: number[];
  truncated: boolean;
}

export function createDeclarationReadService(deps: DeclarationReadDeps) {
  async function read(
    ctx: TenantContext,
    projectId: string,
    input: { fileId: string },
    signal?: AbortSignal,
  ): Promise<DeclarationReading> {
    const file = await deps.database.withTenantTx(
      ctx,
      async (scope) => {
        await deps.assert(scope, DECLARATION_READ_PERMISSION, { projectId });
        const f = await deps.readFile(scope, input.fileId, MAX_DECLARATION_BYTES);
        // A file from another project is not this caller's to send to the model from here.
        if (f.file.projectId !== projectId)
          throw new AppError('file.not_in_project', 'Attach files uploaded to this project.', [
            { path: 'fileId', message: 'Not a file of this project' },
          ]);
        return f;
      },
      { readOnly: true },
    );
    const text = await readDeclarationText(deps.gateway, ctx, projectId, file);
    if (!text.pages.length)
      throw new AppError('validation_failed', "Nova couldn't find any text in this PDF.", [
        { path: 'fileId', message: 'No readable text' },
      ]);
    const run = await deps.gateway.runTask(
      ctx,
      declarationReadPrompt,
      { pages: text.pages },
      { projectId, ...(signal ? { signal } : {}) },
    );
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't read this document. Try again.");
    return {
      ...reviewDeclarationRead(run.output, text.pages),
      runId: run.runId,
      fileId: input.fileId,
      pageCount: text.pageCount,
      scannedPages: text.scannedPages,
      skippedPages: text.skippedPages,
      truncated: text.truncated,
    };
  }
  return { read };
}

export type DeclarationReadService = ReturnType<typeof createDeclarationReadService>;
