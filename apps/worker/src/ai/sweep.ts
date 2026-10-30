// The nightly backstop for Nova's event path (backend 08 §2, Sam's condition on #123): reconciles everything stored for
// an org with the register, with no model call and for any plan. The event handlers (`reindex.ts`, `restamp.ts`) do the
// same for one record at a time within seconds; this catches whatever they missed (the ai-worker down, a job that used
// up its retries), so stale access or stale text cannot outlast a day. Loaded by the ai-worker only.
import type { TenantContext } from '@archova/kernel';
import type { SweepReport } from '@archova/mod-ai';
import { indexContext, NO_PLAN, sanitizeFailure } from './reindex';

/** The one entry point of `modules.ai.api` the sweep calls; it checks no permission, so only the worker names it. */
export interface OrgSweeper {
  sweepOrg(ctx: TenantContext): Promise<SweepReport>;
}

export interface SweepJob {
  job: string;
  orgId: string;
}

export interface SweepDeps {
  ai: OrgSweeper;
  /** Ids and counts only. */
  log: (msg: string, o: object) => void;
}

export function createSweep(deps: SweepDeps) {
  return async function sweep(job: SweepJob): Promise<void> {
    try {
      const ctx = indexContext(job.orgId, NO_PLAN, `ai-sweep:${job.orgId}`);
      const report = await deps.ai.sweepOrg(ctx);
      // Anything above zero is something the event path missed, so it is worth a look.
      deps.log('ai sweep done', { orgId: job.orgId, ...report });
    } catch (err) {
      throw sanitizeFailure(err);
    }
  };
}
