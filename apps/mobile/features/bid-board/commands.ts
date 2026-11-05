// The bid board on the phone: tender packages across the company's projects and the saved bidder lists, read only.
// Sending packages out, quoting and managing lists stay on the web. Staff only; the API refuses anyone else.
import { unwrap, type ApiClient } from '@archova/api-client';

export async function getBidBoard(api: ApiClient, orgId: string) {
  return unwrap(await api.GET('/v1/orgs/{orgId}/bid-board', { params: { path: { orgId } } }));
}

export async function listBidderLists(api: ApiClient, orgId: string) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/bidder-lists', { params: { path: { orgId }, query: {} } }),
  ).data;
}

/** Company names by id, to show who is on a list. A page is enough for a phone; missing names fall back to a count. */
export async function companyNames(api: ApiClient, orgId: string): Promise<Map<string, string>> {
  const page = unwrap(
    await api.GET('/v1/orgs/{orgId}/companies', {
      params: { path: { orgId }, query: { limit: 200 } },
    }),
  );
  return new Map(page.data.map((c) => [c.id, c.name]));
}
