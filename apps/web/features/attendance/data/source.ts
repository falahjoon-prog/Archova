// Attendance reads against `GET {p}/attendance/on-site` and `GET {p}/attendance/sessions?date=` (workforce module).
// Preview: a small in-memory day so the screen can be reviewed without an API.

import { delay } from '@/shared/mocks/runtime';
import type { AttendanceEntry, OnSite } from '../lib/types';

export interface AttendanceSource {
  /** Who is on site now, by company. */
  onSite(projectId: string): Promise<OnSite>;
  /** A day's sign-in records for a project-local date, optionally for one company. */
  day(projectId: string, date: string, companyId?: string): Promise<AttendanceEntry[]>;
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

export const attendancePreview: AttendanceSource = {
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
