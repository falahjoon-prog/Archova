import type { InductionRegisterEntry } from './types';

export type BoardFilter = 'all' | 'action' | 'expiring' | 'current';

/** Needs a supervisor's attention before this worker can sign in, or soon will. */
export const needsAction = (e: InductionRegisterEntry): boolean =>
  e.expiringSoon || e.status !== 'current';

export function filterEntries(
  rows: readonly InductionRegisterEntry[],
  filter: BoardFilter,
): InductionRegisterEntry[] {
  if (filter === 'action') return rows.filter(needsAction);
  if (filter === 'expiring') return rows.filter((e) => e.expiringSoon);
  if (filter === 'current') return rows.filter((e) => e.status === 'current' && !e.expiringSoon);
  return [...rows];
}

export interface BoardSummary {
  total: number;
  current: number;
  expiringSoon: number;
  expiredOrOutdated: number;
  notInducted: number;
}

export function summarise(rows: readonly InductionRegisterEntry[]): BoardSummary {
  const s: BoardSummary = {
    total: rows.length,
    current: 0,
    expiringSoon: 0,
    expiredOrOutdated: 0,
    notInducted: 0,
  };
  for (const e of rows) {
    if (e.expiringSoon) s.expiringSoon++;
    else if (e.status === 'current') s.current++;
    else if (e.status === 'expired' || e.status === 'needs_reinduction') s.expiredOrOutdated++;
    else s.notInducted++;
  }
  return s;
}

export interface CompanyRow extends BoardSummary {
  key: string;
  company: string;
}

/** One row per company, worst first, so a supervisor sees which subcontractor to chase. */
export function byCompany(
  rows: readonly InductionRegisterEntry[],
  companyOf: (e: InductionRegisterEntry) => string,
): CompanyRow[] {
  const groups = new Map<string, InductionRegisterEntry[]>();
  for (const e of rows) {
    const name = companyOf(e);
    groups.set(name, [...(groups.get(name) ?? []), e]);
  }
  return [...groups.entries()]
    .map(([company, list]) => ({ key: company, company, ...summarise(list) }))
    .sort(
      (a, b) =>
        b.expiredOrOutdated + b.notInducted - (a.expiredOrOutdated + a.notInducted) ||
        b.expiringSoon - a.expiringSoon ||
        a.company.localeCompare(b.company),
    );
}

/** "in 12 days", "today", "3 days ago" for the expiry column. */
export function expiryHint(daysToExpiry: number | null): string | null {
  if (daysToExpiry === null) return null;
  if (daysToExpiry === 0) return 'today';
  const n = Math.abs(daysToExpiry);
  const unit = n === 1 ? 'day' : 'days';
  return daysToExpiry > 0 ? `in ${n} ${unit}` : `${n} ${unit} ago`;
}
