// Data export (exports): a full zip of everything the company holds, built in the background.

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type DataExport = S['DataExport'];
export type DataExportList = S['DataExportList'];
export type DataExportDownload = S['DataExportDownload'];

export function createDataExportApi(orgId: string) {
  const path = { orgId };
  return {
    async list(): Promise<DataExportList> {
      return unwrap(await api.GET('/v1/orgs/{orgId}/data-exports', { params: { path } }));
    },
    async create(): Promise<DataExport> {
      return unwrap(await api.POST('/v1/orgs/{orgId}/data-exports', { params: { path } }));
    },
    async download(exportId: string): Promise<DataExportDownload> {
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/data-exports/{exportId}/download', {
          params: { path: { orgId, exportId } },
        }),
      );
    },
  };
}
