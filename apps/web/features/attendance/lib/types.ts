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

/** A custom geofence circle for a site. */
export interface SiteBoundary {
  lat: number;
  lng: number;
  /** 10 to 10,000 metres. */
  radiusM: number;
}

/** A sign-in site with its gates. */

export interface AttendanceSite {
  id: string;
  name: string;
  /** `HH:MM` site time; open sign-ins close at this time (ATT-AC4). */
  dayEndLocal: string;
  gateCheckMode: GateCheckMode;
  /** A custom geofence, or null to use the project's site location. */
  boundary: SiteBoundary | null;
  active: boolean;
  gates: Gate[];
  version: number;
}

export interface SiteInput {
  name: string;
  dayEndLocal: string;
  gateCheckMode: GateCheckMode;
  boundary?: SiteBoundary | null;
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

export type RollMark = 'unmarked' | 'accounted_for' | 'missing' | 'not_on_site';

export interface RollCallPerson {
  workerId: string;
  fullName: string;
  phone: string | null;
  companyId: string | null;
  companyNameOther: string | null;
  signedInAt: string | null;
  status: RollMark;
  markedAt: string | null;
}

/** An evacuation roll call (ATT-AC5): everyone on site when it started, ticked off until all are accounted for. */
export interface RollCall {
  id: string;
  siteId: string | null;
  reason: string;
  startedAt: string;
  endedAt: string | null;
  counts: { total: number; accountedFor: number; missing: number; unmarked: number };
  people: RollCallPerson[];
}

export const MARK_LABELS: Record<RollMark, string> = {
  unmarked: 'Not checked yet',
  accounted_for: 'Accounted for',
  missing: 'Missing',
  not_on_site: 'Not on site',
};

/** "30 of 42 accounted for · 2 missing · 10 to check" */
export function progressLabel(counts: RollCall['counts']): string {
  const parts = [`${counts.accountedFor} of ${counts.total} accounted for`];
  if (counts.missing > 0) parts.push(`${counts.missing} missing`);
  if (counts.unmarked > 0) parts.push(`${counts.unmarked} to check`);
  return parts.join(' · ');
}

/** People grouped by company in the order sent (the server sorts by company, then name). */
export function groupByCompany<
  T extends { companyId: string | null; companyNameOther: string | null },
>(
  people: readonly T[],
  companyName: (id: string) => string,
): Array<{ company: string; people: T[] }> {
  const groups: Array<{ company: string; people: T[] }> = [];
  for (const p of people) {
    const company = p.companyId ? companyName(p.companyId) : (p.companyNameOther ?? 'No company');
    const last = groups[groups.length - 1];
    if (last && last.company === company) last.people.push(p);
    else groups.push({ company, people: [p] });
  }
  return groups;
}

/** A worker, visitor or delivery driver known to the builder (ATT-AC2). */
export interface Worker {
  id: string;
  fullName: string;
  companyId: string | null;
  /** A company typed at the gate, waiting for a site manager to pick the directory company. */
  companyNameOther: string | null;
  phone: string | null;
  email: string | null;
  kind: WorkerKind;
  status: 'active' | 'inactive';
  version: number;
}

export interface WorkerFilters {
  companyId?: string;
  kind?: WorkerKind;
  q?: string;
}

export interface WorkerInput {
  fullName: string;
  /** A directory company, or `null` with `companyNameOther` for one that isn't in the directory. */
  companyId: string | null;
  companyNameOther: string | null;
  phone: string | null;
  email: string | null;
  kind: WorkerKind;
}
