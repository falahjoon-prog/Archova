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

export type GateCheckMode = 'block' | 'warn';

export interface Gate {
  id: string;
  siteId: string;
  name: string;
  active: boolean;
  /** Goes up each time the code is reissued; printed posters with an older code stop working (ATT-AC1). */
  qrVersion: number;
  version: number;
}

/** A sign-in site with its gates. */
export interface AttendanceSite {
  id: string;
  name: string;
  /** `HH:MM` site time; open sign-ins close at this time (ATT-AC4). */
  dayEndLocal: string;
  gateCheckMode: GateCheckMode;
  active: boolean;
  gates: Gate[];
  version: number;
}

export interface SiteInput {
  name: string;
  dayEndLocal: string;
  gateCheckMode: GateCheckMode;
}

/** A gate with its QR code. The server shows the code only once, when the gate is added or the code reissued. */
export interface GateWithCode {
  gate: Gate;
  code: string;
}

export const CHECK_MODE_LABELS: Record<GateCheckMode, string> = {
  block: 'Block workers who fail the induction check',
  warn: 'Warn the site manager, let them in',
};
