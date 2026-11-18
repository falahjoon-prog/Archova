import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';
import type { Permit, PermitFlag, PermitInput, Requirement } from '../lib/types';
import type { PermitSource } from './source';

type ApiPermit = components['schemas']['Permit'];
type ApiFlag = components['schemas']['PermitFlag'];

const P = '/v1/orgs/{orgId}/projects/{projectId}/permits' as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export const toPermit = (p: ApiPermit): Permit => ({
  id: p.id,
  numberLabel: p.numberLabel,
  kind: p.kind,
  title: p.title,
  issuingAuthority: p.issuingAuthority,
  referenceNumber: p.referenceNumber,
  holderCompanyId: p.holderCompanyId,
  issuedOn: p.issuedOn,
  expiresOn: p.expiresOn,
  status: p.status,
  daysToExpiry: p.daysToExpiry,
  notes: p.notes,
  version: p.version,
});

const toFlag = (f: ApiFlag): PermitFlag => ({
  kind: f.kind,
  severity: f.severity,
  title: f.title,
  detail: f.detail,
  permitId: f.permitId,
  permitKind: f.permitKind,
});

/** The live source. Reads the first 100 permits; filters are applied by the API. */
export function createPermitsApi(orgId: string): PermitSource {
  return {
    async list(projectId, f) {
      const r = unwrap(
        await api.GET(P, {
          params: {
            path: { orgId, projectId },
            query: { kind: f.kind, status: f.status, limit: 100 },
          },
        }),
      );
      return r.data.map(toPermit);
    },
    async create(projectId, input: PermitInput) {
      return toPermit(
        unwrap(
          await api.POST(P, {
            params: { path: { orgId, projectId }, header: idempotencyKey() },
            body: input,
          }),
        ).permit,
      );
    },
    async update(projectId, permit, input) {
      return toPermit(
        unwrap(
          await api.PATCH(`${P}/{permitId}`, {
            params: {
              path: { orgId, projectId, permitId: permit.id },
              header: ifMatch(permit.version),
            },
            body: input,
          }),
        ).permit,
      );
    },
    async transition(projectId, permit, t) {
      return toPermit(
        unwrap(
          await api.POST(`${P}/{permitId}/transition`, {
            params: {
              path: { orgId, projectId, permitId: permit.id },
              header: ifMatch(permit.version),
            },
            body: { action: t.action, ...(t.newExpiresOn ? { newExpiresOn: t.newExpiresOn } : {}) },
          }),
        ).permit,
      );
    },
    async flags(projectId) {
      const r = unwrap(await api.GET(`${P}/flags`, { params: { path: { orgId, projectId } } }));
      return r.data.map(toFlag);
    },
    async requirements(projectId) {
      const r = unwrap(
        await api.GET(`${P}/requirements`, { params: { path: { orgId, projectId } } }),
      );
      return r.data;
    },
    async setRequirements(projectId, items: Requirement[]) {
      const r = unwrap(
        await api.PUT(`${P}/requirements`, {
          params: { path: { orgId, projectId } },
          body: { items },
        }),
      );
      return r.data;
    },
  };
}
