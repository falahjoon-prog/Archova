// Attendance reads against `GET {p}/attendance/on-site` and `GET {p}/attendance/sessions?date=` (workforce module).
// Preview: a small in-memory day so the screen can be reviewed without an API.

import { delay, mockId, projectStores } from '@/shared/mocks/runtime';
import type {
  AttendanceEntry,
  AttendanceSite,
  Gate,
  GateWithCode,
  OnSite,
  RollCall,
  RollMark,
  SiteInput,
  Worker,
  WorkerFilters,
  WorkerInput,
} from '../lib/types';

export interface AttendanceSource {
  /** Who is on site now, by company. */
  onSite(projectId: string): Promise<OnSite>;
  /** A day's sign-in records for a project-local date, optionally for one company. */
  day(projectId: string, date: string, companyId?: string): Promise<AttendanceEntry[]>;
  /** Sites with their gates. */
  sites(projectId: string): Promise<AttendanceSite[]>;
  createSite(projectId: string, input: SiteInput): Promise<AttendanceSite>;
  updateSite(
    projectId: string,
    site: AttendanceSite,
    patch: Partial<SiteInput> & { active?: boolean },
  ): Promise<AttendanceSite>;
  createGate(projectId: string, siteId: string, name: string): Promise<GateWithCode>;
  updateGate(
    projectId: string,
    gate: Gate,
    patch: { name?: string; active?: boolean },
  ): Promise<Gate>;
  reissueGate(projectId: string, gate: Gate): Promise<GateWithCode>;
  /** Roll calls, newest first (at most 20). */
  rollCalls(projectId: string): Promise<RollCall[]>;
  startRollCall(projectId: string, input: { reason: string; siteId?: string }): Promise<RollCall>;
  markRollCall(
    projectId: string,
    rollCallId: string,
    workerId: string,
    status: Exclude<RollMark, 'unmarked'>,
  ): Promise<RollCall>;
  endRollCall(projectId: string, rollCallId: string): Promise<RollCall>;
  /** One tap: everyone not yet ticked is accounted for, and the roll call ends. Refused while anyone is missing. */
  allClearRollCall(projectId: string, rollCallId: string): Promise<RollCall>;
  /** The compliance record as CSV: a summary, then every mark in order with who made it and when. */
  rollCallRecord(projectId: string, rollCallId: string): Promise<{ filename: string; csv: string }>;
  workers(projectId: string, filters: WorkerFilters): Promise<Worker[]>;
  createWorker(projectId: string, input: WorkerInput): Promise<Worker>;
  /** Changes a worker; picking a directory company confirms one typed at the gate. */
  updateWorker(
    projectId: string,
    worker: Worker,
    patch: Partial<WorkerInput> & { status?: Worker['status'] },
  ): Promise<Worker>;
}

const entry = (over: Partial<AttendanceEntry> & Pick<AttendanceEntry, 'id' | 'workerName'>) =>
  ({
    siteId: 'wst_main',
    kind: 'worker',
    companyId: null,
    companyNameOther: null,
    localDate: '2026-10-01',
    signedInAt: '2026-09-30T20:45:00Z',
    signedOutAt: null,
    minutes: null,
    status: 'on_site',
    ...over,
  }) satisfies AttendanceEntry;

const SAMPLE: AttendanceEntry[] = [
  entry({ id: 'ats_1', workerName: 'Sam Nguyen', companyId: 'cmp_elec' }),
  entry({
    id: 'ats_2',
    workerName: 'Priya Rao',
    companyId: 'cmp_elec',
    signedInAt: '2026-09-30T21:10:00Z',
  }),
  entry({
    id: 'ats_3',
    workerName: 'Liam Ford',
    companyId: 'cmp_dry',
    signedInAt: '2026-09-30T20:30:00Z',
    signedOutAt: '2026-10-01T04:30:00Z',
    minutes: 480,
    status: 'off_site',
  }),
  entry({
    id: 'ats_4',
    workerName: 'Jo Tran',
    kind: 'delivery',
    companyNameOther: 'Hunter Concrete',
    signedInAt: '2026-09-30T22:00:00Z',
  }),
  entry({
    id: 'ats_5',
    workerName: 'Ben Cole',
    companyId: 'cmp_dry',
    signedInAt: '2026-09-30T20:20:00Z',
    signedOutAt: '2026-10-01T07:00:00Z',
    minutes: 640,
    status: 'auto_closed',
  }),
];

