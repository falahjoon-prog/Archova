// Roll call display rules (ATT-AC5). Pure, so it runs in Node tests.
import type { RollCall, RollCallPerson } from '@archova/contracts';

export interface CompanyGroup {
  company: string;
  people: RollCallPerson[];
}

/** People grouped by company in the order the server sent them (already sorted by company, then name). */
export function groupByCompany(
  people: readonly RollCallPerson[],
  companyName: (companyId: string) => string | undefined,
): CompanyGroup[] {
  const groups: CompanyGroup[] = [];
  for (const p of people) {
    const company =
      (p.companyId ? companyName(p.companyId) : undefined) ?? p.companyNameOther ?? 'No company';
    const last = groups[groups.length - 1];
    if (last && last.company === company) last.people.push(p);
    else groups.push({ company, people: [p] });
  }
  return groups;
}

export const markLabel: Record<RollCallPerson['status'], string> = {
  unmarked: 'Not checked yet',
  accounted_for: 'Accounted for',
  missing: 'Missing',
  not_on_site: 'Not on site',
};

/** "30 of 42 accounted for · 2 missing · 10 to check" */
export function progressLabel(counts: RollCall['counts']): string {
  const parts = [`${counts.accountedFor} of ${counts.total} accounted for`];
  if (counts.missing > 0) parts.push(`${counts.missing} missing`);
  if (counts.unmarked > 0) parts.push(`${counts.unmarked} to check`);
  return parts.join(' · ');
}
