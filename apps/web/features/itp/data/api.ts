// ITP packages against the documents module (document control). API only, like the review panel.

import { unwrap } from '@archova/api-client';
import type {
  ItpItemInput,
  ItpPackageDetail,
  ItpPackageSummary,
  ItpTemplate,
} from '@archova/contracts';
import { api, ensureCsrfToken } from '@/shared/lib/api';

type P = { orgId: string; projectId: string };
const pkg = (p: P, itpId: string) => ({ path: { ...p, itpId } });
const BASE = '/v1/orgs/{orgId}/projects/{projectId}/itp-packages';

export interface CreateItpInput {
  name: string;
  discipline: string | null;
  documentId: string | null;
  fromTemplate: boolean;
  items?: ItpItemInput[];
}

export function createItpApi(p: P) {
  return {
    async list(): Promise<ItpPackageSummary[]> {
      return unwrap(await api.GET(BASE, { params: { path: p, query: {} } })).data;
    },
    async get(itpId: string): Promise<ItpPackageDetail> {
      return unwrap(await api.GET(`${BASE}/{itpId}`, { params: pkg(p, itpId) }));
    },
    async create(body: CreateItpInput): Promise<ItpPackageDetail> {
      await ensureCsrfToken();
      return unwrap(await api.POST(BASE, { params: { path: p }, body }));
    },
    async activate(itpId: string): Promise<ItpPackageDetail> {
      await ensureCsrfToken();
      return unwrap(await api.POST(`${BASE}/{itpId}/activate`, { params: pkg(p, itpId) }));
    },
    async sign(
      itpId: string,
      itemId: string,
      body: { status: 'pending' | 'passed' | 'failed' | 'waived'; note: string | null },
    ): Promise<ItpPackageDetail> {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${BASE}/{itpId}/items/{itemId}/signoff`, {
          params: { path: { ...p, itpId, itemId } },
          body,
        }),
      );
    },
    async template(discipline: string): Promise<ItpTemplate> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/projects/{projectId}/itp-templates', {
          params: { path: p, query: { discipline } },
        }),
      );
    },
    /** The first page of documents, for the "tie to a document" picker. */
    async documents(): Promise<Array<{ id: string; label: string; status: string }>> {
      const res = unwrap(
        await api.GET('/v1/orgs/{orgId}/projects/{projectId}/documents', {
          params: { path: p, query: { limit: 200 } },
        }),
      );
      return res.data.map((d) => ({
        id: d.id,
        label: d.docNumber ? `${d.docNumber} ${d.title}` : d.title,
        status: d.status,
      }));
    },
  };
}

export type ItpApi = ReturnType<typeof createItpApi>;
