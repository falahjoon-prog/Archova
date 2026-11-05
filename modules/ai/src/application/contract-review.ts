// F34 Nova contract review, first slice (ai/11 F34, compliance/08 §11, design/09 CR1-CR2): the commercial team has a
// contract PDF uploaded to the project; Nova reads it into a plain-words summary, the notice periods and time bars,
// and the clauses that depart from the builder's playbook, each quoting its clause. Nova reads and flags: it writes
// no wording (a flag carries the builder's approved fallback wording from the playbook, or says there is none),
// signs and sends nothing, and decides nothing. The review is kept as a pending `ai_suggestions` row that anyone
// holding the commercial review permission on the project can open, because the team works through it together.
import {
  contractAskPrompt,
  contractComparePrompt,
  contractReviewPrompt,
  MAX_CONTRACT_QUESTION_CHARS,
  type BaseForm,
  type ContractType,
  type OurSide,
} from '@archova/ai-prompts';
import { and, desc, eq, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import { localDateOf } from '@archova/time';
import { reviewAnswer, type ReviewedAnswer } from '../domain/contract-ask';
import { reviewComparison, type ReviewedComparison } from '../domain/contract-compare';
import {
  reviewContract,
  type PlaybookTopic,
  type ReviewedContract,
} from '../domain/contract-review';
import { suggestions } from '../infra/tables';
import type { ContractPlaybookService } from './contract-playbook';
import { MAX_CONTRACT_CHARS, readContractText } from './contract-text';
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
  /** Every decision a person recorded on a flag, oldest first; the latest per flag stands. Rows saved before decisions existed have none. */
  decisions?: FlagDecision[];
}

export const FLAG_DECISIONS = [
  'accept_risk',
  'negotiate',
  'refer_to_lawyer',
  'not_relevant',
] as const;
export type FlagDecisionKind = (typeof FLAG_DECISIONS)[number];

/** A person's call on one flag (design/09 CR2). The flag is named by its position in `flags`, which never changes. */
export interface FlagDecision {
  flagIndex: number;
  decision: FlagDecisionKind;
  note: string | null;
  decidedBy: string;
  decidedAt: string;
}

/** One answer to a question about a contract. Nothing is saved: the person keeps what they need. */
export interface ContractAnswer extends ReviewedAnswer {
  runId: string;
  question: string;
  /** Pages with no text layer, and pages cut: a "not addressed" answer may miss what is on them. */
  unreadPages: number[];
  truncated: boolean;
}

/** A comparison of two reviewed contracts. Nothing is saved: the person keeps what they need. */
export interface ContractComparison extends ReviewedComparison {
  runId: string;
  base: ComparedContract;
  other: ComparedContract;
}

/** One side of a comparison, with what Nova could not read of it. */
export interface ComparedContract {
  suggestionId: string;
  fileName: string;
  pageCount: number;
  unreadPages: number[];
  truncated: boolean;
}

export interface ContractReviewRow {
  id: string;
  runId: string;
  createdAt: Date;
  payload: ContractReviewPayload;
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
          payload: { ...payload, decisions: [] },
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

  /** The latest row for this id, locked, after checking the caller holds the review permission. */
  async function load(scope: TenantScope, projectId: string, id: string, lock: boolean) {
    await deps.assert(scope, CONTRACT_REVIEW_PERMISSION, { projectId });
    const q = scope.tx
      .select()
      .from(suggestions)
      .where(
        and(
          eq(suggestions.orgId, scope.ctx.orgId),
          eq(suggestions.projectId, projectId),
          eq(suggestions.id, id),
          eq(suggestions.task, CONTRACT_REVIEW_TASK),
        ),
      )
      .limit(1);
    const [row] = await (lock ? q.for('update') : q);
    if (!row) throw new AppError('ai.suggestion.not_found');
    return row;
  }

  const toRow = (r: typeof suggestions.$inferSelect): ContractReviewRow => ({
    id: r.id,
    runId: r.runId,
    createdAt: r.createdAt,
    payload: r.payload as ContractReviewPayload,
  });

  /** The project's reviews, newest first. Anyone with the review permission sees them all: the team works through them together. */
  async function list(scope: TenantScope, projectId: string, limit = 50) {
    await deps.assert(scope, CONTRACT_REVIEW_PERMISSION, { projectId });
    const rows = await scope.tx
      .select()
      .from(suggestions)
      .where(
        and(
          eq(suggestions.orgId, scope.ctx.orgId),
          eq(suggestions.projectId, projectId),
          eq(suggestions.task, CONTRACT_REVIEW_TASK),
        ),
      )
      .orderBy(desc(suggestions.id))
      .limit(limit);
    return rows.map(toRow);
  }

  async function get(scope: TenantScope, projectId: string, id: string) {
    return toRow(await load(scope, projectId, id, false));
  }

