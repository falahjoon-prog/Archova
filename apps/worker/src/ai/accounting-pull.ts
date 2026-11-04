// Pulls payments from Xero and MYOB and records them against the claim (integrations/02 A7). Loaded by the ai-worker only.
//
// One transaction per org and provider: the connector stores each payment and moves its "last pulled" mark, and the
// claims module records the payment, so a failure leaves neither half behind and the next run picks the same payments
// up again. Safe to repeat. A transient provider error throws so the job retries; a refusal that needs a person is
// already a sync issue inside the connector.
import type { Modules } from '@archova/compose';
import { jobContext } from '../subscribers';
import type { Database } from '@archova/kernel';

const PROVIDERS = ['xero', 'myob'] as const;

export interface AccountingPullDeps {
  financials: Pick<Modules['financials']['api'], 'recordPayment'>;
  accounting: Pick<Modules['integrations']['api']['accounting'], 'pullPayments'>;
  log: (msg: string, o: object) => void;
}

export interface AccountingPullJob {
  job: string;
  orgId: string;
}

export function createAccountingPull(deps: AccountingPullDeps) {
  return async function pull(job: AccountingPullJob, database: Database): Promise<void> {
    for (const provider of PROVIDERS) {
      const counts = { pulled: 0, recorded: 0, unmatched: 0 };
      await database.withTenantTx(
        jobContext(job.orgId, `accounting.pull:${provider}:${job.orgId}`),
        async (scope) => {
          const fresh = await deps.accounting.pullPayments(scope, provider);
          counts.pulled = fresh.length;
          for (const p of fresh) {
            if (!p.local) {
              counts.unmatched++;
              continue;
            }
            const result = await deps.financials.recordPayment(scope, {
              localType: p.local.localType,
              localId: p.local.localId,
              paidOn: p.paidOn,
              amountCents: p.amountCents,
              source: provider,
              externalRef: p.remoteId,
              reference: p.documentReference,
              reversesExternalRef: p.reverses,
            });
            if (result === 'recorded') counts.recorded++;
            else counts.unmatched++;
          }
        },
      );
      if (counts.pulled) deps.log('accounting pull', { orgId: job.orgId, provider, ...counts });
    }
  };
}
