type Tally = {
  invited: number;
  viewed: number;
  declined: number;
  intendsToQuote: number;
  submitted: number;
  awaiting: number;
};

type DueState = 'overdue' | 'closing_soon' | 'open' | null;

/** "2 quoted, 1 declined, 1 awaiting", or "No invitees". */
export function responseText(i: Tally): string {
  if (i.invited + i.viewed + i.declined + i.intendsToQuote + i.submitted === 0)
    return 'No invitees';
  return [
    i.submitted ? `${i.submitted} quoted` : '',
    i.intendsToQuote ? `${i.intendsToQuote} intend to quote` : '',
    i.declined ? `${i.declined} declined` : '',
    i.awaiting ? `${i.awaiting} awaiting` : '',
  ]
    .filter(Boolean)
    .join(', ');
}

/** "Due 7 Nov, 4:00 pm" in the phone's own zone, with "overdue" or "closing soon" where it applies. */
export function dueLine(dueAt: string | null, dueState: DueState): string {
  if (!dueAt) return 'No due date';
  const when = new Date(dueAt).toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  const flag =
    dueState === 'overdue' ? ', overdue' : dueState === 'closing_soon' ? ', closing soon' : '';
  return `Due ${when}${flag}`;
}

/** "$11,000.00 lowest ex GST", or null while no quote is confirmed. */
export function lowestText(amount: string | null): string | null {
  if (amount === null) return null;
  const [whole = '0', cents = '00'] = amount.split('.');
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents.padEnd(2, '0')} lowest ex GST`;
}

export const STATUS_TEXT = {
  draft: 'Draft',
  out_to_tender: 'Out to tender',
  closed: 'Closed',
  awarded: 'Awarded',
  cancelled: 'Cancelled',
} as const;

/** One subtitle for a board row: project, status, due, who answered, what to review and the price. */
export function boardSubtitle(e: {
  projectName: string;
  status: keyof typeof STATUS_TEXT;
  dueAt: string | null;
  dueState: DueState;
  invites: Tally;
  quotesToReview: number;
  lowestExGst: string | null;
}): string {
  return [
    e.projectName,
    STATUS_TEXT[e.status],
    dueLine(e.dueAt, e.dueState),
    responseText(e.invites),
    e.quotesToReview ? `${e.quotesToReview} to review` : '',
    lowestText(e.lowestExGst) ?? '',
  ]
    .filter(Boolean)
    .join('. ');
}

/** "Tiling, 3 companies: Tiles A, Tiles B, Tiles C"; names drop out when they could not be loaded. */
export function listSubtitle(
  l: { trade: string; companyIds: readonly string[] },
  names: ReadonlyMap<string, string>,
): string {
  const count = `${l.companyIds.length} ${l.companyIds.length === 1 ? 'company' : 'companies'}`;
  const who = l.companyIds.map((id) => names.get(id)).filter((n): n is string => Boolean(n));
  return [l.trade, who.length ? `${count}: ${who.join(', ')}` : count].filter(Boolean).join(', ');
}
