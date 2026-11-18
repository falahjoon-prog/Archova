// Pure rules for announcements: acceptable text, who an audience resolves to, and which key people are overdue.

export const TITLE_MAX = 200;
export const BODY_MAX = 5000;
export const READ_BY_MAX_HOURS = 720;
/** A person nudged this recently is not nudged again, so a double click never pings someone twice. */
export const NUDGE_COOLDOWN_HOURS = 4;

export function cleanTitle(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, ' ');
  return s.length >= 1 && s.length <= TITLE_MAX ? s : null;
}

/** Trims a body, keeping inner line breaks; null when empty or too long. */
export function cleanBody(raw: string): string | null {
  const s = raw.trim();
  return s.length >= 1 && s.length <= BODY_MAX ? s : null;
}

export function previewOf(body: string, max = 140): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export interface MemberRef {
  userId: string;
  companyId: string;
  isExternal: boolean;
}

export type Audience =
  { kind: 'all' } | { kind: 'group'; companyIds: readonly string[]; userIds: readonly string[] };

/** The people an announcement goes to: the sender is never one of them, and nobody appears twice. */
export function resolveAudience(
  members: readonly MemberRef[],
  audience: Audience,
  senderId: string,
): string[] {
  const out = new Set<string>();
  const companies = new Set(audience.kind === 'group' ? audience.companyIds : []);
  const users = new Set(audience.kind === 'group' ? audience.userIds : []);
  for (const m of members) {
    if (m.userId === senderId) continue;
    if (audience.kind === 'all' || companies.has(m.companyId) || users.has(m.userId))
      out.add(m.userId);
  }
  return [...out];
}

export interface ReceiptRow {
  userId: string;
  isKey: boolean;
  readAt: Date | null;
  nudgedAt: Date | null;
}

export interface UnreadFlag {
  userId: string;
  isKey: boolean;
  hoursOverdue: number;
  nudgedAt: Date | null;
}

/** When an announcement should have been read by, or null when the author set no window. */
export function dueAt(createdAt: Date, readByHours: number | null): Date | null {
  return readByHours === null ? null : new Date(createdAt.getTime() + readByHours * 3_600_000);
}

/**
 * Nova's rule-based flag: past the "read by" window, who still hasn't read it. Key people are the ones the author
 * named; when none were named every unread recipient counts. Most overdue first. Nothing is sent from here: the
 * author confirms who to nudge.
 */
export function unreadFlags(
  rows: readonly ReceiptRow[],
  createdAt: Date,
  readByHours: number | null,
  now: Date,
): UnreadFlag[] {
  const due = dueAt(createdAt, readByHours);
  if (!due || now < due) return [];
  const anyKey = rows.some((r) => r.isKey);
  const hoursOverdue = Math.floor((now.getTime() - due.getTime()) / 3_600_000);
  return rows
    .filter((r) => r.readAt === null && (!anyKey || r.isKey))
    .map((r) => ({ userId: r.userId, isKey: r.isKey, hoursOverdue, nudgedAt: r.nudgedAt }));
}

/** Whether a nudge to this person would land inside the cooldown after their last one. */
export const recentlyNudged = (nudgedAt: Date | null, now: Date): boolean =>
  nudgedAt !== null && now.getTime() - nudgedAt.getTime() < NUDGE_COOLDOWN_HOURS * 3_600_000;
