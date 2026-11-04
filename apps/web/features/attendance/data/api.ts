import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';
import type { AttendanceEntry, AttendanceSite, Gate, OnSite, RollCall, Worker } from '../lib/types';
import type { AttendanceSource } from './source';

type ApiEntry = components['schemas']['AttendanceEntry'];
type ApiSite = components['schemas']['AttendanceSite'];
type ApiGate = components['schemas']['Gate'];
type ApiRollCall = components['schemas']['RollCall'];
type ApiWorker = components['schemas']['Worker'];

export const toWorker = (w: ApiWorker): Worker => ({
  id: w.id,
  fullName: w.fullName,
  companyId: w.companyId,
  companyNameOther: w.companyNameOther,
  phone: w.phone,
  email: w.email,
  kind: w.kind,
  status: w.status,
  version: w.version,
});

export const toRollCall = (r: ApiRollCall): RollCall => ({
  id: r.id,
  siteId: r.siteId,
  reason: r.reason,
  startedAt: r.startedAt,
  endedAt: r.endedAt,
  counts: r.counts,
  people: r.people.map((p) => ({
    workerId: p.workerId,
    fullName: p.fullName,
    phone: p.phone,
    companyId: p.companyId,
    companyNameOther: p.companyNameOther,
    signedInAt: p.signedInAt,
    status: p.status,
    markedAt: p.markedAt,
  })),
});

const P = '/v1/orgs/{orgId}/projects/{projectId}/attendance' as const;
const W = '/v1/orgs/{orgId}/projects/{projectId}/workers' as const;
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
  boundary: s.boundary ?? null,
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
    async rollCalls(projectId) {
      const r = unwrap(
        await api.GET(`${P}/roll-calls`, { params: { path: { orgId, projectId } } }),
      );
      return r.data.map(toRollCall);
    },
    async startRollCall(projectId, input) {
      return toRollCall(
        unwrap(
          await api.POST(`${P}/roll-calls`, {
            params: {
              path: { orgId, projectId },
              header: { 'Idempotency-Key': crypto.randomUUID() },
            },
            body: input,
          }),
        ),
      );
    },
    async markRollCall(projectId, rollCallId, workerId, status) {
      return toRollCall(
        unwrap(
          await api.POST(`${P}/roll-calls/{rollCallId}/marks`, {
            params: { path: { orgId, projectId, rollCallId } },
            body: { workerId, status },
          }),
        ),
      );
    },
    async endRollCall(projectId, rollCallId) {
      return toRollCall(
        unwrap(
          await api.POST(`${P}/roll-calls/{rollCallId}/end`, {
            params: { path: { orgId, projectId, rollCallId } },
          }),
        ),
      );
    },
    async workers(projectId, f) {
      const r = unwrap(
        await api.GET(W, {
          params: {
            path: { orgId, projectId },
            query: { companyId: f.companyId, kind: f.kind, q: f.q },
          },
        }),
      );
      return r.data.map(toWorker);
    },
    async createWorker(projectId, input) {
      // Empty optional fields are left out; the create request has no use for explicit nulls.
      const body = {
        fullName: input.fullName,
        kind: input.kind,
        ...(input.companyId ? { companyId: input.companyId } : {}),
        ...(!input.companyId && input.companyNameOther
          ? { companyNameOther: input.companyNameOther }
          : {}),
        ...(input.phone ? { phone: input.phone } : {}),
        ...(input.email ? { email: input.email } : {}),
      };
      return toWorker(
        unwrap(
          await api.POST(W, {
            params: {
              path: { orgId, projectId },
              header: { 'Idempotency-Key': crypto.randomUUID() },
            },
            body,
          }),
        ),
      );
    },
    async updateWorker(projectId, worker, patch) {
      return toWorker(
        unwrap(
          await api.PATCH(`${W}/{workerId}`, {
            params: {
              path: { orgId, projectId, workerId: worker.id },
              header: ifMatch(worker.version),
            },
            body: patch,
          }),
        ),
      );
    },
  };
}
