// Pushes a claim to Xero or MYOB as a bill or invoice (integrations/02 A4, A5). Loaded by the ai-worker only, because
// that is the process that loads the modules.
//
// A subcontract claim becomes a bill when its payment schedule is issued, for the scheduled amount; a head-contract claim
// becomes an invoice when it is submitted. Safe to repeat: the connector looks a document up by its `PC-` reference before
// it creates anything and only ever updates a draft. A refusal that needs a person becomes a sync issue; a transient
// error throws so the dispatcher retries.
import type { Modules } from '@archova/compose';
import type { Subscriber } from '../subscribers';
import { jobContext } from '../subscribers';
import { ACCOUNTING_PUSH_ROUTE } from './declaration';

const PROVIDERS = ['xero', 'myob'] as const;

export interface AccountingPushDeps {
  financials: Pick<Modules['financials']['api'], 'ledgerSource'>;
  accounting: Pick<Modules['integrations']['api']['accounting'], 'pushSource'>;
  log: (msg: string, o: object) => void;
}

export function createAccountingPush(deps: AccountingPushDeps): { subscriber: Subscriber } {
  const subscriber: Subscriber = {
    ...ACCOUNTING_PUSH_ROUTE,
    async handle(event, { database }) {
      const claimId = (event.data as { claimId?: unknown } | null)?.claimId;
      if (typeof claimId !== 'string') return;
      const outcome = await database.withTenantTx(
        jobContext(event.orgId, `accounting.push:${event.id}`),
        async (scope) => {
          const source = await deps.financials.ledgerSource(scope, claimId);
          if (!source) return null;
          const out: Record<string, string> = {};
          for (const p of PROVIDERS) out[p] = await deps.accounting.pushSource(scope, p, source);
          return out;
        },
      );
      if (outcome) deps.log('accounting push', { orgId: event.orgId, claimId, ...outcome });
    },
  };
  return { subscriber };
}
