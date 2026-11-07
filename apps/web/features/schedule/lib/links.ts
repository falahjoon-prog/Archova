import type { ScheduleLink } from '../data/programme';

export interface OpenItems {
  rfis: number;
  submittals: number;
  /** An open item that is overdue or needed on site before the activity finishes. */
  atRisk: boolean;
}

const RFI_OPEN = new Set(['draft', 'open']);
const SUBMITTAL_DONE = new Set(['approved', 'approved_as_noted', 'closed', 'rejected']);

/**
 * Per activity, the linked RFIs and submittals still waiting on someone (SCH-US10). Items the caller can't see aren't
 * counted, since their state is unknown. `atRisk` means an open item is overdue, or due on or after the day the activity
 * starts: the work is waiting on an answer that hasn't come.
 */
export function openItemsByActivity(
  links: readonly ScheduleLink[],
  starts: ReadonlyMap<string, string>,
  today: string,
): Map<string, OpenItems> {
  const out = new Map<string, OpenItems>();
  for (const l of links) {
    if (!l.visible || !l.status) continue;
    const open = l.kind === 'rfi' ? RFI_OPEN.has(l.status) : !SUBMITTAL_DONE.has(l.status);
    if (!open) continue;
    const cur = out.get(l.activityId) ?? { rfis: 0, submittals: 0, atRisk: false };
    if (l.kind === 'rfi') cur.rfis++;
    else cur.submittals++;
    const start = starts.get(l.activityId);
    if (l.dueDate && ((start && l.dueDate >= start) || l.dueDate < today)) cur.atRisk = true;
    out.set(l.activityId, cur);
  }
  return out;
}

export function openItemsLabel(o: OpenItems): string {
  const parts = [
    o.rfis ? `${o.rfis} open RFI${o.rfis === 1 ? '' : 's'}` : '',
    o.submittals ? `${o.submittals} open submittal${o.submittals === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return parts.join(', ');
}
