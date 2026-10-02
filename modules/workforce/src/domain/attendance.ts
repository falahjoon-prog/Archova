// Pure attendance rules (product/12 ATT-AC1–AC7, backend schema/workforce.md, X54).
import { createHash, randomBytes } from 'node:crypto';
import { zonedToUtc, type LocalDate } from '@archova/time';

export type EligibilityResult = 'eligible' | 'blocked' | 'warning';
export type GateCheckMode = 'block' | 'warn';

export interface EligibilityReason {
  code: string;
  /** Only `blocking` reasons can stop a sign-in; the rest are shown as warnings. */
  blocking: boolean;
  [detail: string]: unknown;
}

/**
 * Combines rule outcomes into the gate decision. In `warn` mode the site lets everyone in and shows the
 * reasons instead (ATT-AC7).
 */
export function decide(
  reasons: readonly EligibilityReason[],
  mode: GateCheckMode,
): EligibilityResult {
  if (!reasons.length) return 'eligible';
  if (mode === 'block' && reasons.some((r) => r.blocking)) return 'blocked';
  return 'warning';
}

export interface WorkerFacts {
  status: 'active' | 'inactive';
  companyId: string | null;
  companyNameOther: string | null;
}

/** Phase 1 rules held by workforce itself. Induction and white card rules are added as more rule sources. */
export function workerReasons(w: WorkerFacts): EligibilityReason[] {
  const out: EligibilityReason[] = [];
  if (w.status !== 'active') out.push({ code: 'worker.inactive', blocking: true });
  if (!w.companyId && w.companyNameOther)
    out.push({ code: 'company.unconfirmed', blocking: false, companyName: w.companyNameOther });
  return out;
}

/** When open sessions for `localDate` close automatically (ATT-AC4, default 7pm site time). */
export function autoCloseAt(localDate: LocalDate, dayEndLocal: string, timeZone: string): Date {
  return zonedToUtc(localDate, dayEndLocal.slice(0, 5), timeZone);
}

export function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
}

/** A device clock may lag (offline queue) but never runs ahead of the server; future times are clamped. */
export function occurredAt(clientAt: Date | undefined, receivedAt: Date): Date {
  if (!clientAt || clientAt.getTime() > receivedAt.getTime()) return receivedAt;
  return clientAt;
}

export interface CompanyDay {
  companyId: string;
  headcount: number;
  hours: number;
}

/** Headcount (distinct workers) and hours per company for one day, as the diary's labour lines want them. */
export function dayTotals(
  sessions: ReadonlyArray<{ companyId: string | null; workerId: string; minutes: number | null }>,
): CompanyDay[] {
  const by = new Map<string, { workers: Set<string>; minutes: number }>();
  for (const s of sessions) {
    if (!s.companyId) continue;
    const c = by.get(s.companyId) ?? { workers: new Set<string>(), minutes: 0 };
    c.workers.add(s.workerId);
    c.minutes += s.minutes ?? 0;
    by.set(s.companyId, c);
  }
  return [...by.entries()].map(([companyId, c]) => ({
    companyId,
    headcount: c.workers.size,
    hours: Math.round((c.minutes / 60) * 100) / 100,
  }));
}

export const QR_TOKEN_PREFIX = 'gqr_';

/** A new gate QR token (256 bits, base64url) and the hash we keep. The token is shown once, on issue. */
export function newGateToken(): { token: string; hash: string } {
  const token = QR_TOKEN_PREFIX + randomBytes(32).toString('base64url');
  return { token, hash: hashGateToken(token) };
}

export function hashGateToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
