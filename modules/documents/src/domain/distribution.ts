// Distribution tracking for the document control register: for each drawing sheet and document, who was sent which
// revision, whether they acknowledged it, and what needs chasing. Pure and rule-based (no model): the Nova flags on
// the register come from here.

export type RegisterItemKind = 'drawing' | 'document';

export interface RegisterItemInput {
  kind: RegisterItemKind;
  /** Sheet id or document id: what revisions belong to. */
  key: string;
  number: string | null;
  title: string;
  discipline: string | null;
  currentRevisionId: string | null;
  currentRev: string | null;
}

export interface RevisionRef {
  kind: RegisterItemKind;
  revisionId: string;
  itemKey: string;
  rev: string;
}

export interface SentRecipient {
  email: string;
  name: string | null;
  companyId: string | null;
  role: 'to' | 'cc';
  deliveredAt: Date | null;
  openedAt: Date | null;
  downloadedAt: Date | null;
  acknowledgedAt: Date | null;
}

export interface SentTransmittal {
  id: string;
  number: number;
  sentAt: Date;
  /** ISO date (yyyy-mm-dd) in the project's timezone. */
  responseDue: string | null;
  items: Array<{ kind: RegisterItemKind; revisionId: string }>;
  recipients: SentRecipient[];
}

export type RecipientStatus =
  /** Has the current revision and acknowledged it. */
  | 'acknowledged'
  /** Has the current revision; copy-only recipients are not asked to acknowledge. */
  | 'cc'
  /** Has the current revision, acknowledgement requested and not yet late. */
  | 'pending'
  /** Has the current revision and has not acknowledged within the grace period. */
  | 'outstanding'
  /** Has the current revision and the response date has passed. */
  | 'overdue'
  /** Was sent an earlier revision and not the current one. */
  | 'stale';

export type RegisterFlagKind =
  'ack_overdue' | 'ack_outstanding' | 'superseded_in_use' | 'distribution_gap' | 'not_distributed';

export interface RegisterFlag {
  kind: RegisterFlagKind;
  severity: 'high' | 'medium' | 'low';
  message: string;
  count: number;
}

export interface RegisterRecipient {
  email: string;
  name: string | null;
  companyId: string | null;
  role: 'to' | 'cc';
  status: RecipientStatus;
  /** The revision they were last sent. */
  rev: string;
  revisionId: string;
  transmittalId: string;
  transmittalNumber: number;
  sentAt: Date;
  openedAt: Date | null;
  downloadedAt: Date | null;
  acknowledgedAt: Date | null;
}

export interface RegisterRow {
  kind: RegisterItemKind;
  key: string;
  number: string | null;
  title: string;
  discipline: string | null;
  currentRevisionId: string | null;
  currentRev: string | null;
  recipients: RegisterRecipient[];
  flags: RegisterFlag[];
}

/** Days after sending before a missing acknowledgement is worth chasing when no response date was set. */
export const ACK_GRACE_DAYS = 5;
const DAY_MS = 86_400_000;

