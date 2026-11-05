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
  await scope.tx
    .update(packageInvites)
    .set({ deliveredAt: null })
    .where(eq(packageInvites.id, p.candidate.inviteId));
}

/**
 * Replaces the invite's link with a new one and returns its token. The old link is revoked. Issued in the package
 * creator's name, so `creatorStillAllowed` keeps working when the guest opens it.
 */
export async function mintReminderLink(
  scope: TenantScope,
  p: PlannedInviteeReminder,
  email: string,
  now: Date,
): Promise<{ token: string; expiresAt: Date }> {
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
  if (c.accessLinkId) await revokeAccessLink(asCreator, c.accessLinkId);
  await scope.tx
    .update(packageInvites)
    .set({ accessLinkId: link.id, lastRemindedAt: now, deliveredAt: now })
    .where(eq(packageInvites.id, c.inviteId));
  return { token, expiresAt };
}
