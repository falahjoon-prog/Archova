export const STATUS_TEXT: Record<string, string> = { open: 'Open', closed: 'Closed' };
export const statusLabel = (s: string) => STATUS_TEXT[s] ?? s;

/** "TBT-0004, Open, 3 of 5 signed" */
export function talkSubtitle(t: {
  numberLabel: string;
  status: string;
  attendeeCount: number;
  signedCount: number;
  heldAt: string;
}): string {
  return [
    t.numberLabel,
    statusLabel(t.status),
    `${t.signedCount} of ${t.attendeeCount} signed`,
    t.heldAt.slice(0, 10),
  ].join(', ');
}

export const REPEAT_TEXT: Record<string, string> = {
  shared_between_people: 'Same signature as someone else in this talk',
  reused_from_earlier_talk: 'Same signature image as an earlier talk',
};

export function attendeeSubtitle(a: { signedAt: string | null; repeatFlags: readonly string[] }) {
  return [
    a.signedAt ? 'Signed' : 'Not signed yet',
    ...a.repeatFlags.map((f) => REPEAT_TEXT[f] ?? f),
  ].join('. ');
}
