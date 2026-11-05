// The bid board on the phone: tender packages across the company's projects and the saved bidder lists, read only.
// Sending packages out, quoting and managing lists stay on the web. Staff only; the API refuses anyone else.
import { unwrap, type ApiClient } from '@archova/api-client';
import type { QuoteBody } from './quoting';

export async function getBidBoard(api: ApiClient, orgId: string) {
  return unwrap(await api.GET('/v1/orgs/{orgId}/bid-board', { params: { path: { orgId } } }));
}

export async function listBidderLists(api: ApiClient, orgId: string) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/bidder-lists', { params: { path: { orgId }, query: {} } }),
  ).data;
}

type PackageTarget = { orgId: string; projectId: string; packageId: string };
const pkgPath = '/v1/orgs/{orgId}/projects/{projectId}/tender-packages' as const;

/** The packages on a project this person can see; a subcontractor sees the ones they were invited to. */
export async function listProjectPackages(api: ApiClient, t: { orgId: string; projectId: string }) {
  return unwrap(
    await api.GET(pkgPath, {
      params: { path: { orgId: t.orgId, projectId: t.projectId }, query: {} },
    }),
  ).data;
}

export async function getProjectPackage(api: ApiClient, t: PackageTarget) {
  return unwrap(
    await api.GET(`${pkgPath}/{packageId}`, {
      params: { path: { orgId: t.orgId, projectId: t.projectId, packageId: t.packageId } },
    }),
  );
}

/** The caller's own quotes on the package; the API shows a subcontractor no one else's. */
export async function listMyQuotes(api: ApiClient, t: PackageTarget) {
  return unwrap(
    await api.GET(`${pkgPath}/{packageId}/quotes`, {
      params: { path: { orgId: t.orgId, projectId: t.projectId, packageId: t.packageId } },
    }),
  ).data;
}

/** A new quote, or a revision that supersedes the company's earlier one. The key is made once per press. */
export async function submitQuote(
  api: ApiClient,
  t: PackageTarget,
  input: { body: QuoteBody; idempotencyKey: string },
) {
  return unwrap(
    await api.POST(`${pkgPath}/{packageId}/quotes`, {
      params: {
        path: { orgId: t.orgId, projectId: t.projectId, packageId: t.packageId },
        header: { 'Idempotency-Key': input.idempotencyKey },
      },
      body: input.body,
    }),
  );
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
