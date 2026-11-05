// Reusable bidder lists (estimating module): named sets of companies, kept at company level.
import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

export type BidderList = components['schemas']['BidderList'];
export interface BidderListInput {
  name: string;
  trade: string;
  companyIds: string[];
}

const L = '/v1/orgs/{orgId}/bidder-lists' as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function createBiddersApi(orgId: string) {
  return {
    async list(): Promise<BidderList[]> {
      return unwrap(await api.GET(L, { params: { path: { orgId }, query: {} } })).data;
    },
    async create(body: BidderListInput): Promise<BidderList> {
      return unwrap(
        await api.POST(L, { params: { path: { orgId }, header: idempotencyKey() }, body }),
      );
    },
    async update(list: BidderList, body: BidderListInput): Promise<BidderList> {
      return unwrap(
        await api.PATCH(`${L}/{bidderListId}`, {
          params: { path: { orgId, bidderListId: list.id }, header: ifMatch(list.version) },
          body,
        }),
      );
    },
    async remove(list: BidderList): Promise<void> {
      unwrap(
        await api.DELETE(`${L}/{bidderListId}`, {
          params: { path: { orgId, bidderListId: list.id } },
        }),
      );
    },
  };
}
