import { createHash, randomBytes } from 'node:crypto';
import type { FetchLike } from '../accounting/http';
import { FolderProviderError, type FolderProvider } from './types';

// Google Drive with the non-restricted `drive.file` scope (integrations/04 §1): Archova only ever sees the folder and
// files it created. Delegated user tokens; Google does not rotate refresh tokens.
const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
}
export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export function googleAuthorizeUrl(p: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  return `${AUTHORIZE}?${new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    scope: GOOGLE_SCOPE,
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    // Offline access with consent, or Google issues no refresh token on a repeat sign-in.
    access_type: 'offline',
    prompt: 'consent',
  })}`;
}

export const newGooglePkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

async function tokenCall(
  fetchFn: FetchLike,
  form: Record<string, string>,
  now: () => number,
  keepRefresh?: string,
): Promise<GoogleTokens> {
  const res = await fetchFn(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300);
    // invalid_grant: revoked or expired; never recovers on retry.
    throw new FolderProviderError(
      'google',
      res.status,
      'auth',
      res.status >= 500,
      `google ${res.status}: ${body}`,
    );
  }
  const j = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  const refreshToken = j.refresh_token ?? keepRefresh;
  if (!refreshToken)
    throw new FolderProviderError('google', 400, 'auth', false, 'google returned no refresh token');
  return { accessToken: j.access_token, refreshToken, expiresAt: now() + j.expires_in * 1000 };
}

export const googleExchangeCode = (
  fetchFn: FetchLike,
  c: GoogleCredentials,
  p: { code: string; redirectUri: string; verifier: string },
  now: () => number = Date.now,
) =>
  tokenCall(
    fetchFn,
    {
      grant_type: 'authorization_code',
      code: p.code,
      redirect_uri: p.redirectUri,
      code_verifier: p.verifier,
      client_id: c.clientId,
      client_secret: c.clientSecret,
    },
    now,
  );

export const googleRefresh = (
  fetchFn: FetchLike,
  c: GoogleCredentials,
  refreshToken: string,
  now: () => number = Date.now,
) =>
  tokenCall(
    fetchFn,
    {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: c.clientId,
      client_secret: c.clientSecret,
    },
    now,
    refreshToken,
  );

async function failure(res: Response): Promise<FolderProviderError> {
  const body = (await res.text().catch(() => '')).slice(0, 300);
  const rate = res.status === 429 || (res.status === 403 && /rateLimitExceeded/i.test(body));
  const kind =
    res.status === 401 || (res.status === 403 && !rate)
      ? 'auth'
      : res.status === 404
        ? 'missing'
        : 'other';
  return new FolderProviderError(
    'google',
    res.status,
    kind,
    rate || res.status >= 500,
    `google ${res.status}: ${body}`,
  );
}

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export function createDriveProvider(
  token: () => Promise<string>,
  fetchFn: FetchLike,
): FolderProvider {
  async function call(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${await token()}`);
    return fetchFn(url, { ...init, headers });
  }
  async function json<T>(res: Response): Promise<T> {
    if (!res.ok) throw await failure(res);
    return (await res.json()) as T;
  }
  async function findChild(parent: string, name: string, folder: boolean) {
    const query = `'${q(parent)}' in parents and name = '${q(name)}' and trashed = false and mimeType ${folder ? '=' : '!='} '${FOLDER_MIME}'`;
    const r = await json<{ files: { id: string }[] }>(
      await call(
        `${API}/files?${new URLSearchParams({ q: query, fields: 'files(id)', pageSize: '1', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' })}`,
      ),
    );
    return r.files[0]?.id ?? null;
  }
  async function makeFolder(parent: string | null, name: string) {
    return json<{ id: string; name: string; webViewLink?: string }>(
      await call(`${API}/files?supportsAllDrives=true&fields=id,name,webViewLink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          mimeType: FOLDER_MIME,
          ...(parent ? { parents: [parent] } : {}),
        }),
      }),
    );
  }

  return {
    async resolveTarget({ projectName }) {
      const f = await makeFolder(null, `Archova - ${projectName}`.slice(0, 120));
      return { driveId: null, folderId: f.id, name: f.name, webUrl: f.webViewLink ?? null };
    },
    async ensureSubfolder(parent, name) {
      const found = await findChild(parent.folderId, name, true);
      return { folderId: found ?? (await makeFolder(parent.folderId, name)).id };
    },
    async uploadFile(parent, file) {
      const existing = await findChild(parent.folderId, file.name, false);
      const start = await call(
        existing
          ? `${UPLOAD}/files/${encodeURIComponent(existing)}?uploadType=resumable&supportsAllDrives=true&fields=id,webViewLink`
          : `${UPLOAD}/files?uploadType=resumable&supportsAllDrives=true&fields=id,webViewLink`,
        {
          method: existing ? 'PATCH' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Upload-Content-Type': file.contentType,
          },
          body: JSON.stringify(existing ? {} : { name: file.name, parents: [parent.folderId] }),
        },
      );
      if (!start.ok) throw await failure(start);
      const location = start.headers.get('location');
      if (!location)
        throw new FolderProviderError('google', 502, 'other', true, 'No upload location');
      // The session address is pre-authorised; no bearer token on it.
      const res = await fetchFn(location, {
        method: 'PUT',
        headers: { 'Content-Type': file.contentType },
        body: file.bytes as unknown as RequestInit['body'],
      });
      const r = await json<{ id: string; webViewLink?: string }>(res);
      return { remoteId: r.id, webUrl: r.webViewLink ?? null };
    },
    async moveFile(_drive, remoteId, fromFolderId, toFolderId) {
      const params = new URLSearchParams({
        addParents: toFolderId,
        removeParents: fromFolderId,
        supportsAllDrives: 'true',
        fields: 'id',
      });
      await json(
        await call(`${API}/files/${encodeURIComponent(remoteId)}?${params}`, { method: 'PATCH' }),
      );
    },
  };
}
