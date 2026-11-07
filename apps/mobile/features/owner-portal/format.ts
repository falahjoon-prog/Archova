/** "$45,000.00" from whole cents (AUD). */
export function moneyText(cents: number): string {
  const whole = Math.floor(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${whole}.${String(cents % 100).padStart(2, '0')}`;
}

/** "12 Nov 2026" from a project-local day, with no zone maths. */
export function dayText(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export const MILESTONE_TEXT = {
  done: 'Done',
  on_track: 'On track',
  at_risk: 'At risk',
  late: 'Late',
} as const;

export const APPROVAL_TEXT = {
  requested: 'Waiting for the client',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
} as const;

/** "Level 2 slab, 20 Oct 2026, Done" */
export function milestoneText(m: {
  name: string;
  date: string | null;
  status: keyof typeof MILESTONE_TEXT;
}): string {
  return [m.name, m.date ? dayText(m.date) : null, MILESTONE_TEXT[m.status]]
    .filter(Boolean)
    .join(', ');
}

export function yearLabel(fiscalYear: number | null): string {
  return fiscalYear === null ? 'All years' : `FY${fiscalYear}`;
}
