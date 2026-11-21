import { anchorChain, verifyChain, type AnchorStore } from '@archova/mod-audit';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

/**
 * Pins each org's security log head (doc 07 §4.3): hourly, and only when the chain has moved. Doc 07 asks for daily
 * anchors (hourly with Financials); one cheap hourly check covers both.
 */
export function auditAnchor(store: AnchorStore | null): TenantJob {
  return {
    name: 'audit.anchor',
    cron: '20 * * * *',
    async run(database, orgId, now) {
      const r = await database.withTenantTx(jobContext(orgId, `audit.anchor:${orgId}`), (s) =>
        anchorChain(s, store, now),
      );
      return { anchored: r.anchored ? 1 : 0 };
    },
  };
}

/** Weekly walk of every org's chain (doc 07 §4.4). A break is recorded, and the org's admins see it on the log screen. */
export const auditVerify: TenantJob = {
  name: 'audit.verify',
  cron: '10 17 * * 0',
  async run(database, orgId) {
    const r = await database.withTenantTx(
      jobContext(orgId, `audit.verify:${orgId}`),
      (s) => verifyChain(s),
      { statementTimeout: '60s' },
    );
    return { checked: r.checked, broken: r.ok ? 0 : 1 };
  },
};
