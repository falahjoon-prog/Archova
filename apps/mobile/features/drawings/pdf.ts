// While the server is still building tiles for a sheet, the phone can open the sheet's PDF instead.
import { unwrap, type ApiClient } from '@archova/api-client';

/** The PDF page fragment (1-based) that PDF viewers honour; the revision's `pageIndex` is 0-based. */
export function pdfPageUrl(url: string, pageIndex: number): string {
  const page = Math.max(0, Math.trunc(pageIndex)) + 1;
  return `${url.split('#')[0]}#page=${page}`;
}

/** A fresh short-lived link to the revision's file; never cached, it expires in minutes. */
export async function drawingPdfUrl(
  api: ApiClient,
  orgId: string,
  fileId: string,
  pageIndex: number,
): Promise<string> {
  const link = unwrap(
    await api.GET('/v1/orgs/{orgId}/files/{fileId}/download', {
      params: { path: { orgId, fileId } },
    }),
  );
  return pdfPageUrl(link.url, pageIndex);
}
