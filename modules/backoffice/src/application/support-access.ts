import { and, count, desc, eq, gt, isNull, lt } from 'drizzle-orm';
import type { SupportProjectDto, SupportStaffDto } from '@archova/contracts';
import { uuidv7 } from '@archova/domain';
import { AppError, type KernelServices, type Tx } from '@archova/kernel';
import { staffUsers, supportEvents, supportGrants, supportSessions } from '../infra/tables';
import type { StaffContext } from './staff';

const HOUR_MS = 3_600_000;
const MAX_GRANT_HOURS = 72;

/** What the customer sees of a session: the staff member's name, never their email or role. */
export interface SupportSessionView {
  staffName: string;
  ticketRef: string;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  endedReason: 'staff' | 'customer_revoked' | 'expired' | null;
  pagesViewed: number;
}

export interface CustomerSupportStatus {
  grant: {
    ticketRef: string;
    note: string | null;
    grantedBy: string;
    grantedAt: string;
    expiresAt: string;
  } | null;
  session: SupportSessionView | null;
  history: SupportSessionView[];
}

export interface SupportDeps extends Pick<KernelServices, 'database'> {
  /** Reads a customer's projects under a read-only tenant transaction; wired lazily because `platform` is built later. */
  reads: () => { projects(orgId: string, staffId: string): Promise<SupportProjectDto[]> };
  now?: () => Date;
}

const norm = (ref: string) => ref.trim().toLowerCase();

/**
 * Support access (Sam 12 §4a, X56). The customer's admin grants it for one ticket; staff with the Support or
 * Security lead role may then open a read-only session of at most one hour, only for that ticket and never past
 * the grant. Revoking ends every open session in the same transaction. Each project list a session reads is logged
 * by record id, and the customer sees the sessions with the staff member's name.
 */
