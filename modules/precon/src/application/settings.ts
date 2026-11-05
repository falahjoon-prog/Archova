import { eq, inArray, sql } from 'drizzle-orm';
import type { TenantScope } from '@archova/kernel';
import { localDateOf } from '@archova/time';
import { companyStanding, type Qualification } from '../domain/prequal';
import { prequalifications, settings } from '../infra/tables';
import { PRECON_TIME_ZONE, type PreconDeps } from './shared';

export interface TenderGateResult {
  /** Whether this organisation requires prequalification for tender invites. */
  required: boolean;
  /** Companies (of those asked about) that are not currently qualified, with where each stands. */
  blocked: { companyId: string; state: Qualification | 'none' }[];
}

export function createSettingsService(deps: Pick<PreconDeps, 'now'>) {
  const now = deps.now ?? (() => new Date());

  async function get(scope: TenantScope) {
    const [row] = await scope.tx.select().from(settings).where(eq(settings.orgId, scope.ctx.orgId));
    return { requireForTenders: row?.requireForTenders ?? false };
  }

  async function set(scope: TenantScope, input: { requireForTenders: boolean }) {
    await scope.tx
      .insert(settings)
      .values({
        orgId: scope.ctx.orgId,
        requireForTenders: input.requireForTenders,
        updatedBy: scope.ctx.userId,
      })
      .onConflictDoUpdate({
        target: settings.orgId,
        set: {
          requireForTenders: input.requireForTenders,
          updatedAt: sql`now()`,
          updatedBy: scope.ctx.userId,
        },
      });
    scope.events.add({
      type: 'precon.settings.updated.v1',
      entityType: 'precon_settings',
      entityId: scope.ctx.orgId,
      entityVersion: 1,
      data: { requireForTenders: input.requireForTenders, actorId: scope.ctx.userId },
    });
    return get(scope);
  }

  /**
   * Which of `companyIds` a tender invite must refuse. Qualified and expiring-soon pass: the approval is still in
   * date. Pending, expired, not approved, or no record at all do not. Used by `estimating`.
   */
  async function tenderGate(
    scope: TenantScope,
    companyIds: readonly string[],
  ): Promise<TenderGateResult> {
    if (!(await get(scope)).requireForTenders || companyIds.length === 0)
      return { required: false, blocked: [] };
    const rows = await scope.tx
      .select()
      .from(prequalifications)
      .where(inArray(prequalifications.companyId, [...companyIds]));
    const today = localDateOf(now(), PRECON_TIME_ZONE);
    const blocked: TenderGateResult['blocked'] = [];
    for (const companyId of new Set(companyIds)) {
      const standing = companyStanding(
        rows.filter((r) => r.companyId === companyId),
        today,
      );
      const state = standing?.state ?? 'none';
      if (state !== 'qualified' && state !== 'expiring') blocked.push({ companyId, state });
    }
    return { required: true, blocked };
  }

  return { get, set, tenderGate };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