const entryReads: Pick<AttendanceSource, 'onSite' | 'day'> = {
  onSite() {
    const people = SAMPLE.filter((e) => e.status === 'on_site');
    const byCompany = new Map<string, OnSite['companies'][number]>();
    for (const p of people) {
      const key = p.companyId ?? `other:${p.companyNameOther}`;
      const hit = byCompany.get(key);
      if (hit) hit.count += 1;
      else
        byCompany.set(key, {
          companyId: p.companyId,
          companyNameOther: p.companyNameOther,
          count: 1,
        });
    }
    return delay({ total: people.length, companies: [...byCompany.values()], people });
  },
  day(_projectId, _date, companyId) {
    return delay(SAMPLE.filter((e) => !companyId || e.companyId === companyId));
  },
};

const stores = projectStores<AttendanceSite[]>(() => [
  {
    id: 'wst_main',
    name: 'Main site',
    dayEndLocal: '19:00',
    gateCheckMode: 'block',
    boundary: null,
    active: true,
    version: 1,
    gates: [
      {
        id: 'wgt_front',
        siteId: 'wst_main',
        name: 'Front gate',
        active: true,
        qrVersion: 1,
        version: 1,
      },
      {
        id: 'wgt_hoist',
        siteId: 'wst_main',
        name: 'Level 3 hoist',
        active: false,
        qrVersion: 2,
        version: 3,
      },
    ],
  },
]);

export function resetAttendancePreview() {
  stores.reset();
}

const previewCode = (gate: Gate) =>
  `gqr_preview${gate.id.slice(-6)}v${gate.qrVersion}${'x'.repeat(24)}`;

function findGate(projectId: string, id: string) {
  for (const site of stores.get(projectId)) {
    const gate = site.gates.find((g) => g.id === id);
    if (gate) return gate;
  }
  throw new Error('Gate not found');
}

const siteOps: Pick<
  AttendanceSource,
  'sites' | 'createSite' | 'updateSite' | 'createGate' | 'updateGate' | 'reissueGate'
> = {
  sites: (projectId) => delay(stores.get(projectId)),
  createSite: (projectId, input) => {
    const site: AttendanceSite = {
      id: mockId('wst'),
      active: true,
      gates: [],
      version: 1,
      ...input,
      boundary: input.boundary ?? null,
    };
    stores.get(projectId).push(site);
    return delay(site);
  },
  updateSite: (projectId, site, patch) => {
    const hit = stores.get(projectId).find((x) => x.id === site.id)!;
    Object.assign(hit, patch, { version: hit.version + 1 });
    return delay(hit);
  },
  createGate: (projectId, siteId, name) => {
    const site = stores.get(projectId).find((x) => x.id === siteId)!;
    const gate: Gate = { id: mockId('wgt'), siteId, name, active: true, qrVersion: 1, version: 1 };
    site.gates.push(gate);
    return delay({ gate, code: previewCode(gate) });
  },
  updateGate: (projectId, gate, patch) => {
    const hit = findGate(projectId, gate.id);
    Object.assign(hit, patch, { version: hit.version + 1 });
    return delay(hit);
  },
  reissueGate: (projectId, gate) => {
    const hit = findGate(projectId, gate.id);
    hit.qrVersion += 1;
    hit.version += 1;
    return delay({ gate: hit, code: previewCode(hit) });
  },
};

const rollStores = projectStores<RollCall[]>(() => []);

function recount(rc: RollCall) {
  const count = (st: RollCall['people'][number]['status']) =>
    rc.people.filter((p) => p.status === st).length;
  rc.counts = {
    total: rc.people.filter((p) => p.status !== 'not_on_site').length,
    accountedFor: count('accounted_for'),
    missing: count('missing'),
    unmarked: count('unmarked'),
  };
}

const rollOps: Pick<
  AttendanceSource,
  | 'rollCalls'
  | 'startRollCall'
  | 'markRollCall'
  | 'endRollCall'
  | 'allClearRollCall'
  | 'rollCallRecord'
