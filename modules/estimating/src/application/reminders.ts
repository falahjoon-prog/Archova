import { and, eq, gte, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { addDays, compareLocalDates, localDateOf, type LocalDate } from '@archova/time';
import type { TenantScope } from '@archova/kernel';
import { packageInvites, quotes, tenderPackages } from '../infra/tables';
import { formatPackageNumber } from '../domain/tender';

/** How long past its due time a package still out to tender gets its "overdue" reminder. */
export const OVERDUE_WINDOW_DAYS = 14;

export interface BidReminderCandidate {
  packageId: string;
  projectId: string;
  /** The estimator who created the package: the one person told. */
  ownerUserId: string;
  number: number;
  name: string;
  dueAt: Date;
  /** Invitees who have not said yes or no. */
  awaiting: number;
  /** Quotes received and not yet confirmed or declined. */
  toReview: number;
}

export type BidReminderKind = 'tender.bid_due_soon' | 'tender.bid_overdue';

export interface PlannedBidReminder {
  userId: string;
  projectId: string;
  packageId: string;
  kind: BidReminderKind;
  title: string;
  body: string;
  /** One per package, stage and due time: moving the due date reminds again, a rerun never does. */
  dedupeKey: string;
}

/**
 * Packages still out to tender that close within the next day or two, or closed on the clock up to two weeks ago
 * without being closed by the estimator. `now` plus two days is wider than any project's "tomorrow", so the rows
 * are a superset; `planBidReminders` applies each project's own day.
 */
export async function findBidReminderCandidates(
  scope: TenantScope,
  now: Date,
): Promise<BidReminderCandidate[]> {
  const from = new Date(now.getTime() - (OVERDUE_WINDOW_DAYS + 1) * 86_400_000);
  const to = new Date(now.getTime() + 2 * 86_400_000);
  const pkgs = await scope.tx
    .select()
    .from(tenderPackages)
    .where(
      and(
        eq(tenderPackages.status, 'out_to_tender'),
        isNull(tenderPackages.deletedAt),
        isNotNull(tenderPackages.createdBy),
        isNotNull(tenderPackages.dueAt),
        gte(tenderPackages.dueAt, from),
        lte(tenderPackages.dueAt, to),
      ),
    )
    .limit(2000);
  if (pkgs.length === 0) return [];
  const ids = pkgs.map((p) => p.id);
  const [invites, received] = await Promise.all([
    scope.tx
      .select({ packageId: packageInvites.packageId, status: packageInvites.status })
      .from(packageInvites)
      .where(inArray(packageInvites.packageId, ids)),
    scope.tx
      .select({ packageId: quotes.packageId, status: quotes.status })
      .from(quotes)
      .where(inArray(quotes.packageId, ids)),
  ]);
  return pkgs.map((p) => ({
    packageId: p.id,
    projectId: p.projectId,
    ownerUserId: p.createdBy!,
    number: p.number,
    name: p.name,
    dueAt: p.dueAt!,
    awaiting: invites.filter(
      (i) => i.packageId === p.id && (i.status === 'invited' || i.status === 'viewed'),
    ).length,
    toReview: received.filter(
      (q) => q.packageId === p.id && (q.status === 'reading' || q.status === 'ready_to_review'),
    ).length,
  }));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Decides who is told what. Pure. `zoneOf` is the project's time zone (null drops the row) and `isMember` is true for
 * people still on the builder's team, who are the only ones told. Past the due time is overdue; otherwise a package
 * closing today or tomorrow in the project's own day is due soon.
 */
export function planBidReminders(
  candidates: readonly BidReminderCandidate[],
  now: Date,
  ctx: { zoneOf: (projectId: string) => string | null; isMember: (userId: string) => boolean },
): PlannedBidReminder[] {
  const out: PlannedBidReminder[] = [];
  for (const c of candidates) {
    const zone = ctx.zoneOf(c.projectId);
    if (!zone || !ctx.isMember(c.ownerUserId)) continue;
    const today: LocalDate = localDateOf(now, zone);
    const dueDay: LocalDate = localDateOf(c.dueAt, zone);
    let kind: BidReminderKind;
    if (c.dueAt.getTime() <= now.getTime()) {
      if (compareLocalDates(dueDay, addDays(today, -OVERDUE_WINDOW_DAYS)) < 0) continue;
      kind = 'tender.bid_overdue';
    } else if (compareLocalDates(dueDay, addDays(today, 1)) <= 0) {
      kind = 'tender.bid_due_soon';
    } else continue;
    const label = `${formatPackageNumber(c.number)} ${c.name}`;
    const parts = [
      c.awaiting ? `${plural(c.awaiting, 'invitee hasn’t', 'invitees haven’t')} answered` : '',
      c.toReview ? `${plural(c.toReview, 'quote', 'quotes')} to review` : '',
    ].filter(Boolean);
    out.push({
      userId: c.ownerUserId,
      projectId: c.projectId,
      packageId: c.packageId,
      kind,
      title:
        kind === 'tender.bid_overdue'
          ? `${label} is past its due time`
          : dueDay === today
            ? `${label} closes today`
            : `${label} closes tomorrow`,
      body: parts.length ? parts.join(' · ') : 'Close the package or extend its due date.',
      dedupeKey: `tender-package:${c.packageId}:${kind}:${c.dueAt.toISOString()}`,
    });
  }
  return out;
}
