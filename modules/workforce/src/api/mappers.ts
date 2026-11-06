import { encodeId } from '@archova/domain';
import type { BadgeView } from '../application/badge';
import type {
  AttendanceEntry,
  AttendanceSession,
  AttendanceSite,
  EligibilityCheck,
  Gate,
  RollCall,
  SafetyBadge,
  SignInResult,
  Worker,
} from '@archova/contracts';
import type {
  CheckRow,
  GateRow,
  MarkRow,
  OnSiteEntry,
  RollCallRow,
  SessionRow,
  SiteRow,
  Viewer,
  WorkerRow,
} from '../application/attendance';

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const company = (id: string | null) => (id ? encodeId('company', id) : null);
const user = (id: string | null) => (id ? encodeId('user', id) : null);

export const toGateDto = (g: GateRow): Gate => ({
  id: encodeId('gate', g.id),
  siteId: encodeId('workforceSite', g.siteId),
  name: g.name,
  qrVersion: g.qrVersion,
  active: g.active,
  version: g.version,
});

export const toSiteDto = (s: SiteRow, gates: GateRow[]): AttendanceSite => ({
  id: encodeId('workforceSite', s.id),
  projectId: encodeId('project', s.projectId),
  name: s.name,
  boundary:
    s.boundaryMode === 'custom' && s.lat !== null && s.lng !== null && s.radiusM !== null
      ? { lat: s.lat, lng: s.lng, radiusM: s.radiusM }
      : null,
  dayEndLocal: s.dayEndLocal.slice(0, 5),
  gateCheckMode: s.gateCheckMode,
  active: s.active,
  gates: gates.map(toGateDto),
  version: s.version,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

/** Phone and email go to site managers, people allowed personal details, and the worker's own company. */
export function toWorkerDto(w: WorkerRow, v: Viewer | null): Worker {
  const personal =
    !v ||
    v.canManage ||
    v.canSeePersonal ||
    (v.scopedCompanyId !== null && v.scopedCompanyId === w.companyId);
  return {
    id: encodeId('worker', w.id),
    userId: user(w.userId),
    companyId: company(w.companyId),
    companyNameOther: w.companyNameOther,
    fullName: w.fullName,
    phone: personal ? w.phone : null,
    email: personal ? w.email : null,
    kind: w.kind,
    status: w.status,
    version: w.version,
  };
}

export const toSessionDto = (s: SessionRow): AttendanceSession => ({
  id: encodeId('attendanceSession', s.id),
  projectId: encodeId('project', s.projectId),
  siteId: encodeId('workforceSite', s.siteId),
  workerId: encodeId('worker', s.workerId),
  companyId: company(s.companyId),
  localDate: s.localDate,
  signedInAt: s.signedInAt.toISOString(),
  signedOutAt: iso(s.signedOutAt),
  minutes: s.minutes,
  status: s.status,
  version: s.version,
});

export const toEntryDto = (e: OnSiteEntry, v: Viewer): AttendanceEntry => ({
  session: toSessionDto(e.session),
  worker: toWorkerDto(e.worker, v),
});

export const toCheckDto = (c: CheckRow): EligibilityCheck => ({
  id: encodeId('eligibilityCheck', c.id),
  result: c.result,
  answeredBy: c.answeredBy,
  reasons: c.reasons,
  checkedAt: c.checkedAt.toISOString(),
});

export const toSignInDto = (
  r: {
    outcome: SignInResult['outcome'];
    check: CheckRow | null;
    session: SessionRow | null;
    worker: WorkerRow;
  },
  v: Viewer | null,
): SignInResult => ({
  outcome: r.outcome,
  eligibility: r.check ? toCheckDto(r.check) : null,
  session: r.session ? toSessionDto(r.session) : null,
  worker: toWorkerDto(r.worker, v),
});

export function toRollCallDto(call: RollCallRow, marks: MarkRow[]): RollCall {
  const latest = new Map<string, MarkRow>();
  for (const m of marks) latest.set(m.workerId, m);
  const people = call.snapshot.map((p) => ({ ...p, signedInAt: p.signedInAt as string | null }));
  for (const m of marks)
    if (!people.some((p) => p.workerId === m.workerId))
      people.push({
        workerId: m.workerId,
        fullName: '',
        phone: null,
        companyId: null,
        companyNameOther: null,
        siteId: '',
        signedInAt: null,
      });
  const out = people
    .map((p) => {
      const m = latest.get(p.workerId);
      return {
        workerId: encodeId('worker', p.workerId),
        fullName: p.fullName,
        phone: p.phone,
        companyId: company(p.companyId),
        companyNameOther: p.companyNameOther,
        siteId: p.siteId ? encodeId('workforceSite', p.siteId) : null,
        signedInAt: p.signedInAt,
        status: m?.status ?? ('unmarked' as const),
        markedAt: iso(m?.markedAt ?? null),
        markedBy: user(m?.markedBy ?? null),
        sortCompany: p.companyId ?? p.companyNameOther ?? '',
      };
    })
    .sort(
      (a, b) => a.sortCompany.localeCompare(b.sortCompany) || a.fullName.localeCompare(b.fullName),
    )
    .map(({ sortCompany: _sortCompany, ...p }) => p);
  return {
    id: encodeId('rollCall', call.id),
    projectId: encodeId('project', call.projectId),
    siteId: call.siteId ? encodeId('workforceSite', call.siteId) : null,
    reason: call.reason,
    startedAt: call.startedAt.toISOString(),
    startedBy: user(call.startedBy),
    endedAt: iso(call.endedAt),
    counts: {
      total: out.length,
      accountedFor: out.filter((p) => p.status === 'accounted_for').length,
      missing: out.filter((p) => p.status === 'missing').length,
      unmarked: out.filter((p) => p.status === 'unmarked').length,
    },
    people: out,
  };
}

export function toSafetyBadgeDto(b: BadgeView): SafetyBadge {
  const id = encodeId('worker', b.worker.id);
  return {
    workerId: id,
    fullName: b.worker.fullName,
    companyName: b.companyName,
    status: b.worker.status,
    qrValue: `archova:badge:${id}`,
    photoUrl: b.photo?.url ?? null,
    emergencyContact: b.worker.emergencyContact,
    credentials: b.credentials,
    inductions: b.inductions.map((i) => ({
      title: i.title,
      completedAt: i.completedAt.toISOString(),
      expiresOn: i.expiresOn,
    })),
  };
}
