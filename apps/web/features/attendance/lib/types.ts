export type WorkerKind = 'worker' | 'visitor' | 'delivery';
export type SessionStatus = 'on_site' | 'off_site' | 'auto_closed' | 'disputed';

/** One sign-in with the person who made it. */
export interface AttendanceEntry {
  id: string;
  siteId: string;
  workerName: string;
  kind: WorkerKind;
  companyId: string | null;
  /** A company typed at the gate that the site manager hasn't confirmed yet. */
  companyNameOther: string | null;
  localDate: string;
  signedInAt: string;
  signedOutAt: string | null;
  minutes: number | null;
  status: SessionStatus;
}

export interface OnSiteCompany {
  companyId: string | null;
  companyNameOther: string | null;
  count: number;
}

export interface OnSite {
  total: number;
  companies: OnSiteCompany[];
  people: AttendanceEntry[];
}

export const STATUS_LABELS: Record<SessionStatus, string> = {
  on_site: 'On site',
  off_site: 'Signed out',
  auto_closed: 'Closed at day end',
  disputed: 'Disputed',
};

export const KIND_LABELS: Record<WorkerKind, string> = {
  worker: 'Worker',
  visitor: 'Visitor',
  delivery: 'Delivery',
};

/** `7 h 05 min`; the hours of an auto-closed session are not exact (ATT-AC4), so callers prefix them with "about". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : `${h} h ${String(m).padStart(2, '0')} min`;
}
