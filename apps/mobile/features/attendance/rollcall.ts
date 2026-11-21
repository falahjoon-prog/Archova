// Roll call display rules (ATT-AC5). Pure, so it runs in Node tests.
import type { RollCall, RollCallPerson } from '@archova/contracts';
import type { QueuedAction } from '../../lib/actions/action-queue';

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

const countsOf = (people: readonly RollCallPerson[]): RollCall['counts'] => ({
  total: people.length,
  accountedFor: people.filter((p) => p.status === 'accounted_for').length,
  missing: people.filter((p) => p.status === 'missing').length,
  unmarked: people.filter((p) => p.status === 'unmarked').length,
});

/**
 * The roll call as this phone sees it: the last copy from the server with the taps still waiting to be sent laid on
 * top, in order, so a supervisor with no signal still sees who they have ticked. Mirrors the server's rules, which
 * stay the authority (all clear is skipped here while anyone is missing, as it would be refused there).
 */
export function applyQueued(rollCall: RollCall, actions: readonly QueuedAction[]): RollCall {
  let people = rollCall.people;
  let endedAt = rollCall.endedAt;
  for (const a of actions) {
    if (a.state !== 'pending' || a.targetId !== rollCall.id || endedAt) continue;
    const at = typeof a.payload.at === 'string' ? a.payload.at : new Date().toISOString();
    if (a.kind === 'rollcall.mark') {
      people = people.map((p) =>
        p.workerId === a.payload.workerId
          ? { ...p, status: a.payload.status as RollCallPerson['status'], markedAt: at }
          : p,
      );
    } else if (a.kind === 'rollcall.allClear') {
      if (people.some((p) => p.status === 'missing')) continue;
      people = people.map((p) =>
        p.status === 'unmarked' ? { ...p, status: 'accounted_for', markedAt: at } : p,
      );
      endedAt = at;
    } else if (a.kind === 'rollcall.end') {
      endedAt = at;
    }
  }
  if (people === rollCall.people && endedAt === rollCall.endedAt) return rollCall;
  return { ...rollCall, people, endedAt, counts: countsOf(people) };
}