> = {
  rollCalls: (projectId) => delay(rollStores.get(projectId)),
  startRollCall: (projectId, input) => {
    const people = SAMPLE.filter((e) => e.status === 'on_site').map((e) => ({
      workerId: `wkr_${e.id}`,
      fullName: e.workerName,
      phone: '0400 000 000',
      companyId: e.companyId,
      companyNameOther: e.companyNameOther,
      signedInAt: e.signedInAt,
      status: 'unmarked' as const,
      markedAt: null,
    }));
    const rc: RollCall = {
      id: mockId('rlc'),
      siteId: input.siteId ?? null,
      reason: input.reason,
      startedAt: new Date().toISOString(),
      endedAt: null,
      counts: { total: 0, accountedFor: 0, missing: 0, unmarked: 0 },
      people,
    };
    recount(rc);
    rollStores.get(projectId).unshift(rc);
    return delay(rc);
  },
  markRollCall: (projectId, rollCallId, workerId, status) => {
    const rc = rollStores.get(projectId).find((r) => r.id === rollCallId)!;
    const person = rc.people.find((p) => p.workerId === workerId)!;
    person.status = status;
    person.markedAt = new Date().toISOString();
    recount(rc);
    return delay(rc);
  },
  endRollCall: (projectId, rollCallId) => {
    const rc = rollStores.get(projectId).find((r) => r.id === rollCallId)!;
    rc.endedAt = new Date().toISOString();
    return delay(rc);
  },
  allClearRollCall: (projectId, rollCallId) => {
    const rc = rollStores.get(projectId).find((r) => r.id === rollCallId)!;
    if (rc.people.some((p) => p.status === 'missing'))
      return Promise.reject(new Error('Someone is marked missing.'));
    const at = new Date().toISOString();
    for (const p of rc.people)
      if (p.status === 'unmarked') {
        p.status = 'accounted_for';
        p.markedAt = at;
      }
    rc.endedAt = at;
    recount(rc);
    return delay(rc);
  },
  rollCallRecord: (projectId, rollCallId) => {
    const rc = rollStores.get(projectId).find((r) => r.id === rollCallId)!;
    const lines = rc.people.map((p) => `${p.markedAt ?? ''},mark,${p.fullName},${p.status}`);
    return delay({
      filename: 'roll-call.csv',
      csv: ['time,event,person,status', ...lines].join('\n'),
    });
  },
};

export function resetRollCallPreview() {
  rollStores.reset();
}

const workerStores = projectStores<Worker[]>(() => [
  {
    id: 'wkr_1',
    fullName: 'Sam Nguyen',
    companyId: 'cmp_elec',
    companyNameOther: null,
    phone: '0400 111 222',
    email: null,
    kind: 'worker',
    status: 'active',
    version: 1,
  },
  {
    id: 'wkr_2',
    fullName: 'Jo Tran',
    companyId: null,
    companyNameOther: 'Hunter Concrete',
    phone: '0400 333 444',
    email: null,
    kind: 'delivery',
    status: 'active',
    version: 1,
  },
  {
    id: 'wkr_3',
    fullName: 'Liam Ford',
    companyId: 'cmp_dry',
    companyNameOther: null,
    phone: null,
    email: 'liam@example.com',
    kind: 'worker',
    status: 'inactive',
    version: 2,
  },
]);

export function resetWorkerPreview() {
  workerStores.reset();
}

const workerOps: Pick<AttendanceSource, 'workers' | 'createWorker' | 'updateWorker'> = {
  workers: (projectId, f) => {
    const q = f.q?.toLowerCase();
    return delay(
      workerStores
        .get(projectId)
        .filter(
          (w) =>
            (!f.companyId || w.companyId === f.companyId) &&
            (!f.kind || w.kind === f.kind) &&
            (!q || w.fullName.toLowerCase().includes(q)),
        ),
    );
  },
  createWorker: (projectId, input) => {
    const w: Worker = { id: mockId('wkr'), status: 'active', version: 1, ...input };
    workerStores.get(projectId).push(w);
    return delay(w);
  },
  updateWorker: (projectId, worker, patch) => {
    const hit = workerStores.get(projectId).find((w) => w.id === worker.id)!;
    Object.assign(hit, patch, { version: hit.version + 1 });
    // A directory company replaces the name typed at the gate (ATT-AC2).
    if (patch.companyId) hit.companyNameOther = null;
    return delay(hit);
  },
};

export const attendancePreview: AttendanceSource = {
  ...entryReads,
  ...siteOps,
  ...rollOps,
  ...workerOps,
};
