// Pure rules for e-signature envelopes: who is asked when, when the envelope is done, and what a draft needs
// before it can go out. No I/O here so it is all unit-testable.

export const SUBJECT_MAX = 100;
export const MESSAGE_MAX = 2000;
export const MAX_RECIPIENTS = 20;
export const MAX_DOCUMENTS = 10;
export const DEFAULT_EXPIRES_DAYS = 120;

export const SOURCE_TYPES = ['correspondence', 'rfi', 'submittal', 'contract', 'other'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const ENVELOPE_STATUSES = [
  'draft',
  'sent',
  'completed',
  'declined',
  'voided',
  'expired',
] as const;
export type EnvelopeStatus = (typeof ENVELOPE_STATUSES)[number];

/** needs_to_sign must sign; needs_to_view must open it; receives_copy only gets the finished copy. */
export const RECIPIENT_ROLES = ['needs_to_sign', 'needs_to_view', 'receives_copy'] as const;
export type RecipientRole = (typeof RECIPIENT_ROLES)[number];

export const RECIPIENT_STATUSES = [
  'pending',
  'sent',
  'viewed',
  'signed',
  'declined',
  'delegated',
] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

export const FIELD_KINDS = ['signature', 'date_signed'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export interface RecipientState {
  id: string;
  email: string;
  role: RecipientRole;
  routingOrder: number;
  status: RecipientStatus;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (v: string) => v.length <= 254 && EMAIL.test(v);

/** Roles that have something to do before the envelope can move on. */
export const isActionable = (role: RecipientRole) => role !== 'receives_copy';

/** Delegated recipients were replaced by someone else and no longer count. */
const isLive = (r: RecipientState) => r.status !== 'delegated';

/** A recipient has done their part: signers signed, viewers opened it. */
export function isDone(r: RecipientState): boolean {
  if (r.role === 'needs_to_sign') return r.status === 'signed';
  if (r.role === 'needs_to_view') return r.status === 'viewed' || r.status === 'signed';
  return true;
}

/**
 * Recipients who should be emailed their link now: everyone actionable who hasn't been sent one, or, with a signing
 * order, only the lowest routing group that still has work left (so the next group waits for the one before it).
 */
export function toNotify(recipients: readonly RecipientState[], signingOrder: boolean) {
  const open = recipients.filter((r) => isLive(r) && isActionable(r.role) && !isDone(r));
  if (!signingOrder) return open.filter((r) => r.status === 'pending');
  if (!open.length) return [];
  const turn = Math.min(...open.map((r) => r.routingOrder));
  return open.filter((r) => r.routingOrder === turn && r.status === 'pending');
}

/** Whether it is this recipient's turn to act. Without a signing order, always. */
export function isTurn(
  recipients: readonly RecipientState[],
  signingOrder: boolean,
  recipientId: string,
): boolean {
  if (!signingOrder) return true;
  const open = recipients.filter((r) => isLive(r) && isActionable(r.role) && !isDone(r));
  if (!open.length) return true;
  const turn = Math.min(...open.map((r) => r.routingOrder));
  const me = open.find((r) => r.id === recipientId);
  return !me || me.routingOrder === turn;
}

/** Done when every live signer has signed (and every live viewer has viewed). */
export function isComplete(recipients: readonly RecipientState[]): boolean {
  const live = recipients.filter((r) => isLive(r) && isActionable(r.role));
  return live.some((r) => r.role === 'needs_to_sign') && live.every(isDone);
}

export function expiryOf(sentAt: Date, days: number): Date {
  return new Date(sentAt.getTime() + days * 86_400_000);
}

/** When to remind: `reminderDays` before expiry, or never. */
export function reminderDue(
  env: { expiresAt: Date | null; reminderDays: number | null; lastRemindedAt: Date | null },
  now: Date,
): boolean {
  if (!env.expiresAt || !env.reminderDays) return false;
  const at = env.expiresAt.getTime() - env.reminderDays * 86_400_000;
  if (now.getTime() < at || now.getTime() >= env.expiresAt.getTime()) return false;
  return !env.lastRemindedAt || env.lastRemindedAt.getTime() < at;
}

export interface DraftCheck {
  subject: string;
  documentCount: number;
  recipients: ReadonlyArray<{ email: string; role: RecipientRole; name: string }>;
}

/** What is still missing before a draft can be sent: `{ path, message }` pairs, empty when ready. */
export function sendProblems(d: DraftCheck): Array<{ path: string; message: string }> {
  const out: Array<{ path: string; message: string }> = [];
  if (!d.documentCount) out.push({ path: 'documents', message: 'Add at least one document' });
  if (!d.subject.trim()) out.push({ path: 'subject', message: 'Add an email subject' });
  if (!d.recipients.some((r) => r.role === 'needs_to_sign'))
    out.push({ path: 'recipients', message: 'Add at least one person who needs to sign' });
  const seen = new Set<string>();
  d.recipients.forEach((r, i) => {
    if (!r.name.trim()) out.push({ path: `recipients/${i}/name`, message: 'Add a name' });
    if (!isEmail(r.email))
      out.push({ path: `recipients/${i}/email`, message: 'Add a valid email' });
    const key = r.email.toLowerCase();
    if (seen.has(key))
      out.push({ path: `recipients/${i}/email`, message: 'Each person can only be added once' });
    seen.add(key);
  });
  return out;
}

/** Strips line breaks so a name or subject can never add a header or a line to an email. */
export const oneLine = (v: string) => v.replace(/[\r\n]+/g, ' ').trim();

/** A drawn signature must be a small PNG data URL; a typed one a short plain name. */
export function checkSignature(
  kind: 'typed' | 'drawn',
  value: string,
): { ok: true; value: string } | { ok: false; message: string } {
  if (kind === 'typed') {
    const v = oneLine(value);
    // eslint-disable-next-line no-control-regex
    if (!v || v.length > 100 || /[\u0000-\u001f]/.test(v))
      return { ok: false, message: 'Type your full name (up to 100 characters)' };
    return { ok: true, value: v };
  }
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!m || value.length > 150_000) return { ok: false, message: 'The drawn signature is invalid' };
  const bytes = Buffer.from(m[1]!, 'base64');
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 100 || !PNG.every((b, i) => bytes[i] === b))
    return { ok: false, message: 'The drawn signature is invalid' };
  return { ok: true, value };
}
