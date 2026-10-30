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
  'rollCalls' | 'startRollCall' | 'markRollCall' | 'endRollCall'
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
};

export function resetRollCallPreview() {
  rollStores.reset();
}

export const attendancePreview: AttendanceSource = { ...entryReads, ...siteOps, ...rollOps };
