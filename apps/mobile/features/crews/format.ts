/** "Concrete crew, Formwork" or just the trade when the shift has no crew label. */
export const shiftTitle = (s: { crew: string | null; trade: string }) =>
  s.crew ? `${s.crew}, ${s.trade}` : s.trade;

/** "Mon 9 Nov, 7:00 am to 3:30 pm" in the given zone. */
export function shiftWhen(startsAt: string, endsAt: string, zone: string): string {
  const day = new Date(startsAt).toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: zone,
  });
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-AU', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: zone,
    });
  return `${day}, ${time(startsAt)} to ${time(endsAt)}`;
}

export function shiftSubtitle(
  s: {
    requiredHeadcount: number;
    filled: number;
    status: string;
    startsAt: string;
    endsAt: string;
  },
  zone: string,
): string {
  return [
    shiftWhen(s.startsAt, s.endsAt, zone),
    `${s.filled} of ${s.requiredHeadcount} filled`,
    s.status === 'draft' ? 'not published' : s.status === 'cancelled' ? 'cancelled' : null,
  ]
    .filter(Boolean)
    .join(', ');
}

/** "2 accepted, 1 offered": how the people on a shift have answered. */
export function assignmentSummary(assignments: readonly { status: string }[]): string {
  const order = ['attended', 'accepted', 'offered', 'declined', 'no_show'] as const;
  const label = {
    attended: 'attended',
    accepted: 'accepted',
    offered: 'offered',
    declined: 'declined',
    no_show: 'no show',
  };
  return order
    .map((st) => [st, assignments.filter((a) => a.status === st).length] as const)
    .filter(([, n]) => n > 0)
    .map(([st, n]) => `${n} ${label[st]}`)
    .join(', ');
}
