import { encodeId } from '@archova/domain';
import { fromCents } from '../domain/money';
import type { RetentionService } from '../application/retention';

type View = Awaited<ReturnType<RetentionService['get']>>;

export const toRetentionDto = (v: View) => ({
  contractId: encodeId('contract', v.contract.id),
  terms: {
    practicalCompletionOn: v.terms.practicalCompletionOn,
    defectsPeriodDays: v.terms.defectsPeriodDays,
    firstReleasePct: v.terms.firstReleasePct,
  },
  retentionHeld: fromCents(v.retentionHeldCents),
  stages: v.stages.map((s) => ({
    stage: s.stage,
    dueOn: s.dueOn,
    entitled: fromCents(s.entitledCents),
    released: fromCents(s.releasedCents),
    remaining: fromCents(s.remainingCents),
    status: s.status,
  })),
  releases: v.releases.map((r) => ({
    stage: r.stage,
    amount: r.amount,
    releasedOn: r.releasedOn,
    reference: r.reference,
    note: r.note,
    recordedAt: r.recordedAt.toISOString(),
  })),
});
