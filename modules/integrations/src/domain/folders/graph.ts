import { createHash, createSign, randomUUID } from 'node:crypto';
import type { FetchLike } from '../accounting/http';
import { FolderProviderError, type FolderProvider } from './types';

// Microsoft 365 / SharePoint through Graph (integrations/03 §2). App-only access with `Sites.Selected`, so the customer's
// admin chooses which sites Archova can touch. The app proves itself with a certificate, never a client secret.
const GRAPH = 'https://graph.microsoft.com/v1.0';
const LOGIN = 'https://login.microsoftonline.com';
/** Simple upload up to 4 MB; larger files use an upload session in chunks of a multiple of 320 KiB. */
const SIMPLE_MAX = 4 * 1024 * 1024;
const CHUNK = 32 * 320 * 1024;

export interface M365Credentials {
  clientId: string;
  /** PEM private key matching the certificate registered on the Entra app. */
  privateKeyPem: string;
  /** SHA-256 thumbprint of that certificate, hex. */
  thumbprintHex: string;
}

export function adminConsentUrl(p: {
  tenantId: string;
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    state: p.state,
  });
  return `${LOGIN}/${encodeURIComponent(p.tenantId)}/adminconsent?${q}`;
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** The signed assertion Entra accepts in place of a client secret. */
export function clientAssertion(c: M365Credentials, tenantId: string, nowMs: number): string {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    'x5t#S256': b64u(Buffer.from(c.thumbprintHex, 'hex')),
  };
  const iat = Math.floor(nowMs / 1000);
  const payload = {
    aud: `${LOGIN}/${tenantId}/oauth2/v2.0/token`,
    iss: c.clientId,
    sub: c.clientId,
    jti: randomUUID(),
    nbf: iat,
    exp: iat + 600,
  };
  const body = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
  const sig = createSign('RSA-SHA256').update(body).sign(c.privateKeyPem);
  return `${body}.${b64u(sig)}`;
}

export async function appToken(
  fetchFn: FetchLike,
  c: M365Credentials,
  tenantId: string,
  now: () => number = Date.now,
): Promise<{ accessToken: string; expiresAt: number }> {
  const res = await fetchFn(`${LOGIN}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.clientId,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: clientAssertion(c, tenantId, now()),
    }).toString(),
  });
  if (!res.ok) throw await failure(res, true);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: j.access_token, expiresAt: now() + j.expires_in * 1000 };
}

async function failure(res: Response, tokenCall = false): Promise<FolderProviderError> {
  const body = (await res.text().catch(() => '')).slice(0, 300);
  const kind =
    tokenCall || res.status === 401 || res.status === 403
      ? 'auth'
      : res.status === 404
        ? 'missing'
        : 'other';
  const retryable = res.status === 429 || res.status >= 500;
  return new FolderProviderError(
    'm365',
    res.status,
    kind,
    retryable,
    `m365 ${res.status}: ${body}`,
  );
}

const item = (drive: string, id: string) =>
  `${GRAPH}/drives/${encodeURIComponent(drive)}/items/${encodeURIComponent(id)}`;

export function createGraphProvider(
  token: () => Promise<string>,
  fetchFn: FetchLike,
): FolderProvider {
  async function call(url: string, init: RequestInit = {}, authed = true): Promise<Response> {
    const headers = new Headers(init.headers);
    if (authed) headers.set('Authorization', `Bearer ${await token()}`);
    const res = await fetchFn(url, { ...init, headers });
    // `Retry-After` is honoured by the caller's retry (the dispatcher), so a throttled call just fails as retryable.
    return res;
  }
  async function json<T>(res: Response): Promise<T> {
    if (!res.ok) throw await failure(res);
    return (await res.json()) as T;
  }

  return {
    async resolveTarget({ url }) {
      if (!url || !/^https:\/\//i.test(url))
        throw new FolderProviderError(
          'm365',
          400,
          'bad_target',
          false,
          'Paste the SharePoint folder address.',
        );
      const shareId = `u!${Buffer.from(url).toString('base64url')}`;
      const res = await call(
        `${GRAPH}/shares/${shareId}/driveItem?$select=id,name,webUrl,folder,parentReference`,
      );
      if (res.status === 404 || res.status === 403)
        throw new FolderProviderError(
          'm365',
          res.status,
          'bad_target',
          false,
          'Archova cannot open that folder. Check the address, and that the site has been granted to Archova.',
        );
      const it = await json<{
        id: string;
        name: string;
        webUrl?: string;
        folder?: unknown;
        parentReference?: { driveId?: string };
      }>(res);
      if (!it.folder || !it.parentReference?.driveId)
        throw new FolderProviderError(
          'm365',
          400,
          'bad_target',
          false,
          'That address is not a folder.',
        );
      return {
        driveId: it.parentReference.driveId,
        folderId: it.id,
        name: it.name,
        webUrl: it.webUrl ?? null,
      };
    },

    async ensureSubfolder(parent, name) {
      const drive = parent.driveId!;
      const make = await call(`${item(drive, parent.folderId)}/children`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'fail',
        }),
      });
      if (make.status === 409) {
        const found = await call(
          `${item(drive, parent.folderId)}:/${encodeURIComponent(name)}?$select=id`,
        );
        return { folderId: (await json<{ id: string }>(found)).id };
      }
      return { folderId: (await json<{ id: string }>(make)).id };
    },

    async uploadFile(parent, file) {
      const drive = parent.driveId!;
      const base = `${item(drive, parent.folderId)}:/${encodeURIComponent(file.name)}:`;
      if (file.bytes.byteLength <= SIMPLE_MAX) {
        const res = await call(`${base}/content?@microsoft.graph.conflictBehavior=replace`, {
          method: 'PUT',
          headers: { 'Content-Type': file.contentType },
          body: file.bytes as unknown as RequestInit['body'],
        });
        const r = await json<{ id: string; webUrl?: string }>(res);
        return { remoteId: r.id, webUrl: r.webUrl ?? null };
      }
      const session = await json<{ uploadUrl: string }>(
        await call(`${base}/createUploadSession`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
        }),
      );
      const total = file.bytes.byteLength;
      for (let start = 0; start < total; start += CHUNK) {
        const end = Math.min(start + CHUNK, total);
        // The upload URL is pre-authorised: it must not carry our bearer token.
        const res = await call(
          session.uploadUrl,
          {
            method: 'PUT',
            headers: {
              'Content-Length': String(end - start),
              'Content-Range': `bytes ${start}-${end - 1}/${total}`,
            },
            body: file.bytes.subarray(start, end) as unknown as RequestInit['body'],
          },
          false,
        );
        if (end === total) {
          const r = await json<{ id: string; webUrl?: string }>(res);
          return { remoteId: r.id, webUrl: r.webUrl ?? null };
        }
        if (res.status !== 202) throw await failure(res);
      }
      throw new FolderProviderError('m365', 500, 'other', true, 'Upload ended early');
    },

    async moveFile(drive, remoteId, _from, toFolderId) {
      const res = await call(item(drive!, remoteId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentReference: { id: toFolderId },
          '@microsoft.graph.conflictBehavior': 'replace',
        }),
      });
      await json(res);
    },
  };
}

/** Thumbprint helper for ops: the hex SHA-256 of a DER certificate. */
export const certThumbprintHex = (der: Buffer) => createHash('sha256').update(der).digest('hex');
