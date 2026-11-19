import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';
import { uploadFile } from '@/shared/lib/uploads';
import type {
  ClaimStatus,
  Declaration,
  DeclarationInput,
  Flag,
  Issue,
  Reading,
  Requirement,
} from '../lib/types';
import type { DeclarationSource } from './source';

type S = components['schemas'];

const P = '/v1/orgs/{orgId}/projects/{projectId}/declarations' as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export const toDeclaration = (p: S['Declaration']): Declaration => ({
  id: p.id,
  numberLabel: p.numberLabel,
  companyId: p.companyId,
  kind: p.kind,
  declarantName: p.declarantName,
  declarantPosition: p.declarantPosition,
  declaredOn: p.declaredOn,
  validFrom: p.validFrom,
  validTo: p.validTo,
  issuer: p.issuer,
  referenceNumber: p.referenceNumber,
  claimId: p.claimId,
  lifecycle: p.lifecycle,
  status: p.status,
  daysToEnd: p.daysToEnd,
  notes: p.notes,
  readByNova: p.readByNova,
  version: p.version,
});

const toIssue = (i: S['DeclarationIssue']): Issue => ({
  kind: i.kind,
  level: i.level,
  declarationKind: i.declarationKind,
  message: i.message,
});

const toFlag = (f: S['DeclarationFlag']): Flag => ({
  kind: f.kind,
  severity: f.severity,
  companyId: f.companyId,
  title: f.title,
  detail: f.detail,
  declarationId: f.declarationId,
  declarationKind: f.declarationKind,
});

const toClaim = (c: S['DeclarationClaimStatus']): ClaimStatus => ({
  claimId: c.claimId,
  number: c.number,
  contractTitle: c.contractTitle,
  companyId: c.companyId,
  companyName: c.companyName,
  periodEnd: c.periodEnd,
  state: c.state,
  coveredByStatement: c.coveredByStatement,
  issues: c.issues.map(toIssue),
});

const toReading = (r: S['NovaDeclarationReading']): Reading => {
  const src = (f: S['NovaDeclarationField']) =>
    f.source ? `p.${f.source.page}: ${f.source.snippet}` : undefined;
  const sources: Reading['sources'] = {};
  for (const k of ['validFrom', 'validTo', 'declaredOn', 'referenceNumber'] as const) {
    const s = src(r[k]);
    if (s) sources[k] = s;
  }
  const warnings = [...r.warnings];
  if (r.scannedPages.length)
    warnings.push(`Pages ${r.scannedPages.join(', ')} were scanned. Check them against the PDF.`);
  if (r.skippedPages.length || r.truncated)
    warnings.push('Nova did not read every page. Check the PDF for the rest.');
  return {
    fileId: r.fileId,
    kind: r.kind,
    companyName: r.companyName.value,
    declarantName: r.declarantName.value,
    declarantPosition: r.declarantPosition.value,
    declaredOn: r.declaredOn.value,
    validFrom: r.validFrom.value,
    validTo: r.validTo.value,
    issuer: r.issuer.value,
    referenceNumber: r.referenceNumber.value,
    signed: r.signed,
    sources,
    warnings,
  };
};

/** The live source. Reads the first 100 items; filters are applied by the API. */
export function createDeclarationsApi(orgId: string): DeclarationSource {
  return {
    async list(projectId, f) {
      const r = unwrap(
        await api.GET(`${P}/statements`, {
          params: {
            path: { orgId, projectId },
            query: { kind: f.kind, companyId: f.companyId, status: f.status, limit: 100 },
          },
        }),
      );
      return r.data.map(toDeclaration);
    },
    async create(projectId, input: DeclarationInput) {
      return toDeclaration(
        unwrap(
          await api.POST(`${P}/statements`, {
            params: { path: { orgId, projectId }, header: idempotencyKey() },
            body: input,
          }),
        ).declaration,
      );
    },
    async update(projectId, d, input) {
      return toDeclaration(
        unwrap(
          await api.PATCH(`${P}/statements/{declarationId}`, {
            params: {
              path: { orgId, projectId, declarationId: d.id },
              header: ifMatch(d.version),
            },
            body: input,
          }),
        ).declaration,
      );
    },
    async transition(projectId, d, t) {
      return toDeclaration(
        unwrap(
          await api.POST(`${P}/statements/{declarationId}/transition`, {
            params: {
              path: { orgId, projectId, declarationId: d.id },
              header: ifMatch(d.version),
            },
            body: { action: t.action, ...(t.note ? { note: t.note } : {}) },
          }),
        ).declaration,
      );
    },
    async flags(projectId) {
      const r = unwrap(await api.GET(`${P}/flags`, { params: { path: { orgId, projectId } } }));
      return r.data.map(toFlag);
    },
    async claims(projectId) {
      const r = unwrap(await api.GET(`${P}/claims`, { params: { path: { orgId, projectId } } }));
      return { requirementsSet: r.requirementsSet, data: r.data.map(toClaim) };
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
    async chase(projectId, input) {
      const r = unwrap(
        await api.POST(`${P}/chases`, {
          params: { path: { orgId, projectId }, header: idempotencyKey() },
          body: input,
        }),
      );
      return { draft: r.draft, recipient: r.recipient, sent: r.sent };
    },
    async read(projectId, file) {
      const stored = await uploadFile(orgId, { file, projectId, module: 'declarations' });
      return toReading(
        unwrap(
          await api.POST('/v1/orgs/{orgId}/projects/{projectId}/ai/declaration-readings', {
            params: { path: { orgId, projectId } },
            body: { fileId: stored.id },
          }),
        ),
      );
    },
  };
}
