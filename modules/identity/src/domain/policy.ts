// Session and token policy (ADR-0004 §1–2, security-licensing/01).
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
/** Only extend the idle window (and write last_seen_at) when this much has passed, to avoid a write per request. */
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
export const ACCESS_TOKEN_TTL_S = 10 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const AUTH_CODE_TTL_MS = 60 * 1000;
export const PASSWORD_MIN_LENGTH = 10;

export const SESSION_COOKIE = '__Host-sid';
export const CSRF_COOKIE = '__Host-csrf';

export interface SessionTimes {
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
}

export function isSessionActive(s: SessionTimes, now: Date): boolean {
  return !s.revokedAt && s.idleExpiresAt > now && s.absoluteExpiresAt > now;
}

/** Next idle expiry, capped by the absolute expiry. */
export function nextIdleExpiry(now: Date, absoluteExpiresAt: Date): Date {
  return new Date(Math.min(now.getTime() + SESSION_IDLE_MS, absoluteExpiresAt.getTime()));
}

export function passwordProblems(password: string, email: string): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH)
    problems.push(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  if (local.length >= 4 && password.toLowerCase().includes(local))
    problems.push("Don't include your email in your password.");
  return problems;
}
