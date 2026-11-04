import { sql } from 'drizzle-orm';
import type { OrgHoldDto } from '@archova/contracts';
import { decodeId, uuidv7 } from '@archova/domain';
import { AppError, type KernelServices, type Tx } from '@archova/kernel';
import { ROLE_PERMISSIONS } from '../permissions';
import type { StaffContext } from './staff';

export interface HoldDeps extends Pick<KernelServices, 'database'> {
  /** Emails staff; supplied by the composition root. */
  notifyStaff: (emails: string[], subject: string, text: string) => Promise<void>;
  logger?: Pick<KernelServices['logger'], 'warn'>;
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
  // The transaction acts for one named staff member (transaction-local). The database policies and triggers on
  // shared.platform_holds require it, so other global transactions (identity, billing) cannot read or write holds.
  const tx = <T>(staff: StaffContext, fn: (t: Tx) => Promise<T>) =>
    deps.database.withGlobalTx('backoffice', async (t) => {
      await t.execute(sql`select set_config('app.staff_id', ${staff.staffId}, true)`);
      return fn(t);
    });
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

  const audit = (
    t: Tx,
    staff: StaffContext,
    action: 'legal_hold.placed' | 'legal_hold.released',
    orgId: string,
    projectId: string | null,
    reference: string,
  ) =>
    // Written in the same transaction as the change, and never with the reason text.
    t.execute(sql`
      insert into backoffice.staff_audit (id, staff_id, action, target_org_id, project_id, reference)
      values (${uuidv7()}, ${staff.staffId}, ${action}, ${orgId}, ${projectId}, ${reference})`);

  /** Tells the other staff who can manage holds. One that cannot be reached is logged; the change has been made. */
  async function notifyHolders(
    staff: StaffContext,
    what: 'placed' | 'released',
    orgId: string,
    reference: string,
  ) {
    try {
      const roles = Object.entries(ROLE_PERMISSIONS)
        .filter(([, perms]) => perms.includes('backoffice.holds.manage'))
        .map(([role]) => role);
      const rows = await deps.database.withGlobalTx('backoffice', (t) =>
        t.execute(sql`
          select distinct u.email from backoffice.staff_users u
          join backoffice.staff_role_assignments a on a.staff_user_id = u.id and a.revoked_at is null
          where u.status = 'active' and u.id <> ${staff.staffId} and a.role = any(${`{${roles.join(',')}}`}::text[])`),
      );
      const emails = (rows.rows as Array<{ email: string }>).map((r) => r.email);
      if (emails.length === 0) return;
      await deps.notifyStaff(
        emails,
        `Legal hold ${what} on a company`,
        `${staff.name} ${what} a legal hold on company ${orgId} for ${reference}. See the owner console for the details.`,
      );
    } catch (e) {
      deps.logger?.warn({ err: e }, 'legal hold notice could not be sent');
    }
  }

  async function list(staff: StaffContext, orgId: string): Promise<OrgHoldDto[]> {
    requireKey(staff);
    const res = await tx(staff, (t) =>
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
    await tx(staff, async (t) => {
      const org = await t.execute(
        sql`select 1 from backoffice.tenant_directory where id = ${orgId}`,
      );
      if (org.rows.length === 0) throw new AppError('org.not_found');
      await t.execute(sql`
        insert into shared.platform_holds (id, org_id, project_id, reason, reference, placed_by)
        values (${uuidv7()}, ${orgId}, ${projectId}, ${input.reason}, ${input.ticketRef.trim()}, ${staff.staffId})`);
      await audit(t, staff, 'legal_hold.placed', orgId, projectId, input.ticketRef.trim());
    });
    await notifyHolders(staff, 'placed', orgId, input.ticketRef.trim());
    return list(staff, orgId);
  }

  async function release(
    staff: StaffContext,
    orgId: string,
    holdId: string,
    input: { reason: string },
  ): Promise<OrgHoldDto[]> {
    requireKey(staff);
    let released: { reference: string } | null = null;
    await tx(staff, async (t) => {
      const [hold] = (
        await t.execute(
          sql`select placed_by, released_at, project_id, reference from shared.platform_holds where id = ${holdId} and org_id = ${orgId}`,
        )
      ).rows as Array<{
        placed_by: string;
        released_at: Date | null;
        project_id: string | null;
        reference: string;
      }>;
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
      await audit(t, staff, 'legal_hold.released', orgId, hold.project_id, hold.reference);
      released = { reference: hold.reference };
    });
    if (released)
      await notifyHolders(staff, 'released', orgId, (released as { reference: string }).reference);
    return list(staff, orgId);
  }

  return { list, place, release };
}
export type HoldService = ReturnType<typeof createHoldService>;
