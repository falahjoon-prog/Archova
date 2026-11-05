import { and, asc, eq, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { localDateOf } from '@archova/time';
import { AppError, type TenantScope } from '@archova/kernel';
import { fromCents, toCents } from '../domain/money';
import { releaseStages, type ReleaseStage } from '../domain/release';
import { paymentClaims, retentionReleases, retentionTerms } from '../infra/tables';
import type { TrustDeps, TrustService } from './trust';

export type RetentionReleaseRow = typeof retentionReleases.$inferSelect;

export interface SaveTermsInput {
  practicalCompletionOn?: string | null;
  defectsPeriodDays?: number | null;
  firstReleasePct?: string;
}

export interface RecordReleaseInput {
  stage: ReleaseStage;
  amount: string;
  releasedOn: string;
  reference: string;
  note?: string;
  /** False to record the release without taking it out of the trust account. Default: take it out when one is set up. */
  fromTrust?: boolean;
}

const hundredths = (pct: string) => Math.round(Number(pct) * 100);

export function createRetentionService(
  deps: TrustDeps,
  trust: Pick<TrustService, 'releaseFromTrust'>,
) {
  const now = deps.now ?? (() => new Date());

  async function view(scope: TenantScope, projectId: string, contractId: string, seeAll: boolean) {
    const contract = await deps.contractFor(scope, projectId, contractId, seeAll);
    const [terms] = await scope.tx
      .select()
      .from(retentionTerms)
      .where(eq(retentionTerms.contractId, contractId))
      .limit(1);
    const releases = await scope.tx
      .select()
      .from(retentionReleases)
      .where(eq(retentionReleases.contractId, contractId))
      .orderBy(asc(retentionReleases.releasedOn), asc(retentionReleases.recordedAt));
    const [held] = await scope.tx
      .select({ total: sql<string>`coalesce(sum(${paymentClaims.retention}), 0)` })
      .from(paymentClaims)
      .where(and(eq(paymentClaims.contractId, contractId), eq(paymentClaims.isValid, true)));
    const retentionHeldCents = toCents(held?.total ?? '0');
    const releasedByStage: Partial<Record<ReleaseStage, number>> = {};
    for (const r of releases)
      releasedByStage[r.stage] = (releasedByStage[r.stage] ?? 0) + toCents(r.amount);
    const today = localDateOf(now(), (await deps.platform.getProject(scope, projectId)).timezone);
    const effective = {
      practicalCompletionOn: terms?.practicalCompletionOn ?? null,
      defectsPeriodDays: terms?.defectsPeriodDays ?? null,
      firstReleasePct: terms?.firstReleasePct ?? '50.00',
    };
    const stages = releaseStages({
      terms: {
        firstReleasePctHundredths: hundredths(effective.firstReleasePct),
        practicalCompletionOn: effective.practicalCompletionOn,
        defectsPeriodDays: effective.defectsPeriodDays,
      },
      retentionHeldCents,
      releasedByStage,
      today,
    });
    return { contract, terms: effective, retentionHeldCents, stages, releases };
  }

  async function get(scope: TenantScope, projectId: string, contractId: string) {
    await deps.access.assert(scope, 'financials.contracts.read', { projectId });
    return view(scope, projectId, contractId, false);
  }

  async function saveTerms(
    scope: TenantScope,
    projectId: string,
    contractId: string,
    input: SaveTermsInput,
  ) {
    await deps.access.assert(scope, 'financials.retention.manage', { projectId });
    await deps.requireStaff(scope, projectId, 'set retention release terms');
    await deps.contractFor(scope, projectId, contractId, true);
    const pct = input.firstReleasePct;
    if (pct !== undefined && !(Number(pct) >= 0 && Number(pct) <= 100))
      throw new AppError('validation_failed', 'Invalid percentage');
    const values = {
      ...(input.practicalCompletionOn !== undefined
        ? { practicalCompletionOn: input.practicalCompletionOn }
        : {}),
      ...(input.defectsPeriodDays !== undefined
        ? { defectsPeriodDays: input.defectsPeriodDays }
        : {}),
      ...(pct !== undefined ? { firstReleasePct: pct } : {}),
      updatedAt: now(),
      updatedBy: scope.ctx.userId,
    };
    await scope.tx
      .insert(retentionTerms)
      .values({ id: uuidv7(), orgId: scope.ctx.orgId, projectId, contractId, ...values })
      .onConflictDoUpdate({
        target: [retentionTerms.orgId, retentionTerms.contractId],
        set: values,
      });
    return view(scope, projectId, contractId, true);
  }

  async function recordRelease(
    scope: TenantScope,
    projectId: string,
    contractId: string,
    input: RecordReleaseInput,
  ) {
    await deps.access.assert(scope, 'financials.retention.manage', { projectId });
    await deps.requireStaff(scope, projectId, 'record a retention release');
    // Serialise releases on one contract so two people can't both take the last of an entitlement.
    await deps.contractFor(scope, projectId, contractId, true);
    await scope.tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${contractId}, 0))`);
    const before = await view(scope, projectId, contractId, true);
    const stage = before.stages.find((s) => s.stage === input.stage)!;
    if (stage.status === 'awaiting_date') throw new AppError('financials.retention.terms_missing');
    const cents = toCents(input.amount);
    if (cents === 0) throw new AppError('validation_failed', 'Amount must be more than zero');
    if (cents > stage.remainingCents) throw new AppError('financials.retention.over_entitlement');
    // Money leaves the trust account in the same transaction, or the release is refused.
    if (input.fromTrust !== false)
      await trust.releaseFromTrust(scope, projectId, contractId, {
        amount: fromCents(cents),
        movedOn: input.releasedOn,
        reference: input.reference,
        ...(input.note ? { note: input.note } : {}),
      });
    const id = uuidv7();
    await scope.tx.insert(retentionReleases).values({
      id,
      orgId: scope.ctx.orgId,
      projectId,
      contractId,
      stage: input.stage,
      amount: fromCents(cents),
      releasedOn: input.releasedOn,
      reference: input.reference,
      note: input.note ?? null,
      recordedBy: scope.ctx.userId,
    });
    scope.events.add({
      type: 'financials.retention.released.v1',
      projectId,
      entityType: 'contract',
      entityId: contractId,
      entityVersion: 1,
      data: { contractId, stage: input.stage, amount: fromCents(cents) },
    });
    return view(scope, projectId, contractId, true);
  }

  return { get, saveTerms, recordRelease };
}

export type RetentionService = ReturnType<typeof createRetentionService>;
