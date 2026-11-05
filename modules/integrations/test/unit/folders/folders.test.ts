import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  FolderProviderError,
  adminConsentUrl,
  appToken,
  clientAssertion,
  createDriveProvider,
  createFakeFolderProvider,
  createGraphProvider,
  googleAuthorizeUrl,
  publishedFileName,
} from '../../../src/domain/folders';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers });

describe('published file names', () => {
  it('keeps the extension and strips characters SharePoint refuses', () => {
    expect(publishedFileName('A-101/2', 'C', 'plan.pdf')).toBe('A-101-2_Rev-C.pdf');
    expect(publishedFileName('S#1', 'B*', 'x')).toBe('S-1_Rev-B-');
  });
});

describe('fake provider', () => {
  it('replaces a file of the same name instead of duplicating it', async () => {
    const fake = createFakeFolderProvider('google');
    const t = await fake.provider.resolveTarget({ projectName: 'Tower' });
    const bytes = new Uint8Array([1]);
    const a = await fake.provider.uploadFile(t, {
      name: 'A1_Rev-A.pdf',
      contentType: 'application/pdf',
      bytes,
    });
    const b = await fake.provider.uploadFile(t, {
      name: 'A1_Rev-A.pdf',
      contentType: 'application/pdf',
      bytes,
    });
    expect(b.remoteId).toBe(a.remoteId);
    expect(fake.list(t.folderId)).toEqual(['A1_Rev-A.pdf']);
  });
  it('moves a superseded file into the Superseded folder', async () => {
    const fake = createFakeFolderProvider('m365');
    const t = await fake.provider.resolveTarget({
      url: 'https://x.sharepoint.com/sites/p/Drawings',
      projectName: 'T',
    });
    const sup = await fake.provider.ensureSubfolder(t, 'Superseded');
    expect((await fake.provider.ensureSubfolder(t, 'Superseded')).folderId).toBe(sup.folderId);
    const up = await fake.provider.uploadFile(t, {
      name: 'A1_Rev-A.pdf',
      contentType: 'application/pdf',
      bytes: new Uint8Array(),
    });
    await fake.provider.moveFile(t.driveId, up.remoteId, t.folderId, sup.folderId);
    expect(fake.list(t.folderId)).toEqual([]);
    expect(fake.list(sup.folderId)).toEqual(['A1_Rev-A.pdf']);
  });
});

