import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { encodeId } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import {
  applies,
  checkSteps,
  everyStepHasApprover,
  nextState,
  refusal,
  toCents,
  type Outcome,
  type StepDef,
} from '../domain/workflow';
import { definitions, runDecisions, runs, type SubjectType } from '../infra/tables';

type DefRow = typeof definitions.$inferSelect;
type RunRow = typeof runs.$inferSelect;
type DecisionRow = typeof runDecisions.$inferSelect;

const SUBJECTS: readonly SubjectType[] = ['financials.variation'];

export interface WorkflowInput {
  subjectType: SubjectType;
  name: string;
  minAmount?: string | null;
  steps: { name: string; approverUserIds: string[] }[];
  active?: boolean;
}

export function toWorkflowDto(r: DefRow) {
  return {
    id: encodeId('workflow', r.id),
    subjectType: r.subjectType,
    name: r.name,
    minAmount: r.minAmount,
    steps: r.steps.map((s) => ({
      name: s.name,
      approverUserIds: s.approverUserIds.map((u) => encodeId('user', u)),
    })),
    active: r.active,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toRunDto(r: RunRow, decisions: DecisionRow[]) {
  const byStep = new Map(decisions.map((d) => [d.stepIndex, d]));
  return {
    id: encodeId('workflowRun', r.id),
    subjectType: r.subjectType,
    subjectId: encodeId('variation', r.subjectId),
    status: r.status,
    currentStep: r.currentStep,
    steps: r.steps.map((s, i) => {
      const d = byStep.get(i);
      return {
        name: s.name,
        approverUserIds: s.approverUserIds.map((u) => encodeId('user', u)),
        state: d
          ? d.decision
          : r.status === 'pending' && r.currentStep === i
            ? ('current' as const)
            : ('waiting' as const),
        decision: d
          ? {
              userId: encodeId('user', d.userId),
              decision: d.decision,
              note: d.note,
              decidedAt: d.decidedAt.toISOString(),
            }
          : null,
      };
    }),
    startedBy: encodeId('user', r.startedBy),
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
  };
}

const isUnique = (e: unknown) =>
  String((e as { cause?: { code?: string } }).cause?.code ?? '') === '23505';

export function createWorkflowsService(deps: { newId: () => string; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());

  function clean(input: Pick<WorkflowInput, 'steps'>) {
    const { steps, problems } = checkSteps(input.steps);
    if (problems.length)
      throw new AppError('validation_failed', 'Check the steps of this workflow.', problems);
    return steps;
  }

  async function loadDef(scope: TenantScope, id: string): Promise<DefRow> {
    const [row] = await scope.tx
      .select()
      .from(definitions)
      .where(and(eq(definitions.id, id), isNull(definitions.deletedAt)))
      .limit(1);
    if (!row) throw new AppError('workflow.not_found');
    return row;
  }

  const activeExists = () =>
    new AppError(
      'workflow.active_exists',
      'There is already an active workflow for this kind of record. Switch it off first.',
    );

  async function decisionsOf(scope: TenantScope, runId: string) {
    return scope.tx
      .select()
      .from(runDecisions)
      .where(eq(runDecisions.runId, runId))
      .orderBy(asc(runDecisions.stepIndex));
  }

  return {
    async list(scope: TenantScope) {
      const rows = await scope.tx
        .select()
        .from(definitions)
        .where(isNull(definitions.deletedAt))
        .orderBy(asc(definitions.createdAt));
      return { data: rows.map(toWorkflowDto) };
    },

    async create(scope: TenantScope, input: WorkflowInput) {
      if (!SUBJECTS.includes(input.subjectType))
        throw new AppError('validation_failed', 'That kind of record has no workflows yet.', [
          { path: 'subjectType', message: 'Not supported' },
        ]);
      const steps = clean(input);
      try {
        const [row] = await scope.tx
          .insert(definitions)
          .values({
            id: deps.newId(),
            orgId: scope.ctx.orgId,
            subjectType: input.subjectType,
            name: input.name.trim(),
            minAmount: input.minAmount ?? null,
            steps,
            active: input.active ?? true,
            createdBy: scope.ctx.userId,
          })
          .returning();
        return toWorkflowDto(row!);
      } catch (e) {
        if (isUnique(e)) throw activeExists();
        throw e;
      }
    },

    async update(
      scope: TenantScope,
      id: string,
      input: Partial<Omit<WorkflowInput, 'subjectType'>>,
    ) {
      await loadDef(scope, id);
      const steps = input.steps ? clean({ steps: input.steps }) : undefined;
      try {
        const [row] = await scope.tx
          .update(definitions)
          .set({
            ...(input.name !== undefined ? { name: input.name.trim() } : {}),
            ...(input.minAmount !== undefined ? { minAmount: input.minAmount } : {}),
            ...(steps ? { steps } : {}),
            ...(input.active !== undefined ? { active: input.active } : {}),
            updatedAt: now(),
          })
          .where(eq(definitions.id, id))
          .returning();
        return toWorkflowDto(row!);
      } catch (e) {
        if (isUnique(e)) throw activeExists();
        throw e;
      }
    },

    async remove(scope: TenantScope, id: string) {
      await loadDef(scope, id);
      await scope.tx
        .update(definitions)
        .set({ deletedAt: now(), active: false, updatedAt: now() })
        .where(eq(definitions.id, id));
    },

    /**
     * Starts a run when the org has an active chain for this kind of record and the amount reaches its minimum.
     * Returns null when nothing applies, so callers fall back to their own approval. Called by the owning module
     * inside the same transaction as the submission.
     */
    async start(
      scope: TenantScope,
      input: {
        projectId: string;
        subjectType: SubjectType;
        subjectId: string;
        amount: string;
      },
    ) {
      const [def] = await scope.tx
        .select()
        .from(definitions)
        .where(
          and(
            eq(definitions.subjectType, input.subjectType),
            eq(definitions.active, true),
            isNull(definitions.deletedAt),
          ),
        )
        .limit(1);
      if (!def) return null;
      const minCents = def.minAmount === null ? null : toCents(def.minAmount);
      if (!applies({ minAmountCents: minCents }, toCents(input.amount))) return null;
      if (!everyStepHasApprover(def.steps, scope.ctx.userId))
        throw new AppError(
          'workflow.no_eligible_approver',
          'This approval workflow has a step only you could approve. Ask an admin to add another approver.',
        );
      const [run] = await scope.tx
        .insert(runs)
        .values({
          id: deps.newId(),
          orgId: scope.ctx.orgId,
          projectId: input.projectId,
          definitionId: def.id,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          steps: def.steps,
          currentStep: 0,
          startedBy: scope.ctx.userId,
        })
        .returning();
      scope.events.add({
        type: 'workflows.run.started.v1',
        projectId: input.projectId,
        entityType: 'workflow_run',
        entityId: run!.id,
        entityVersion: 1,
        data: {
          runId: run!.id,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          approverUserIds: def.steps[0]!.approverUserIds,
        },
      });
      return toRunDto(run!, []);
    },

    /**
     * The caller decides the current step of the record's pending run. Returns null when the record has no pending
     * run (the owning module then uses its own approval). Throws if the caller is not allowed to decide this step.
     */
    async decide(
      scope: TenantScope,
      input: {
        subjectType: SubjectType;
        subjectId: string;
        decision: 'approved' | 'rejected';
        note?: string | undefined;
      },
    ): Promise<{ outcome: Outcome; run: ReturnType<typeof toRunDto> } | null> {
      const [run] = await scope.tx
        .select()
        .from(runs)
        .where(
          and(
            eq(runs.subjectType, input.subjectType),
            eq(runs.subjectId, input.subjectId),
            eq(runs.status, 'pending'),
          ),
        )
        .for('update')
        .limit(1);
      if (!run || run.currentStep === null) return null;
      const index = run.currentStep;
      const step: StepDef = run.steps[index]!;
      const earlier = await decisionsOf(scope, run.id);
      const why = refusal(
        step,
        scope.ctx.userId,
        run.startedBy,
        earlier.map((d) => d.userId),
      );
      if (why === 'own_submission')
        throw new AppError(
          'workflow.own_submission',
          'You submitted this, so someone else has to approve it.',
        );
      if (why === 'not_approver' || why === 'already_decided_earlier')
        throw new AppError(
          'workflow.not_approver',
          why === 'not_approver'
            ? `This step (${step.name}) is waiting on someone else.`
            : 'You already approved an earlier step. A different person decides this one.',
        );
      const at = now();
      await scope.tx.insert(runDecisions).values({
        id: deps.newId(),
        orgId: scope.ctx.orgId,
        runId: run.id,
        stepIndex: index,
        userId: scope.ctx.userId,
        decision: input.decision,
        note: input.note?.trim() || null,
        decidedAt: at,
      });
      const next = nextState(index, run.steps.length, input.decision);
      const [updated] = await scope.tx
        .update(runs)
        .set({
          currentStep: next.currentStep,
          ...(next.outcome === 'advanced' ? {} : { status: next.outcome, finishedAt: at }),
        })
        .where(eq(runs.id, run.id))
        .returning();
      scope.events.add({
        type: `workflows.run.${next.outcome === 'advanced' ? 'advanced' : next.outcome}.v1`,
        projectId: run.projectId,
        entityType: 'workflow_run',
        entityId: run.id,
        entityVersion: index + 1,
        data: {
          runId: run.id,
          subjectType: run.subjectType,
          subjectId: run.subjectId,
          step: index,
          by: scope.ctx.userId,
          ...(next.outcome === 'advanced'
            ? { approverUserIds: run.steps[index + 1]!.approverUserIds }
            : {}),
        },
      });
      return { outcome: next.outcome, run: toRunDto(updated!, await decisionsOf(scope, run.id)) };
    },

    /** The record was withdrawn: end its pending run, if any. */
    async cancel(scope: TenantScope, subjectType: SubjectType, subjectId: string) {
      await scope.tx
        .update(runs)
        .set({ status: 'cancelled', currentStep: null, finishedAt: now() })
        .where(
          and(
            eq(runs.subjectType, subjectType),
            eq(runs.subjectId, subjectId),
            eq(runs.status, 'pending'),
          ),
        );
    },

    /** The latest run of a record with its decisions, or null. */
    async forSubject(scope: TenantScope, subjectType: SubjectType, subjectId: string) {
      const [run] = await scope.tx
        .select()
        .from(runs)
        .where(and(eq(runs.subjectType, subjectType), eq(runs.subjectId, subjectId)))
        .orderBy(desc(runs.createdAt))
        .limit(1);
      return run ? toRunDto(run, await decisionsOf(scope, run.id)) : null;
    },
  };
}

export type WorkflowsService = ReturnType<typeof createWorkflowsService>;
