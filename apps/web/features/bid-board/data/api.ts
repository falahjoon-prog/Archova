// The bid board (estimating module): tender packages across the company's projects.
import { unwrap } from '@archova/api-client';
import { api } from '@/shared/lib/api';
import type { BidBoardEntry, PackageStatus } from '../lib/types';

export function createBidBoardApi(orgId: string) {
  return {
    async board(f: {
      status?: PackageStatus;
      trade?: string;
    }): Promise<{ data: BidBoardEntry[]; truncated: boolean }> {
      const r = unwrap(
        await api.GET('/v1/orgs/{orgId}/bid-board', {
          params: {
            path: { orgId },
            query: {
              ...(f.status ? { status: f.status } : {}),
              ...(f.trade ? { trade: f.trade } : {}),
            },
          },
        }),
      );
      return { data: r.data, truncated: r.truncated };
    },
  };
}
