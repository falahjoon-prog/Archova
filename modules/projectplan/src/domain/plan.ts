// Project action plan rules: item types, hold points, overdue and at-risk, number labels, Nova's rule-based
// insights and the phase summary draft. Pure, no IO.

export const ITEM_TYPES = [
  'document',
  'checklist',
  'inspection',
  'meeting',
  'signed_document',
  'application',
  'notification',
  'hold_point',
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export const ITEM_STATUSES = ['not_started', 'in_progress', 'complete'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export const LINK_TYPES = [
  'rfi',
  'submittal',
  'inspection',
  'meeting',
  'drawing',
  'document',
  'correspondence',
  'defect',
  'esign_envelope',
] as const;
export type LinkType = (typeof LINK_TYPES)[number];
export const PARTY_KINDS = ['internal', 'third_party'] as const;

/** The module a linked item type points at, so the panel can offer "Create new" and "Link …". */
export const TYPE_TO_LINK: Partial<Record<ItemType, LinkType>> = {
  inspection: 'inspection',
  meeting: 'meeting',
  document: 'document',
  signed_document: 'esign_envelope',
};

export interface Party {
  kind: (typeof PARTY_KINDS)[number];
  companyId: string | null;
  userIds: string[];
  label: string;
  confirmed: boolean;
}
export interface PlanLink {
  type: LinkType;
  id: string;
  label: string;
}

export const itemNumber = (phase: number, position: number) => `${phase}.${position}`;
export const isHold = (types: readonly string[]) => types.includes('hold_point');

/** Soon means within this many days. */
export const AT_RISK_DAYS = 7;

export const isOverdue = (status: ItemStatus, dueDate: string | null, today: string) =>
  status !== 'complete' && dueDate !== null && dueDate < today;

export interface FlatItem {
  id: string;
  phaseId: string;
  phasePosition: number;
  position: number;
  status: ItemStatus;
  types: readonly string[];
  holdCleared: boolean;
}

/** The order the plan is worked in: phase by phase, item by item. */
export const planOrder = (a: FlatItem, b: FlatItem) =>
  a.phasePosition - b.phasePosition || a.position - b.position;

/**
 * Hold points that are not cleared yet and come before the item in plan order. An item may not be completed
 * while any exists. A hold point does not block itself.
 */
export function blockingHolds<T extends FlatItem>(all: readonly T[], item: FlatItem): T[] {
  return all
    .filter((h) => h.id !== item.id && isHold(h.types) && !h.holdCleared && planOrder(h, item) < 0)
    .sort(planOrder);
}

export interface InsightItem extends FlatItem {
  number: string;
  title: string;
  dueDate: string | null;
  phaseTitle: string;
}
export interface Insights {
  overdue: { itemId: string; number: string; title: string; daysLate: number }[];
  atRisk: { itemId: string; number: string; title: string; daysLeft: number }[];
  /** Hold points that are holding up later work, with how many items they hold. */
  blockedByHold: { holdItemId: string; number: string; title: string; blockedCount: number }[];
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function insightsFor(items: readonly InsightItem[], today: string): Insights {
  const open = items.filter((i) => i.status !== 'complete');
  const overdue = open
    .filter((i) => isOverdue(i.status, i.dueDate, today))
    .map((i) => ({
      itemId: i.id,
      number: i.number,
      title: i.title,
      daysLate: daysBetween(i.dueDate!, today),
    }))
    .sort((a, b) => b.daysLate - a.daysLate);
  const atRisk = open
    .filter(
      (i) =>
        i.dueDate !== null && i.dueDate >= today && daysBetween(today, i.dueDate) <= AT_RISK_DAYS,
    )
    .map((i) => ({
      itemId: i.id,
      number: i.number,
      title: i.title,
      daysLeft: daysBetween(today, i.dueDate!),
    }))
    .sort((a, b) => a.daysLeft - b.daysLeft);
  const holds = items.filter((i) => isHold(i.types) && !i.holdCleared && i.status !== 'complete');
  const blockedByHold = holds
    .map((h) => ({
      holdItemId: h.id,
      number: h.number,
      title: h.title,
      blockedCount: open.filter((i) => i.id !== h.id && planOrder(h, i) < 0).length,
    }))
    .filter((b) => b.blockedCount > 0);
  return { overdue, atRisk, blockedByHold };
}

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
const STOP = new Set(['the', 'and', 'for', 'with', 'report', 'review', 'check']);

/** 0..1 overlap of the item's words with the record's title (Dice coefficient). */
export function titleMatch(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (x.size === 0 || y.size === 0) return 0;
  let hit = 0;
  for (const w of x) if (y.has(w)) hit++;
  return (2 * hit) / (x.size + y.size);
}

export const SUGGEST_THRESHOLD = 0.5;

export interface PhaseSummaryInput {
  number: number;
  title: string;
  items: {
    number: string;
    title: string;
    status: ItemStatus;
    dueDate: string | null;
    types: readonly string[];
    holdCleared: boolean;
  }[];
}

/** A short owner-report paragraph for a phase. Facts only; a model can polish it later but never invent more. */
export function draftPhaseSummary(phase: PhaseSummaryInput, today: string): string {
  const total = phase.items.length;
  const done = phase.items.filter((i) => i.status === 'complete').length;
  const lines = [`Phase ${phase.number}, ${phase.title}: ${done} of ${total} items complete.`];
  if (total === 0) return lines[0]!;
  const late = phase.items.filter((i) => isOverdue(i.status, i.dueDate, today));
  if (late.length)
    lines.push(`${late.length} overdue: ${late.map((i) => `${i.number} ${i.title}`).join('; ')}.`);
  const holds = phase.items.filter((i) => isHold(i.types) && !i.holdCleared);
  if (holds.length)
    lines.push(
      `Waiting on hold point clearance: ${holds.map((i) => `${i.number} ${i.title}`).join('; ')}.`,
    );
  if (!late.length && !holds.length && done < total) lines.push('No overdue items or hold points.');
  if (done === total) lines.push('The phase is complete.');
  return lines.join(' ');
}
