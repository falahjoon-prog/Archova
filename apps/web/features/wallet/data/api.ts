// Compliance wallet (workforce module): the company's own insurance, licence and card documents (compliance/05).

import { unwrap } from '@archova/api-client';
import { api } from '@/shared/lib/api';
import { uploadFile } from '@/shared/lib/uploads';
import type { ComplianceDocument, ExpiryAlert, ItemType } from '../lib/types';
import type { components } from '@archova/contracts/openapi';

type S = components['schemas'];
export type CreateDocument = S['CreateComplianceDocumentRequest'];
export type UpdateDocument = S['UpdateComplianceDocumentRequest'];

const P = '/v1/orgs/{orgId}/compliance-documents' as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function createWalletApi(orgId: string) {
  return {
    async list(f: {
      itemType?: ItemType;
      includeArchived: boolean;
    }): Promise<ComplianceDocument[]> {
      return unwrap(
        await api.GET(P, {
          params: {
            path: { orgId },
            query: {
              ...(f.itemType ? { itemType: f.itemType } : {}),
              ...(f.includeArchived ? { includeArchived: 'true' as const } : {}),
            },
          },
        }),
      ).data;
    },
    async alerts(): Promise<ExpiryAlert[]> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/compliance-document-alerts', {
          params: { path: { orgId } },
        }),
      ).data;
    },
    async create(body: CreateDocument): Promise<ComplianceDocument> {
      return unwrap(
        await api.POST(P, { params: { path: { orgId }, header: idempotencyKey() }, body }),
      );
    },
    async update(doc: ComplianceDocument, body: UpdateDocument): Promise<ComplianceDocument> {
      return unwrap(
        await api.PATCH(`${P}/{documentId}`, {
          params: { path: { orgId, documentId: doc.id }, header: ifMatch(doc.version) },
          body,
        }),
      );
    },
    async sight(doc: ComplianceDocument): Promise<ComplianceDocument> {
      return unwrap(
        await api.POST(`${P}/{documentId}/sight`, {
          params: { path: { orgId, documentId: doc.id }, header: ifMatch(doc.version) },
        }),
      );
    },
    /** Wallet files are organisation files, not a project's (no project id). */
    async upload(file: File): Promise<string> {
      return (await uploadFile(orgId, { file, module: 'workforce' })).id;
    },
  };
}
