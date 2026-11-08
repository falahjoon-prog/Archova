import { addDays, compareLocalDates, type LocalDate } from '@archova/time';

/** An RFI or defect that is still open, reduced to what the project overview needs. */
export interface OverviewItem {
  key: string;
  kind: 'RFI' | 'Defect';
  ref: string;
  title: string;
  dueDate: LocalDate | null;
  href: string;
}

export interface OpenItemBuckets {
  overdue: OverviewItem[];
  today: OverviewItem[];
  next7: OverviewItem[];
}

/**
 * Sorts open items into overdue, due today and due in the next 7 days, by the project's local date (X34). Items
 * with no due date, or due later than a week out, are in none of the buckets. Each bucket is ordered soonest first.
 */
export function bucketOpenItems(items: readonly OverviewItem[], today: LocalDate): OpenItemBuckets {
  const horizon = addDays(today, 7);
  const out: OpenItemBuckets = { overdue: [], today: [], next7: [] };
  for (const item of items) {
    if (!item.dueDate) continue;
    const vsToday = compareLocalDates(item.dueDate, today);
    if (vsToday < 0) out.overdue.push(item);
    else if (vsToday === 0) out.today.push(item);
    else if (compareLocalDates(item.dueDate, horizon) <= 0) out.next7.push(item);
  }
  const byDue = (a: OverviewItem, b: OverviewItem) =>
    compareLocalDates(a.dueDate as LocalDate, b.dueDate as LocalDate);
  out.overdue.sort(byDue);
  out.today.sort(byDue);
  out.next7.sort(byDue);
  return out;
}
