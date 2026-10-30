import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';
import type { AttendanceEntry, AttendanceSite, Gate, OnSite } from '../lib/types';
import type { AttendanceSource } from './source';

type ApiEntry = components['schemas']['AttendanceEntry'];
type ApiSite = components['schemas']['AttendanceSite'];
type ApiGate = components['schemas']['Gate'];

const P = '/v1/orgs/{orgId}/projects/{projectId}/attendance' as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });

export const toGate = (g: ApiGate): Gate => ({
  id: g.id,
  siteId: g.siteId,
  name: g.name,
  active: g.active,
  qrVersion: g.qrVersion,
  version: g.version,
});

export const toSite = (s: ApiSite): AttendanceSite => ({
  id: s.id,
  name: s.name,
  dayEndLocal: s.dayEndLocal,
  gateCheckMode: s.gateCheckMode,
  active: s.active,
  gates: s.gates.map(toGate),
  version: s.version,
});

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
    async sites(projectId) {
      const r = unwrap(await api.GET(`${P}/sites`, { params: { path: { orgId, projectId } } }));
      return r.data.map(toSite);
    },
    async createSite(projectId, input) {
      return toSite(
        unwrap(
          await api.POST(`${P}/sites`, {
            params: {
              path: { orgId, projectId },
              header: { 'Idempotency-Key': crypto.randomUUID() },
            },
            body: input,
          }),
        ),
      );
    },
    async updateSite(projectId, site, patch) {
      return toSite(
        unwrap(
          await api.PATCH(`${P}/sites/{siteId}`, {
            params: { path: { orgId, projectId, siteId: site.id }, header: ifMatch(site.version) },
            body: patch,
          }),
        ),
      );
    },
    async createGate(projectId, siteId, name) {
      const r = unwrap(
        await api.POST(`${P}/sites/{siteId}/gates`, {
          params: {
            path: { orgId, projectId, siteId },
            header: { 'Idempotency-Key': crypto.randomUUID() },
          },
          body: { name },
        }),
      );
      return { gate: toGate(r.gate), code: r.code };
    },
    async updateGate(projectId, gate, patch) {
      return toGate(
        unwrap(
          await api.PATCH(`${P}/gates/{gateId}`, {
            params: { path: { orgId, projectId, gateId: gate.id }, header: ifMatch(gate.version) },
            body: patch,
          }),
        ),
      );
    },
    async reissueGate(projectId, gate) {
      const r = unwrap(
        await api.POST(`${P}/gates/{gateId}/reissue`, {
          params: { path: { orgId, projectId, gateId: gate.id }, header: ifMatch(gate.version) },
        }),
      );
      return { gate: toGate(r.gate), code: r.code };
    },
  };
}
