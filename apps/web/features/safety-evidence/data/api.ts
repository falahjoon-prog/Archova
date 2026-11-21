import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

export type SafetyEvidencePack = components['schemas']['SafetyEvidencePack'];
export type EvidenceGap = components['schemas']['EvidencePackGap'];
export interface Range {
  from: string;
  to: string;
}

export function createEvidenceApi(orgId: string, projectId: string) {
  const path = { orgId, projectId };
  return {
    async pack(range: Range): Promise<SafetyEvidencePack> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/projects/{projectId}/safety-evidence-pack', {
          params: { path, query: range },
        }),
      );
    },
    async pdf(range: Range): Promise<File> {
      const r = unwrap(
        await api.GET('/v1/orgs/{orgId}/projects/{projectId}/safety-evidence-pack/pdf', {
          params: { path, query: range },
        }),
      );
      const bytes = Uint8Array.from(atob(r.dataBase64), (c) => c.charCodeAt(0));
      return new File([bytes], r.filename, { type: r.contentType });
    },
  };
}
