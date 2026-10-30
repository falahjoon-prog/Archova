import { and, count, desc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { SupportProjectDto } from '@archova/contracts';
import { uuidv7 } from '@archova/domain';
import { AppError, type KernelServices, type Tx } from '@archova/kernel';
import {
  staffUsers,
  supportEvents,
  supportGrants,
  supportSessions,
  tenantDirectory,
} from '../infra/tables';
import type { StaffContext } from './staff';

const HOUR_MS = 3_600_000;
/** A grant lasts up to 72 hours and a support session up to one hour (Sam 12 §4a). */
export const MAX_GRANT_HOURS = 72;
export const MAX_SESSION_MINUTES = 60;

export type GrantStatus = 'active' | 'expired' | 'revoked';
export type SessionStatus = 'open' | 'ended' | 'expired' | 'revoked';
export interface GrantView {
  id: string;
  ticketRef: string;
  level: 'view';
  grantedBy: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  status: GrantStatus;
}
export interface SessionView {
  id: string;
  grantId: string;
  staffName: string;
  ticketRef: string;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  /** How many times the session read customer records (each is logged by record id). */
  pagesViewed: number;
  status: SessionStatus;
}
export interface SupportAccessView {
  grants: GrantView[];
  sessions: SessionView[];
}

/**
 * Support access (Sam 12 §4a). Customers grant it, staff hold sessions inside a grant, and every grant, revoke and
 * session is a row the customer can read. This slice is the consent and audit record; it does not let staff browse
 * project content yet.
 */
export function createSupportAccessService(
  deps: Pick<KernelServices, 'database'> & {
    /** Read-only views of customer data; `platform` is built after this module, so it is resolved lazily. */
    reads: () => { projects(orgId: string, staffId: string): Promise<SupportProjectDto[]> };
    now?: () => Date;
  },
) {
  const now = deps.now ?? (() => new Date());
  const tx = <T>(fn: (t: Tx) => Promise<T>) => deps.database.withGlobalTx('backoffice', fn);

  const grantStatus = (g: typeof supportGrants.$inferSelect, at: Date): GrantStatus =>
    g.revokedAt ? 'revoked' : g.expiresAt <= at ? 'expired' : 'active';
  const sessionStatus = (s: typeof supportSessions.$inferSelect, at: Date): SessionStatus =>
    s.endedAt
      ? s.endReason === 'revoked'
        ? 'revoked'
        : 'ended'
      : s.expiresAt <= at
        ? 'expired'
        : 'open';

  async function view(t: Tx, orgId: string): Promise<SupportAccessView> {
    const at = now();
    const [grants, sessions] = await Promise.all([
      t
        .select()
        .from(supportGrants)
        .where(eq(supportGrants.targetOrgId, orgId))
        .orderBy(desc(supportGrants.createdAt))
        .limit(50),
      t
        .select({ s: supportSessions, staffName: staffUsers.name })
        .from(supportSessions)
        .innerJoin(staffUsers, eq(staffUsers.id, supportSessions.staffId))
        .where(eq(supportSessions.targetOrgId, orgId))
        .orderBy(desc(supportSessions.startedAt))
        .limit(50),
    ]);
    const pages = sessions.length
      ? await t
          .select({ id: supportEvents.sessionId, n: count() })
          .from(supportEvents)
          .where(
            inArray(
              supportEvents.sessionId,
              sessions.map(({ s }) => s.id),
            ),
          )
          .groupBy(supportEvents.sessionId)
      : [];
    const pagesBySession = new Map(pages.map((r) => [r.id, Number(r.n)]));
    return {
      grants: grants.map((g) => ({
        id: g.id,
        ticketRef: g.ticketRef,
        level: g.level,
        grantedBy: g.grantedByName,
        createdAt: g.createdAt.toISOString(),
        expiresAt: g.expiresAt.toISOString(),
        revokedAt: g.revokedAt?.toISOString() ?? null,
        status: grantStatus(g, at),
      })),
      sessions: sessions.map(({ s, staffName }) => ({
        id: s.id,
        grantId: s.grantId,
        staffName,
        ticketRef: s.ticketRef,
        startedAt: s.startedAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        endedAt: s.endedAt?.toISOString() ?? null,
        pagesViewed: pagesBySession.get(s.id) ?? 0,
        status: sessionStatus(s, at),
      })),
    };
  }

  const list = (orgId: string) => tx((t) => view(t, orgId));

  /** Customer side: an org owner or admin grants view access (the caller checks the role). */
  async function grant(
    orgId: string,
    by: { userId: string; name: string },
    input: { ticketRef: string; hours: number },
  ): Promise<GrantView> {
    if (input.hours < 1 || input.hours > MAX_GRANT_HOURS)
      throw new AppError('validation_failed', `A grant lasts 1 to ${MAX_GRANT_HOURS} hours.`);
    const at = now();
    const id = uuidv7();
    await tx(async (t) => {
      const [org] = await t
        .select({ id: tenantDirectory.id })
        .from(tenantDirectory)
        .where(eq(tenantDirectory.id, orgId));
      if (!org) throw new AppError('org.not_found');
      // Serialise grants per company, then allow only one live grant at a time.
      await t.execute(
        sql`select 1 from backoffice.tenant_directory where id = ${orgId} for update`,
      );
      const [live] = await t
        .select({ id: supportGrants.id })
        .from(supportGrants)
        .where(
          and(
            eq(supportGrants.targetOrgId, orgId),
            isNull(supportGrants.revokedAt),
            gt(supportGrants.expiresAt, at),
          ),
        );
      if (live)
        throw new AppError(
          'backoffice.support_grant_exists',
          'Support access is already on. Withdraw it first to change it.',
        );
      await t.insert(supportGrants).values({
        id,
        targetOrgId: orgId,
        ticketRef: input.ticketRef.trim(),
        grantedByUser: by.userId,
        grantedByName: by.name,
        createdAt: at,
        expiresAt: new Date(at.getTime() + input.hours * HOUR_MS),
      });
    });
    const found = (await list(orgId)).grants.find((g) => g.id === id);
    return found!;
  }

  /** Customer side: revoking takes effect at once and ends every open session under the grant. */
  async function revoke(orgId: string, grantId: string) {
    const at = now();
    await tx(async (t) => {
      const done = await t
        .update(supportGrants)
        .set({ revokedAt: at })
        .where(
          and(
            eq(supportGrants.id, grantId),
            eq(supportGrants.targetOrgId, orgId),
            isNull(supportGrants.revokedAt),
          ),
        )
        .returning({ id: supportGrants.id });
      if (!done.length) throw new AppError('backoffice.support_grant_not_found');
      await t
        .update(supportSessions)
        .set({ endedAt: at, endReason: 'revoked' })
        .where(and(eq(supportSessions.grantId, grantId), isNull(supportSessions.endedAt)));
    });
  }

  /** Staff side: start a session inside an active grant, for the grant's ticket, for at most an hour. */
  async function start(
    staff: StaffContext,
    orgId: string,
    ticketRef: string,
  ): Promise<SessionView> {
    const at = now();
    const id = uuidv7();
    await tx(async (t) => {
      const [g] = await t
        .select()
        .from(supportGrants)
        .where(
          and(
            eq(supportGrants.targetOrgId, orgId),
            isNull(supportGrants.revokedAt),
            gt(supportGrants.expiresAt, at),
          ),
        )
        .orderBy(desc(supportGrants.createdAt))
        .limit(1);
      if (!g)
        throw new AppError(
          'backoffice.no_support_grant',
          'This company has not granted support access, or the grant has ended.',
        );
      if (g.ticketRef.toLowerCase() !== ticketRef.trim().toLowerCase())
        throw new AppError(
          'backoffice.support_ticket_mismatch',
          `The grant is for ticket ${g.ticketRef}.`,
        );
      // A session past its time is closed first, so the one-open-session index only ever sees live ones.
      await t
        .update(supportSessions)
        .set({ endedAt: at, endReason: 'ended' })
        .where(
          and(
            eq(supportSessions.targetOrgId, orgId),
            eq(supportSessions.staffId, staff.staffId),
            isNull(supportSessions.endedAt),
            lte(supportSessions.expiresAt, at),
          ),
        );
      const [open] = await t
        .select({ id: supportSessions.id })
        .from(supportSessions)
        .where(
          and(
            eq(supportSessions.targetOrgId, orgId),
            eq(supportSessions.staffId, staff.staffId),
            isNull(supportSessions.endedAt),
            gt(supportSessions.expiresAt, at),
          ),
        );
      if (open)
        throw new AppError('backoffice.support_session_open', 'You already have a session open.');
      await t.insert(supportSessions).values({
        id,
        grantId: g.id,
        targetOrgId: orgId,
        staffId: staff.staffId,
        ticketRef: g.ticketRef,
        startedAt: at,
        expiresAt: new Date(
          Math.min(at.getTime() + MAX_SESSION_MINUTES * 60_000, g.expiresAt.getTime()),
        ),
      });
    });
    return (await list(orgId)).sessions.find((s) => s.id === id)!;
  }

  async function end(staff: StaffContext, orgId: string, sessionId: string) {
    const done = await tx((t) =>
      t
        .update(supportSessions)
        .set({ endedAt: now(), endReason: 'ended' })
        .where(
          and(
            eq(supportSessions.id, sessionId),
            eq(supportSessions.targetOrgId, orgId),
            eq(supportSessions.staffId, staff.staffId),
            isNull(supportSessions.endedAt),
          ),
        )
        .returning({ id: supportSessions.id }),
    );
    if (!done.length) throw new AppError('backoffice.support_session_not_found');
  }

  /** Customer side: the banner every user of the company sees while a session is open. Read only. */
  async function banner(orgId: string): Promise<{ active: boolean; since: string | null }> {
    const at = now();
    const [open] = await tx((t) =>
      t
        .select({ startedAt: supportSessions.startedAt })
        .from(supportSessions)
        .where(
          and(
            eq(supportSessions.targetOrgId, orgId),
            isNull(supportSessions.endedAt),
            gt(supportSessions.expiresAt, at),
          ),
        )
        .orderBy(desc(supportSessions.startedAt))
        .limit(1),
    );
    return { active: Boolean(open), since: open?.startedAt.toISOString() ?? null };
  }

  /**
   * Staff side: project names and status for the caller's open session, logged by record id. The session must still
   * sit inside an unrevoked, unexpired grant, so withdrawing consent stops reads at the next call.
   */
  async function viewProjects(staff: StaffContext, orgId: string): Promise<SupportProjectDto[]> {
    const at = now();
    const session = await tx(async (t) => {
      const [s] = await openSessionQuery(t, orgId, staff.staffId, at);
      return s;
    });
    if (!session)
      throw new AppError(
        'backoffice.support_no_session',
        'Start a support session for this company first.',
      );
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

  /** The caller's own open session inside an unrevoked, unexpired grant. */
  function openSessionQuery(t: Tx, orgId: string, staffId: string, at: Date) {
    return t
      .select({ id: supportSessions.id })
      .from(supportSessions)
      .innerJoin(supportGrants, eq(supportGrants.id, supportSessions.grantId))
      .where(
        and(
          eq(supportSessions.targetOrgId, orgId),
          eq(supportSessions.staffId, staffId),
          isNull(supportSessions.endedAt),
          gt(supportSessions.expiresAt, at),
          isNull(supportGrants.revokedAt),
          gt(supportGrants.expiresAt, at),
        ),
      );
  }

  /** True while the staff member holds a live session under a live grant (platform re-checks this itself). */
  const hasOpenSession = async (orgId: string, staffId: string) =>
    (await tx((t) => openSessionQuery(t, orgId, staffId, now()))).length > 0;

  return { list, grant, revoke, start, end, banner, viewProjects, hasOpenSession };
}

export type SupportAccessService = ReturnType<typeof createSupportAccessService>;
