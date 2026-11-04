import { sql } from 'drizzle-orm';
import type { OrgHoldDto } from '@archova/contracts';
import { decodeId, uuidv7 } from '@archova/domain';
import { AppError, type KernelServices, type Tx } from '@archova/kernel';
import type { StaffContext } from './staff';

export interface HoldDeps extends Pick<KernelServices, 'database'> {
  /** True when the project exists in the org; supplied lazily because `platform` is built after this module. */
  projectInOrg: () => (orgId: string, projectId: string) => Promise<boolean>;
  /** Holds need a hardware-key sign-in on hosted cells, as support access does. */
  requireHardwareKey?: boolean;
}

/**
 * Platform legal holds (compliance/07, Sam #255 review): staff place a hold on one org or one project; it blocks
 * every deletion there until a different staff member releases it. The hold row is the audit record (append-only,
 * who and when, the ticket), it is never shown to the customer, and the customer-facing error says nothing about it.
 */
export function createHoldService(deps: HoldDeps) {
  const tx = <T>(fn: (t: Tx) => Promise<T>) => deps.database.withGlobalTx('backoffice', fn);
  const requireKey = (staff: StaffContext) => {
    if (deps.requireHardwareKey && !staff.hardwareKey)
      throw new AppError(
        'backoffice.hardware_key_required',
        'Sign in with your hardware security key to manage legal holds.',
      );
  };

  type Row = {
    id: string;
    project_id: string | null;
    reason: string;
    reference: string;
    placed_by: string;
    placed_at: Date;
    released_by: string | null;
    released_at: Date | null;
    release_reason: string | null;
  };
  const dto = (r: Row): OrgHoldDto => ({
    id: r.id,
    projectId: r.project_id,
    reason: r.reason,
    ticketRef: r.reference,
    placedBy: r.placed_by,
    placedAt: new Date(r.placed_at).toISOString(),
    releasedBy: r.released_by,
    releasedAt: r.released_at ? new Date(r.released_at).toISOString() : null,
    releaseReason: r.release_reason,
  });

  async function list(staff: StaffContext, orgId: string): Promise<OrgHoldDto[]> {
    requireKey(staff);
    const res = await tx((t) =>
      t.execute(sql`
        select id, project_id, reason, reference, placed_by, placed_at, released_by, released_at, release_reason
        from shared.platform_holds where org_id = ${orgId} order by placed_at desc`),
    );
    return (res.rows as Row[]).map(dto);
  }

  async function place(
    staff: StaffContext,
    orgId: string,
    input: { projectId?: string | undefined; reason: string; ticketRef: string },
  ): Promise<OrgHoldDto[]> {
    requireKey(staff);
    let projectId: string | null = null;
    if (input.projectId) {
      projectId = decodeId('project', input.projectId);
      // A hold on a project id that is not in this org would silently protect nothing.
      if (!projectId || !(await deps.projectInOrg()(orgId, projectId)))
        throw new AppError('project.not_found');
    }
    await tx(async (t) => {
      const org = await t.execute(
        sql`select 1 from backoffice.tenant_directory where id = ${orgId}`,
      );
      if (org.rows.length === 0) throw new AppError('org.not_found');
      await t.execute(sql`
        insert into shared.platform_holds (id, org_id, project_id, reason, reference, placed_by)
        values (${uuidv7()}, ${orgId}, ${projectId}, ${input.reason}, ${input.ticketRef.trim()}, ${staff.staffId})`);
    });
    return list(staff, orgId);
  }

  async function release(
    staff: StaffContext,
    orgId: string,
    holdId: string,
    input: { reason: string },
  ): Promise<OrgHoldDto[]> {
    requireKey(staff);
    await tx(async (t) => {
      const [hold] = (
        await t.execute(
          sql`select placed_by, released_at from shared.platform_holds where id = ${holdId} and org_id = ${orgId}`,
        )
      ).rows as Array<{ placed_by: string; released_at: Date | null }>;
      if (!hold) throw new AppError('backoffice.hold_not_found', 'There is no such hold.');
      if (hold.released_at) return;
      // Releasing enables deletion, so it takes a second person (also enforced by a trigger).
      if (hold.placed_by === staff.staffId)
        throw new AppError(
          'backoffice.hold_release_needs_second_person',
          'A different staff member must release this hold.',
        );
      await t.execute(sql`
        update shared.platform_holds set released_by = ${staff.staffId}, released_at = now(),
          release_reason = ${input.reason}
        where id = ${holdId} and released_at is null`);
    });
    return list(staff, orgId);
  }

  return { list, place, release };
}
export type HoldService = ReturnType<typeof createHoldService>;
