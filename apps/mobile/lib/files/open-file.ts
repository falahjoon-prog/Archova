// Opens a stored file in the system viewer through a fresh short-lived link (5 minutes), never cached.
import * as WebBrowser from 'expo-web-browser';
import { unwrap, type ApiClient } from '@archova/api-client';

/** `page` is 1-based; PDF viewers honour the `#page=` fragment. */
export function withPage(url: string, page?: number): string {
  if (!page || page < 1) return url;
  return `${url.split('#')[0]}#page=${Math.trunc(page)}`;
}

export async function openOrgFile(
  api: ApiClient,
  orgId: string,
  fileId: string,
  page?: number,
): Promise<void> {
  const link = unwrap(
    await api.GET('/v1/orgs/{orgId}/files/{fileId}/download', {
      params: { path: { orgId, fileId } },
    }),
  );
  await WebBrowser.openBrowserAsync(withPage(link.url, page));
}
