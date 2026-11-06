// Reminder emails to invited companies that have not answered (X45). Two days and one day before the package is due,
// on the project's own calendar day (X34). Each reminder carries a fresh link, because tokens are stored hashed and the
// earlier email's token can't be recovered; the old link is revoked. Companies that said yes or no, or sent a quote, are
// never emailed.
import { and, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import { compareLocalDates, addDays, localDateOf } from '@archova/time';
import {
  ACCESS_LINK_DEFAULT_DAYS,
  createAccessLink,
  revokeAccessLink,
  type TenantScope,
} from '@archova/kernel';
import { formatPackageNumber } from '../domain/tender';
import { packageInvites, tenderPackages } from '../infra/tables';
import { TENDER_LINK_ACTIONS, TENDER_LINK_ENTITY } from './tender-links';

export type ReminderStage = 'two_days' | 'one_day';

export interface InviteeCandidate {
  inviteId: string;
  packageId: string;
  projectId: string;
  /** The estimator who created the package; the link is issued in their name and dies with their access. */
  createdBy: string;
  number: number;
  name: string;
  trade: string;
  dueAt: Date;
  companyId: string;
  contactEmail: string | null;
  accessLinkId: string | null;
}

export interface PlannedInviteeReminder {
  candidate: InviteeCandidate;
  stage: ReminderStage;
}

/** Packages out to tender that close within about three days, with their invitees who have not answered. */
export async function findInviteeCandidates(
  scope: TenantScope,
  now: Date,
): Promise<InviteeCandidate[]> {
  const to = new Date(now.getTime() + 3 * 86_400_000);
  const rows = await scope.tx
    .select({
      inviteId: packageInvites.id,
      packageId: tenderPackages.id,
      projectId: tenderPackages.projectId,
      createdBy: tenderPackages.createdBy,
      number: tenderPackages.number,
      name: tenderPackages.name,
      trade: tenderPackages.trade,
      dueAt: tenderPackages.dueAt,
      companyId: packageInvites.companyId,
      contactEmail: packageInvites.contactEmail,
      accessLinkId: packageInvites.accessLinkId,
    })
    .from(packageInvites)
    .innerJoin(tenderPackages, eq(tenderPackages.id, packageInvites.packageId))
    .where(
      and(
        eq(tenderPackages.status, 'out_to_tender'),
        isNull(tenderPackages.deletedAt),
        gt(tenderPackages.dueAt, now),
        lte(tenderPackages.dueAt, to),
        inArray(packageInvites.status, ['invited', 'viewed']),
      ),
    )
    .limit(5000);
  return rows.flatMap((r) =>
    r.createdBy && r.dueAt ? [{ ...r, createdBy: r.createdBy, dueAt: r.dueAt }] : [],
  );
}

/** Pure: which stage, if any, each invitee is due. `zoneOf` is the project's time zone (null drops the row). */
export function planInviteeReminders(
  candidates: readonly InviteeCandidate[],
  now: Date,
  zoneOf: (projectId: string) => string | null,
): PlannedInviteeReminder[] {
  const out: PlannedInviteeReminder[] = [];
  for (const c of candidates) {
    const zone = zoneOf(c.projectId);
    if (!zone || c.dueAt.getTime() <= now.getTime()) continue;
    const today = localDateOf(now, zone);
    const dueDay = localDateOf(c.dueAt, zone);
    let stage: ReminderStage | null = null;
    if (compareLocalDates(dueDay, addDays(today, 1)) <= 0) stage = 'one_day';
    else if (compareLocalDates(dueDay, addDays(today, 2)) === 0) stage = 'two_days';
    if (stage) out.push({ candidate: c, stage });
  }
  return out;
}

/** True when this run is the first to claim the reminder; a rerun or a second worker gets false and sends nothing. */
export async function claimInviteeReminder(
  scope: TenantScope,
  p: PlannedInviteeReminder,
): Promise<boolean> {
  const res = await scope.tx.execute(sql`
    insert into estimating.invite_reminders (org_id, invite_id, stage, due_at)
    values (${scope.ctx.orgId}, ${p.candidate.inviteId}, ${p.stage}, ${p.candidate.dueAt.toISOString()})
    on conflict do nothing
    returning invite_id`);
  return res.rows.length > 0;
}

/** Gives the claim back after a failed send, so the next run tries again. */
export async function releaseInviteeReminder(
  scope: TenantScope,
  p: PlannedInviteeReminder,
): Promise<void> {
  await scope.tx.execute(sql`
    delete from estimating.invite_reminders
    where invite_id = ${p.candidate.inviteId} and stage = ${p.stage}
      and due_at = ${p.candidate.dueAt.toISOString()}`);
}

/**
 * Of the package creators behind these candidates, the ones whose links would still work. A link dies with its
 * creator's access (`creatorStillAllowed`, checked in full on every guest request), so mailing one for someone who has
 * left only sends a dead link. This is the cheaper pre-check the worker can make: the creator must still have access
 * (an active membership) and, unless they are an owner or admin, still be on the package's project.
 */
export async function creatorsStillAllowed(
  scope: TenantScope,
  candidates: readonly InviteeCandidate[],
): Promise<Set<string>> {
  const packages = [...new Set(candidates.map((c) => c.packageId))];
  if (!packages.length) return new Set();
  const res = await scope.tx.execute<{ package_id: string }>(sql`
    select p.id as package_id
    from estimating.tender_packages p
    join platform.memberships m on m.user_id = p.created_by and m.status = 'active'
    where p.id in (${sql.join(
      packages.map((i) => sql`${i}::uuid`),
      sql`, `,
    )})
      and (
        m.role in ('owner', 'admin')
        or exists (
          select 1 from platform.project_members pm
          where pm.project_id = p.project_id and pm.user_id = p.created_by and pm.status = 'active'
        )
      )`);
  return new Set(res.rows.map((r) => r.package_id));
}

/** Records which packages have reminders paused because their creator lost access, and clears it when they regain it. */
export async function syncRemindersPaused(
  scope: TenantScope,
  allowed: ReadonlySet<string>,
  all: readonly InviteeCandidate[],
): Promise<void> {
  const seen = new Map(all.map((c) => [c.packageId, c.projectId]));
  for (const [packageId, projectId] of seen) {
    const ok = allowed.has(packageId);
    const res = await scope.tx.execute<{ id: string }>(
      ok
        ? sql`update estimating.tender_packages set invite_reminders_paused_at = null
              where id = ${packageId} and invite_reminders_paused_at is not null returning id`
        : sql`update estimating.tender_packages set invite_reminders_paused_at = now()
              where id = ${packageId} and invite_reminders_paused_at is null returning id`,
    );
    if (!ok && res.rows.length)
      scope.events.add({
        type: 'estimating.package.invite_reminders_paused.v1',
        projectId,
        entityType: 'tender_package',
        entityId: packageId,
        data: { packageId, reason: 'creator_lost_access' },
      });
  }
}

/**
 * Creates the fresh link for a reminder. It is not attached to the invite yet: the old link keeps working until the
 * email has gone out (`commitReminderLink`), and a failed send throws this one away (`discardReminderLink`). Issued in
 * the package creator's name, so `creatorStillAllowed` keeps working when the guest opens it.
 */
export async function mintReminderLink(
  scope: TenantScope,
  p: PlannedInviteeReminder,
  email: string,
  now: Date,
): Promise<{ token: string; expiresAt: Date; linkId: string }> {
  const c = p.candidate;
  const asCreator: TenantScope = { ...scope, ctx: { ...scope.ctx, userId: c.createdBy } };
  const expiresAt = new Date(
    Math.min(
      Math.max(
        now.getTime() + ACCESS_LINK_DEFAULT_DAYS * 86_400_000,
        c.dueAt.getTime() + 7 * 86_400_000,
      ),
      now.getTime() + 90 * 86_400_000,
    ),
  );
  const { link, token } = await createAccessLink(asCreator, {
    projectId: c.projectId,
    entityType: TENDER_LINK_ENTITY,
    entityId: c.packageId,
    allowedActions: TENDER_LINK_ACTIONS,
    label: `Tender ${formatPackageNumber(c.number)}`,
    recipientEmail: email,
    expiresAt,
    maxUses: 100,
  });
  return { token, expiresAt, linkId: link.id };
}

/** After a successful send: the new link becomes the invite's, the old one is revoked, and the reminder is logged. */
export async function commitReminderLink(
  scope: TenantScope,
  p: PlannedInviteeReminder,
  linkId: string,
  now: Date,
): Promise<void> {
  const c = p.candidate;
  if (c.accessLinkId) await revokeAccessLink(scope, c.accessLinkId);
  await scope.tx
    .update(packageInvites)
    .set({ accessLinkId: linkId, lastRemindedAt: now, deliveredAt: now })
    .where(eq(packageInvites.id, c.inviteId));
  scope.events.add({
    type: 'estimating.invite_reminder_sent.v1',
    projectId: c.projectId,
    entityType: 'tender_package',
    entityId: c.packageId,
    data: { packageId: c.packageId, companyId: c.companyId, stage: p.stage },
  });
}

/** After a failed send: the unsent link is revoked and the old one stays, so the invitee is never left without one. */
export async function discardReminderLink(scope: TenantScope, linkId: string): Promise<void> {
  await revokeAccessLink(scope, linkId);
}
