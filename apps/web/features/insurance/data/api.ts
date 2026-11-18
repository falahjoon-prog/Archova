import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';
import type { Cover, CoverFlag, CoverInput, Requirement } from '../lib/types';
import type { CoverSource } from './source';

type ApiCover = components['schemas']['Cover'];
type ApiFlag = components['schemas']['CoverFlag'];

const P = '/v1/orgs/{orgId}/projects/{projectId}/insurance' as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export const toCover = (p: ApiCover): Cover => ({
  id: p.id,
  numberLabel: p.numberLabel,
  kind: p.kind,
  title: p.title,
  companyId: p.companyId,
  issuer: p.issuer,
  amountCents: p.amountCents,
  referenceNumber: p.referenceNumber,
  issuedOn: p.issuedOn,
  expiresOn: p.expiresOn,
  status: p.status,
  daysToExpiry: p.daysToExpiry,
  notes: p.notes,
  version: p.version,
});

const toFlag = (f: ApiFlag): CoverFlag => ({
  kind: f.kind,
  severity: f.severity,
  companyId: f.companyId,
  title: f.title,
  detail: f.detail,
  coverId: f.coverId,
  coverKind: f.coverKind,
});

/** The live source. Reads the first 100 items; filters are applied by the API. */
export function createInsuranceApi(orgId: string): CoverSource {
  return {
    async list(projectId, f) {
      const r = unwrap(
        await api.GET(`${P}/covers`, {
          params: {
            path: { orgId, projectId },
            query: { kind: f.kind, companyId: f.companyId, status: f.status, limit: 100 },
          },
        }),
      );
      return r.data.map(toCover);
    },
    async create(projectId, input: CoverInput) {
      return toCover(
        unwrap(
          await api.POST(`${P}/covers`, {
            params: { path: { orgId, projectId }, header: idempotencyKey() },
            body: input,
          }),
        ).cover,
      );
    },
    async update(projectId, cover, input) {
      return toCover(
        unwrap(
          await api.PATCH(`${P}/covers/{coverId}`, {
            params: {
              path: { orgId, projectId, coverId: cover.id },
              header: ifMatch(cover.version),
            },
            body: input,
          }),
        ).cover,
      );
    },
    async transition(projectId, cover, t) {
      return toCover(
        unwrap(
          await api.POST(`${P}/covers/{coverId}/transition`, {
            params: {
              path: { orgId, projectId, coverId: cover.id },
              header: ifMatch(cover.version),
            },
            body: { action: t.action, ...(t.newExpiresOn ? { newExpiresOn: t.newExpiresOn } : {}) },
          }),
        ).cover,
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