export function createSupportAccessService(deps: SupportDeps) {
  const now = deps.now ?? (() => new Date());
  const tx = <T>(fn: (t: Tx) => Promise<T>) => deps.database.withGlobalTx('backoffice', fn);

  /** The customer's open grant, or null when none, revoked or past its time. */
  async function openGrant(t: Tx, orgId: string) {
    const [g] = await t
      .select()
      .from(supportGrants)
      .where(
        and(
          eq(supportGrants.targetOrgId, orgId),
          isNull(supportGrants.revokedAt),
          gt(supportGrants.expiresAt, now()),
        ),
      );
    return g ?? null;
  }

  /** Sessions past their time are closed when next looked at, so history never shows an open one that has lapsed. */
  async function closeLapsed(t: Tx, orgId: string) {
    await t
      .update(supportSessions)
      .set({ endedAt: now(), endedReason: 'expired' })
      .where(
        and(
          eq(supportSessions.targetOrgId, orgId),
          isNull(supportSessions.endedAt),
          lt(supportSessions.expiresAt, now()),
        ),
      );
  }

  async function sessionViews(t: Tx, orgId: string, limit: number): Promise<SupportSessionView[]> {
    const rows = await t
      .select({
        s: supportSessions,
        name: staffUsers.name,
        pages: count(supportEvents.id),
      })
      .from(supportSessions)
      .innerJoin(staffUsers, eq(staffUsers.id, supportSessions.staffId))
      .leftJoin(supportEvents, eq(supportEvents.sessionId, supportSessions.id))
      .where(eq(supportSessions.targetOrgId, orgId))
      .groupBy(supportSessions.id, staffUsers.name)
      .orderBy(desc(supportSessions.startedAt))
      .limit(limit);
    const at = now();
    return rows.map(({ s, name, pages }) => {
      // A lapsed session is shown as ended without a write, so customer reads stay read-only.
      const lapsed = s.endedAt === null && s.expiresAt <= at;
      const endedAt = lapsed ? s.expiresAt : s.endedAt;
      return {
        staffName: name,
        ticketRef: s.ticketRef,
        startedAt: s.startedAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        endedAt: endedAt?.toISOString() ?? null,
        endedReason: lapsed ? ('expired' as const) : s.endedReason,
        pagesViewed: Number(pages),
      };
    });
  }

  // ---- customer side: called by `platform` inside the admin's own transaction ----

  async function status(t: Tx, orgId: string): Promise<CustomerSupportStatus> {
    const [g, history] = await Promise.all([openGrant(t, orgId), sessionViews(t, orgId, 10)]);
    return {
      grant: g
        ? {
            ticketRef: g.ticketRef,
            note: g.note,
            grantedBy: g.grantedByName,
            grantedAt: g.createdAt.toISOString(),
            expiresAt: g.expiresAt.toISOString(),
          }
        : null,
      session: history.find((h) => h.endedAt === null) ?? null,
      history,
    };
  }

  /** The banner every user of the company sees while a session is open. */
  async function banner(t: Tx, orgId: string): Promise<{ active: boolean; since: string | null }> {
    const open = (await sessionViews(t, orgId, 10)).find((h) => h.endedAt === null);
    return { active: Boolean(open), since: open?.startedAt ?? null };
  }

  async function grant(
    t: Tx,
    orgId: string,
    by: { userId: string; name: string },
    input: { ticketRef: string; hours: number; note?: string | undefined },
  ) {
    if (!Number.isInteger(input.hours) || input.hours < 1 || input.hours > MAX_GRANT_HOURS)
      throw new AppError('validation_failed', `Choose 1 to ${MAX_GRANT_HOURS} hours.`);
    // A grant that has lapsed without being revoked must not block a new one.
    await t
      .update(supportGrants)
      .set({ revokedAt: now() })
      .where(
        and(
          eq(supportGrants.targetOrgId, orgId),
          isNull(supportGrants.revokedAt),
          lt(supportGrants.expiresAt, now()),
        ),
      );
    if (await openGrant(t, orgId))
      throw new AppError(
        'backoffice.support_grant_exists',
        'Support access is already on. Withdraw it first to change it.',
      );
    const at = now();
    await t.insert(supportGrants).values({
      id: uuidv7(),
      targetOrgId: orgId,
      ticketRef: input.ticketRef.trim(),
      note: input.note?.trim() || null,
      grantedBy: by.userId,
      grantedByName: by.name,
      createdAt: at,
      expiresAt: new Date(at.getTime() + input.hours * HOUR_MS),
    });
  }

  /** Withdraws consent and ends every open session now. Idempotent. */
  async function revoke(t: Tx, orgId: string) {
    const at = now();
    await t
      .update(supportGrants)
      .set({ revokedAt: at })
      .where(and(eq(supportGrants.targetOrgId, orgId), isNull(supportGrants.revokedAt)));
    await t
      .update(supportSessions)
      .set({ endedAt: at, endedReason: 'customer_revoked' })
      .where(and(eq(supportSessions.targetOrgId, orgId), isNull(supportSessions.endedAt)));
  }

  // ---- staff side ----

  async function openSession(t: Tx, orgId: string, staffId: string) {
    await closeLapsed(t, orgId);
    const [s] = await t
      .select()
      .from(supportSessions)
      .where(
        and(
          eq(supportSessions.targetOrgId, orgId),
          eq(supportSessions.staffId, staffId),
          isNull(supportSessions.endedAt),
        ),
      );
    return s ?? null;
  }

  async function staffView(t: Tx, orgId: string, staffId: string): Promise<SupportStaffDto> {
    const [g, s] = await Promise.all([openGrant(t, orgId), openSession(t, orgId, staffId)]);
    return {
      grant: g
        ? {
            ticketRef: g.ticketRef,
            grantedBy: g.grantedByName,
            expiresAt: g.expiresAt.toISOString(),
          }
        : null,
      session: s
        ? {
            startedAt: s.startedAt.toISOString(),
            expiresAt: s.expiresAt.toISOString(),
            ticketRef: s.ticketRef,
          }
        : null,
    };
  }

  const forStaff = (orgId: string, staffId: string) => tx((t) => staffView(t, orgId, staffId));

  async function start(
    staff: StaffContext,
    orgId: string,
    input: { reason: string; ticketRef: string },
  ) {
    await tx(async (t) => {
      const g = await openGrant(t, orgId);
      if (!g)
        throw new AppError(
          'backoffice.support_not_granted',
          'This company has not allowed support access, or it has lapsed.',
        );
      // The customer named the ticket; staff must work to that one.
      if (norm(g.ticketRef) !== norm(input.ticketRef))
        throw new AppError(
          'backoffice.support_ticket_mismatch',
          'The ticket does not match the one the customer allowed.',
        );
      if (await openSession(t, orgId, staff.staffId))
        throw new AppError(
          'backoffice.support_session_open',
          'You already have a session open here.',
        );
      const at = now();
      await t.insert(supportSessions).values({
        id: uuidv7(),
        grantId: g.id,
        targetOrgId: orgId,
        staffId: staff.staffId,
        ticketRef: g.ticketRef,
        reason: input.reason,
        startedAt: at,
        // One hour, and never beyond what the customer allowed.
        expiresAt: new Date(Math.min(at.getTime() + HOUR_MS, g.expiresAt.getTime())),
      });
    });
    return forStaff(orgId, staff.staffId);
  }

  async function end(staff: StaffContext, orgId: string) {
    await tx(async (t) => {
      await t
        .update(supportSessions)
        .set({ endedAt: now(), endedReason: 'staff' })
        .where(
          and(
            eq(supportSessions.targetOrgId, orgId),
            eq(supportSessions.staffId, staff.staffId),
            isNull(supportSessions.endedAt),
          ),
        );
    });
    return forStaff(orgId, staff.staffId);
  }

  /** Reads project names for the open session and logs the record ids that were shown. */
  async function viewProjects(staff: StaffContext, orgId: string): Promise<SupportProjectDto[]> {
    const session = await tx(async (t) => {
      const s = await openSession(t, orgId, staff.staffId);
      // The grant may have been revoked or lapsed since the session began.
      if (!s || !(await openGrant(t, orgId)))
        throw new AppError(
          'backoffice.support_no_session',
          'Start a support session for this company first.',
        );
      return s;
    });
    const projects = await deps.reads().projects(orgId, staff.staffId);
    await tx((t) =>
      t.insert(supportEvents).values({
        id: uuidv7(),
        sessionId: session.id,
        targetOrgId: orgId,
        what: 'projects.list',
        recordIds: projects.map((p) => p.id),
      }),
    );
    return projects;
  }

  return { status, banner, grant, revoke, forStaff, start, end, viewProjects };
}

export type SupportAccessService = ReturnType<typeof createSupportAccessService>;
