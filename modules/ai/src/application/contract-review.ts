// F34 Nova contract review, first slice (ai/11 F34, compliance/08 §11, design/09 CR1-CR2): the commercial team has a
// contract PDF uploaded to the project; Nova reads it into a plain-words summary, the notice periods and time bars,
// and the clauses that depart from the builder's playbook, each quoting its clause. Nova reads and flags: it writes
// no wording (a flag carries the builder's approved fallback wording from the playbook, or says there is none),
// signs and sends nothing, and decides nothing. The review is kept as a pending `ai_suggestions` row that anyone
// holding the commercial review permission on the project can open, because the team works through it together.
import {
  contractReviewPrompt,
  type BaseForm,
  type ContractType,
  type OurSide,
} from '@archova/ai-prompts';
import { uuidv7 } from '@archova/domain';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import { localDateOf } from '@archova/time';
import {
  reviewContract,
  type PlaybookTopic,
  type ReviewedContract,
} from '../domain/contract-review';
import { suggestions } from '../infra/tables';
import type { ContractPlaybookService } from './contract-playbook';
import { readContractText } from './contract-text';
import type { ReadableFile } from './drawing-register';
import type { Gateway } from './gateway';

/** A contract is bigger than a quote but not a document set: a larger file is refused. */
export const MAX_CONTRACT_BYTES = 60 * 1024 * 1024;

/** Reading and deciding a review need the commercial (commitments admin) role on the project. */
export const CONTRACT_REVIEW_PERMISSION = 'ai.contracts.review';
export const CONTRACT_REVIEW_TASK = contractReviewPrompt.id;

export interface ContractReviewDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask'>;
  playbooks: ContractPlaybookService;
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
  readFile: (scope: TenantScope, fileId: string, maxBytes: number) => Promise<ReadableFile>;
  orgTimeZone: (scope: TenantScope) => Promise<string>;
  now?: () => Date;
}

export interface ContractReviewInput {
  fileId: string;
  contractType: ContractType;
  ourSide: OurSide;
  baseForm: BaseForm | null;
  /** The contract covers work in more than one state: statutory checks are for a person (none run in this slice). */
  multiState: boolean;
}

/** `ai_suggestions.payload` for `contract.review`. */
export interface ContractReviewPayload extends ReviewedContract {
  fileId: string;
  fileName: string;
  contractType: ContractType;
  ourSide: OurSide;
  baseForm: BaseForm | null;
  multiState: boolean;
  /** The builder has no playbook for this contract type, so no departures were looked for. */
  playbookMissing: boolean;
  playbookTopics: number;
  pageCount: number;
  /** Pages with no text layer: not read. The review may miss clauses on them. */
  unreadPages: number[];
  truncated: boolean;
}

export interface ContractReview extends ContractReviewPayload {
  runId: string;
  suggestionId: string;
}

export function createContractReviewService(deps: ContractReviewDeps) {
  const { database } = deps;
  const now = deps.now ?? (() => new Date());

  async function review(
    ctx: TenantContext,
    projectId: string,
    input: ContractReviewInput,
    signal?: AbortSignal,
  ): Promise<ContractReview> {
    const { file, playbook, today } = await database.withTenantTx(
      ctx,
      async (scope) => {
        await deps.assert(scope, CONTRACT_REVIEW_PERMISSION, { projectId });
        const file = await deps.readFile(scope, input.fileId, MAX_CONTRACT_BYTES);
        // A file from another project is not this caller's to send to the model from here.
        if (file.file.projectId !== projectId)
          throw new AppError('file.not_in_project', 'Attach files uploaded to this project.', [
            { path: 'fileId', message: 'Not a file of this project' },
          ]);
        const playbook = await deps.playbooks.list(scope, input.contractType);
        const today = localDateOf(now(), await deps.orgTimeZone(scope));
        return { file, playbook, today };
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
      contractReviewPrompt,
      {
        contractType: input.contractType,
        ourSide: input.ourSide,
        baseForm: input.baseForm,
        playbook: playbook.map(({ key, topic, position, threshold }: PlaybookTopic) => ({
          key,
          topic,
          position,
          threshold,
        })),
        pages: text.pages,
      },
      { projectId, ...(signal ? { signal } : {}) },
    );
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't review this contract. Try again.");

    const payload: ContractReviewPayload = {
      ...reviewContract(run.output, text.pages, playbook, today),
      fileId: input.fileId,
      fileName: file.file.filename,
      contractType: input.contractType,
      ourSide: input.ourSide,
      baseForm: input.baseForm,
      multiState: input.multiState,
      playbookMissing: playbook.length === 0,
      playbookTopics: playbook.length,
      pageCount: text.pageCount,
      unreadPages: text.unreadPages,
      truncated: text.truncated,
    };
    const suggestionId = await database.withTenantTx(ctx, async (scope) => {
      const [row] = await scope.tx
        .insert(suggestions)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          targetType: 'contract_file',
          targetId: input.fileId,
          task: CONTRACT_REVIEW_TASK,
          promptVersion: contractReviewPrompt.version,
          payload,
          status: 'pending',
          runId: run.runId,
          createdBy: scope.ctx.userId,
          updatedBy: scope.ctx.userId,
        })
        .returning({ id: suggestions.id });
      return row!.id;
    });
    return { ...payload, runId: run.runId, suggestionId };
  }

  return { review };
}

export type ContractReviewService = ReturnType<typeof createContractReviewService>;