describe('Microsoft Graph', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const creds = { clientId: 'app-1', privateKeyPem: pem, thumbprintHex: 'ab'.repeat(32) };

  it('signs a certificate assertion for the tenant token endpoint', () => {
    const jwt = clientAssertion(creds, 'tenant-1', 1_700_000_000_000);
    const [h, p, sig] = jwt.split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toMatchObject({ alg: 'RS256' });
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(payload).toMatchObject({ iss: 'app-1', sub: 'app-1' });
    expect(payload.aud).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token');
    expect(sig.length).toBeGreaterThan(100);
  });

  it('sends no client secret when asking for the app token', async () => {
    let body = '';
    const f = async (_u: string, init?: RequestInit) => {
      body = String(init?.body);
      return json({ access_token: 't', expires_in: 3600 });
    };
    const t = await appToken(f, creds, 'tenant-1', () => 0);
    expect(t.accessToken).toBe('t');
    expect(body).toContain('client_assertion=');
    expect(body).toContain('grant_type=client_credentials');
    expect(body).not.toContain('client_secret');
  });

  it('builds the admin consent address for the tenant', () => {
    const u = new URL(
      adminConsentUrl({
        tenantId: 'contoso.com',
        clientId: 'a',
        redirectUri: 'https://app/cb',
        state: 's',
      }),
    );
    expect(u.pathname).toBe('/contoso.com/adminconsent');
    expect(u.searchParams.get('state')).toBe('s');
  });

  it('resolves a pasted folder address and rejects a file', async () => {
    const f = async (u: string) => {
      expect(u).toContain('/shares/u!');
      return json({
        id: 'i1',
        name: 'Drawings',
        webUrl: 'w',
        folder: {},
        parentReference: { driveId: 'd1' },
      });
    };
    const t = await createGraphProvider(async () => 'tok', f).resolveTarget({
      url: 'https://x.sharepoint.com/f',
      projectName: 'p',
    });
    expect(t).toMatchObject({ driveId: 'd1', folderId: 'i1' });
    const file = async () => json({ id: 'i2', name: 'a.pdf', parentReference: { driveId: 'd1' } });
    await expect(
      createGraphProvider(async () => 'tok', file).resolveTarget({
        url: 'https://x/a.pdf',
        projectName: 'p',
      }),
    ).rejects.toMatchObject({ kind: 'bad_target' });
  });

  it('uploads small files in one call and large files in session chunks without our token on the session', async () => {
    const calls: { url: string; auth: string | null; range: string | null }[] = [];
    const f = async (url: string, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      calls.push({ url, auth: h.get('authorization'), range: h.get('content-range') });
      if (url.includes('createUploadSession'))
        return json({ uploadUrl: 'https://upload.example/s' });
      if (url.startsWith('https://upload.example')) {
        return h.get('content-range')!.endsWith(`/${11 * 1024 * 1024}`) &&
          h.get('content-range')!.includes(`-${11 * 1024 * 1024 - 1}/`)
          ? json({ id: 'big' })
          : json({}, 202);
      }
      return json({ id: 'small' });
    };
    const g = createGraphProvider(async () => 'tok', f);
    const parent = { driveId: 'd', folderId: 'f' };
    const small = await g.uploadFile(parent, {
      name: 'a b.pdf',
      contentType: 'application/pdf',
      bytes: new Uint8Array(10),
    });
    expect(small.remoteId).toBe('small');
    expect(calls[0]!.url).toContain('a%20b.pdf');
    expect(calls[0]!.url).toContain('conflictBehavior=replace');
    calls.length = 0;
    const big = await g.uploadFile(parent, {
      name: 'b.pdf',
      contentType: 'application/pdf',
      bytes: new Uint8Array(11 * 1024 * 1024),
    });
    expect(big.remoteId).toBe('big');
    const chunks = calls.filter((c) => c.url.startsWith('https://upload.example'));
    expect(chunks.length).toBe(2);
    expect(chunks.every((c) => c.auth === null)).toBe(true);
  });

  it('classifies throttling as retryable and a refused token as auth', async () => {
    const g = createGraphProvider(
      async () => 't',
      async () => json({}, 429),
    );
    await expect(g.ensureSubfolder({ driveId: 'd', folderId: 'f' }, 'S')).rejects.toMatchObject({
      retryable: true,
    });
    const bad = async () => json({ error: 'invalid_client' }, 401);
    await expect(appToken(bad, creds, 't')).rejects.toBeInstanceOf(FolderProviderError);
  });
});

describe('Google Drive', () => {
  it('asks only for the drive.file scope, offline, with PKCE', () => {
    const u = new URL(
      googleAuthorizeUrl({
        clientId: 'c',
        redirectUri: 'https://app/cb',
        state: 's',
        challenge: 'x',
      }),
    );
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('updates a file of the same name rather than creating a second', async () => {
    const calls: { url: string; method: string }[] = [];
    const f = async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      if (url.includes('/files?q') || url.includes('files?q=') || url.includes('pageSize'))
        return json({ files: [{ id: 'old' }] });
      if (url.includes('uploadType=resumable'))
        return new Response(null, {
          status: 200,
          headers: { location: 'https://upload.example/x' },
        });
      return json({ id: 'old', webViewLink: 'w' });
    };
    const d = createDriveProvider(async () => 'tok', f);
    const r = await d.uploadFile(
      { driveId: null, folderId: 'fo' },
      { name: 'a.pdf', contentType: 'application/pdf', bytes: new Uint8Array(3) },
    );
    expect(r.remoteId).toBe('old');
    expect(calls.some((c) => c.method === 'PATCH' && c.url.includes('/files/old'))).toBe(true);
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('uploadType=resumable'))).toBe(
      false,
    );
  });

  it('treats 403 rateLimitExceeded as retryable and other 403 as auth', async () => {
    const rate = createDriveProvider(
      async () => 't',
      async () => new Response('rateLimitExceeded', { status: 403 }),
    );
    await expect(rate.ensureSubfolder({ driveId: null, folderId: 'f' }, 'S')).rejects.toMatchObject(
      { retryable: true },
    );
    const deny = createDriveProvider(
      async () => 't',
      async () => new Response('forbidden', { status: 403 }),
    );
    await expect(deny.ensureSubfolder({ driveId: null, folderId: 'f' }, 'S')).rejects.toMatchObject(
      { kind: 'auth', retryable: false },
    );
  });
});
