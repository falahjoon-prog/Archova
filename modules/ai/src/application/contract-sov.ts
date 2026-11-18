// Nova fills a contract's schedule of values (CLM-US1). The person uploads the contract PDF (or its pricing schedule)
// to the project; Nova reads it into Code / Description / Amount lines with the page and words each came from. The
// lines come back as a proposal only: nothing is saved here, and the web form saves nothing until the person accepts
// or edits each line and presses Save contract. Code adds the lines up against the contract value and says when they
// differ; Nova never adds a balancing line.
import { contractSovPrompt } from '@archova/ai-prompts';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import { reviewSov, type ReviewedSov } from '../domain/contract-sov';
import { centsToAmount, moneyCents } from '../domain/quote-read';
import { MAX_CONTRACT_BYTES } from './contract-review';
import { readContractText } from './contract-text';
import type { ReadableFile } from './drawing-register';
import type { Gateway } from './gateway';

/** The person who sets up the contract is the one who may ask Nova to fill its schedule. */
export const CONTRACT_SOV_PERMISSION = 'financials.contracts.manage';

export interface ContractSovDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask'>;
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
  readFile: (scope: TenantScope, fileId: string, maxBytes: number) => Promise<ReadableFile>;
}

export interface ContractSovDraft extends ReviewedSov {
  runId: string;
  fileName: string;
  pageCount: number;
  /** Pages with no text layer, and pages cut: a short list may miss lines on them. */
  unreadPages: number[];
  truncated: boolean;
}

export function createContractSovService(deps: ContractSovDeps) {
  const { database } = deps;

  async function draft(
    ctx: TenantContext,
    projectId: string,
    input: { fileId: string; contractValue: string | null },
    signal?: AbortSignal,
  ): Promise<ContractSovDraft> {
    const cents = input.contractValue === null ? null : moneyCents(input.contractValue);
    if (input.contractValue !== null && (cents === null || cents <= 0))
      throw new AppError('validation_failed', 'Enter the contract value as a dollar amount.', [
        { path: 'contractValue', message: 'Not a dollar amount' },
      ]);
    const value = cents === null ? null : centsToAmount(cents);
    const file = await database.withTenantTx(
      ctx,
      async (scope) => {
        await deps.assert(scope, CONTRACT_SOV_PERMISSION, { projectId });
        const file = await deps.readFile(scope, input.fileId, MAX_CONTRACT_BYTES);
        // A file from another project is not this caller's to send to the model from here.
        if (file.file.projectId !== projectId)
          throw new AppError('file.not_in_project', 'Attach files uploaded to this project.', [
            { path: 'fileId', message: 'Not a file of this project' },
          ]);
        return file;
      },
      { readOnly: true },
    );
    const text = await readContractText(file);
    if (!text.pages.length)
      throw new AppError('validation_failed', "Nova couldn't find any text in this PDF.", [
        { path: 'fileId', message: 'No readable text' },
      ]);
    const run = await deps.gateway.runTask(
      ctx,
      contractSovPrompt,
      { contractValue: value, pages: text.pages },
      { projectId, ...(signal ? { signal } : {}) },
    );
    if (run.status !== 'ok')
      throw new AppError(
        'ai.invalid_output',
        "Nova couldn't read a schedule of values. Try again.",
      );
    return {
      ...reviewSov(run.output, text.pages, value),
      runId: run.runId,
      fileName: file.file.filename,
      pageCount: text.pageCount,
      unreadPages: text.unreadPages,
      truncated: text.truncated,
    };
  }

  return { draft };
}

export type ContractSovService = ReturnType<typeof createContractSovService>;