  /**
   * Records a decision on one flag. Decisions are appended, never replaced, so the history stays; the latest one
   * stands. Nothing is sent, signed or changed in the contract. "Not relevant" needs a reason.
   */
  async function decideFlag(
    scope: TenantScope,
    projectId: string,
    id: string,
    flagIndex: number,
    input: { decision: FlagDecisionKind; note: string | null },
  ) {
    const row = await load(scope, projectId, id, true);
    const payload = row.payload as ContractReviewPayload;
    if (!Number.isInteger(flagIndex) || flagIndex < 0 || flagIndex >= payload.flags.length)
      throw new AppError('ai.suggestion.not_found', 'That flag is not in this review.');
    const note = input.note?.trim() || null;
    if (input.decision === 'not_relevant' && !note)
      throw new AppError('validation_failed', 'Say why this flag is not relevant.', [
        { path: 'note', message: 'Required for "Not relevant"' },
      ]);
    const entry: FlagDecision = {
      flagIndex,
      decision: input.decision,
      note,
      decidedBy: scope.ctx.userId,
      decidedAt: now().toISOString(),
    };
    const next: ContractReviewPayload = {
      ...payload,
      decisions: [...(payload.decisions ?? []), entry],
    };
    const [updated] = await scope.tx
      .update(suggestions)
      .set({
        payload: next,
        updatedBy: scope.ctx.userId,
        version: sql`${suggestions.version} + 1`,
      })
      .where(eq(suggestions.id, row.id))
      .returning();
    scope.events.add({
      type: 'ai.contract_flag.decided.v1',
      projectId,
      entityType: 'ai_suggestion',
      entityId: row.id,
      entityVersion: updated!.version,
      data: {
        suggestionId: row.id,
        flagIndex,
        topicKey: payload.flags[flagIndex]!.topicKey,
        decision: input.decision,
      },
    });
    return toRow(updated!);
  }

  /**
   * Answers a question from the reviewed contract's own pages. The file is read again with the caller's own access
   * (a review opened later does not widen who can read the contract). Nova answers only from the pages and quotes
   * the clauses; the answer is shown only with a citation code found on a page. Nothing is saved.
   */
  async function ask(
    ctx: TenantContext,
    projectId: string,
    id: string,
    questionText: string,
    signal?: AbortSignal,
  ): Promise<ContractAnswer> {
    const question = questionText.trim();
    if (question.length < 3 || question.length > MAX_CONTRACT_QUESTION_CHARS)
      throw new AppError('validation_failed', 'Ask a question of up to 500 characters.', [
        { path: 'question', message: 'Between 3 and 500 characters' },
      ]);
    const { file, payload } = await database.withTenantTx(
      ctx,
      async (scope) => {
        const row = await load(scope, projectId, id, false);
        const payload = row.payload as ContractReviewPayload;
        const file = await deps.readFile(scope, payload.fileId, MAX_CONTRACT_BYTES);
        if (file.file.projectId !== projectId)
          throw new AppError('file.not_in_project', 'Attach files uploaded to this project.');
        return { file, payload };
      },
      { readOnly: true },
    );
    const text = await readContractText(file);
    if (!text.pages.length)
      throw new AppError('validation_failed', "Nova couldn't find any text in this PDF.");
    const run = await deps.gateway.runTask(
      ctx,
      contractAskPrompt,
      {
        contractType: payload.contractType,
        ourSide: payload.ourSide,
        baseForm: payload.baseForm,
        question,
        pages: text.pages,
      },
      { projectId, ...(signal ? { signal } : {}) },
    );
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't answer that. Try again.");
    return {
      ...reviewAnswer(run.output, text.pages),
      runId: run.runId,
      question,
      unreadPages: text.unreadPages,
      truncated: text.truncated,
    };
  }

  /**
   * Compares the contracts two reviews of this project were made from (two versions of one contract, or two
   * contracts) and lists what differs, clause by clause. Both files are read again with the caller's own access, each
   * to half the usual character budget so the two together are no bigger than one review. A change is shown only when
   * its quotes are found on the pages of the contract they name. Nothing is saved.
   */
  async function compare(
    ctx: TenantContext,
    projectId: string,
    baseId: string,
    otherId: string,
    signal?: AbortSignal,
  ): Promise<ContractComparison> {
    if (baseId === otherId)
      throw new AppError('validation_failed', 'Pick two different contracts to compare.', [
        { path: 'otherReviewId', message: 'Same as the base contract' },
      ]);
    const loaded = await database.withTenantTx(
      ctx,
      async (scope) => {
        const out = [];
        for (const id of [baseId, otherId]) {
          const row = await load(scope, projectId, id, false);
          const payload = row.payload as ContractReviewPayload;
          const file = await deps.readFile(scope, payload.fileId, MAX_CONTRACT_BYTES);
          if (file.file.projectId !== projectId)
            throw new AppError('file.not_in_project', 'Attach files uploaded to this project.');
          out.push({ id, payload, file });
        }
        return out as [(typeof out)[number], (typeof out)[number]];
      },
      { readOnly: true },
    );
    const [b, o] = loaded;
    const half = Math.floor(MAX_CONTRACT_CHARS / 2);
    const [baseText, otherText] = await Promise.all([
      readContractText(b.file, half),
      readContractText(o.file, half),
    ]);
    if (!baseText.pages.length || !otherText.pages.length)
      throw new AppError('validation_failed', "Nova couldn't find any text in one of these PDFs.");
    const run = await deps.gateway.runTask(
      ctx,
      contractComparePrompt,
      {
        contractType: b.payload.contractType,
        ourSide: b.payload.ourSide,
        base: baseText.pages,
        other: otherText.pages,
      },
      { projectId, ...(signal ? { signal } : {}) },
    );
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't compare these contracts. Try again.");
    const side = (
      x: (typeof loaded)[number],
      t: Awaited<ReturnType<typeof readContractText>>,
    ): ComparedContract => ({
      suggestionId: x.id,
      fileName: x.payload.fileName,
      pageCount: t.pageCount,
      unreadPages: t.unreadPages,
      truncated: t.truncated,
    });
    return {
      ...reviewComparison(run.output, baseText.pages, otherText.pages),
      runId: run.runId,
      base: side(b, baseText),
      other: side(o, otherText),
    };
  }

  return { review, list, get, decideFlag, ask, compare };
}

export type ContractReviewService = ReturnType<typeof createContractReviewService>;
