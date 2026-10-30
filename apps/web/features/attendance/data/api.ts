import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';
import type { AttendanceEntry, OnSite } from '../lib/types';
import type { AttendanceSource } from './source';

type ApiEntry = components['schemas']['AttendanceEntry'];

export function toEntry(e: ApiEntry): AttendanceEntry {
  const s = e.session;
  return {
    id: s.id,
    siteId: s.siteId,
    workerName: e.worker.fullName,
    kind: e.worker.kind,
    // The session's company is the one the worker signed in under; fall back to what the worker record says.
    companyId: s.companyId ?? e.worker.companyId ?? null,
    companyNameOther: e.worker.companyNameOther ?? null,
    localDate: s.localDate,
    signedInAt: s.signedInAt,
    signedOutAt: s.signedOutAt,
    minutes: s.minutes,
    status: s.status,
  };
}

export function createAttendanceApi(orgId: string): AttendanceSource {
  return {
    async onSite(projectId) {
      const r = unwrap(
        await api.GET('/v1/orgs/{orgId}/projects/{projectId}/attendance/on-site', {
          params: { path: { orgId, projectId } },
        }),
      );
      const out: OnSite = {
        total: r.total,
        companies: r.companies,
        people: r.people.map(toEntry),
      };
      return out;
    },
    async day(projectId, date, companyId) {
      const r = unwrap(
        await api.GET('/v1/orgs/{orgId}/projects/{projectId}/attendance/sessions', {
          params: { path: { orgId, projectId }, query: { date, companyId } },
        }),
      );
      return r.data.map(toEntry);
    },
  };
}