export function computeRegister(input: {
  items: RegisterItemInput[];
  revisions: RevisionRef[];
  transmittals: SentTransmittal[];
  now: Date;
  /** ISO date for "today" in the project's timezone, to compare with response dates. */
  today: string;
}): RegisterRow[] {
  const revById = new Map(input.revisions.map((r) => [`${r.kind}:${r.revisionId}`, r]));
  const sent = [...input.transmittals].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());

  // item key -> email -> the latest thing that recipient was sent for that item
  const latest = new Map<string, Map<string, RegisterRecipient>>();
  const currentSent = new Set<string>();
  for (const t of sent) {
    for (const it of t.items) {
      const rev = revById.get(`${it.kind}:${it.revisionId}`);
      if (!rev) continue;
      const itemKey = `${rev.kind}:${rev.itemKey}`;
      const byEmail = latest.get(itemKey) ?? new Map<string, RegisterRecipient>();
      latest.set(itemKey, byEmail);
      currentSent.add(`${it.kind}:${it.revisionId}`);
      for (const r of t.recipients) {
        byEmail.set(r.email.toLowerCase(), {
          email: r.email,
          name: r.name,
          companyId: r.companyId,
          role: r.role,
          status: 'stale', // settled below once the current revision is known
          rev: rev.rev,
          revisionId: it.revisionId,
          transmittalId: t.id,
          transmittalNumber: t.number,
          sentAt: t.sentAt,
          openedAt: r.openedAt,
          downloadedAt: r.downloadedAt,
          acknowledgedAt: r.acknowledgedAt,
        });
      }
    }
  }
  const dueByTransmittal = new Map(sent.map((t) => [t.id, t.responseDue]));

  return input.items.map((item) => {
    const recipients = [...(latest.get(`${item.kind}:${item.key}`)?.values() ?? [])];
    for (const r of recipients) {
      if (r.revisionId !== item.currentRevisionId) {
        r.status = 'stale';
      } else if (r.acknowledgedAt) {
        r.status = 'acknowledged';
      } else if (r.role === 'cc') {
        r.status = 'cc';
      } else {
        const due = dueByTransmittal.get(r.transmittalId);
        if (due && due < input.today) r.status = 'overdue';
        else if (!due && input.now.getTime() - r.sentAt.getTime() >= ACK_GRACE_DAYS * DAY_MS)
          r.status = 'outstanding';
        else r.status = 'pending';
      }
    }
    recipients.sort((a, b) => a.email.localeCompare(b.email));
    return {
      kind: item.kind,
      key: item.key,
      number: item.number,
      title: item.title,
      discipline: item.discipline,
      currentRevisionId: item.currentRevisionId,
      currentRev: item.currentRev,
      recipients,
      flags: flagsFor(item, recipients, currentSent),
    };
  });
}

function flagsFor(
  item: RegisterItemInput,
  recipients: RegisterRecipient[],
  currentSent: Set<string>,
): RegisterFlag[] {
  const flags: RegisterFlag[] = [];
  const label = item.number ? `${item.number} ` : '';
  const count = (s: RecipientStatus) => recipients.filter((r) => r.status === s).length;
  const plural = (n: number) => (n === 1 ? 'recipient' : 'recipients');
  const rev = item.currentRev ? ` rev ${item.currentRev}` : '';

  if (item.currentRevisionId && !currentSent.has(`${item.kind}:${item.currentRevisionId}`)) {
    flags.push({
      kind: 'not_distributed',
      severity: 'low',
      message: `${label}${item.currentRev ? `rev ${item.currentRev} ` : ''}hasn't been issued on a transmittal.`,
      count: 0,
    });
  }
  const overdue = count('overdue');
  if (overdue)
    flags.push({
      kind: 'ack_overdue',
      severity: 'high',
      message: `${overdue} ${plural(overdue)} still to acknowledge${rev}, past the response date.`,
      count: overdue,
    });
  const outstanding = count('outstanding');
  if (outstanding)
    flags.push({
      kind: 'ack_outstanding',
      severity: 'medium',
      message: `${outstanding} ${plural(outstanding)} haven't acknowledged${rev} after ${ACK_GRACE_DAYS}+ days.`,
      count: outstanding,
    });

  const stale = recipients.filter((r) => r.status === 'stale');
  const inUse = stale.filter((r) => r.downloadedAt || r.acknowledgedAt);
  if (inUse.length)
    flags.push({
      kind: 'superseded_in_use',
      severity: 'high',
      message: `${inUse.length} ${plural(inUse.length)} downloaded or acknowledged a superseded revision and haven't been sent${rev}.`,
      count: inUse.length,
    });
  const gaps = stale.length - inUse.length;
  if (gaps > 0)
    flags.push({
      kind: 'distribution_gap',
      severity: 'medium',
      message: `${gaps} ${plural(gaps)} were sent an earlier revision but not${rev}.`,
      count: gaps,
    });
  return flags;
}
