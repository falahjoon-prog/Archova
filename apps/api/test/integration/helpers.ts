import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { decodeId } from '@archova/domain';
import {
  createDatabase,
  createLogger,
  createMemoryMessageSender,
  createRedis,
  type Database,
  type RedisClient,
} from '@archova/kernel';
import {
  DEFAULT_FAKE_RESPONDERS,
  createFakeProvider,
  type FakeProvider,
  type RasterizePage,
} from '@archova/mod-ai';
import {
  createMemoryObjectStore,
  hexToBase64,
  noScanner,
  quarantineKey,
  type MalwareScanner,
} from '@archova/mod-files';
import {
  TEST_PASSWORD,
  testAppUrl,
  testMigratorUrl,
  testRedisUrl,
  uniqueEmail,
} from '@archova/testing';
import { buildApp } from '../../src/app';
import type { Modules } from '@archova/compose';
import { loadConfig } from '../../src/config';

export const APP_HOST = 'app.archova.test';
export const API_HOST = 'api.archova.test';
export const APP_ORIGIN = `https://${APP_HOST}`;

export interface TestContext {
  app: FastifyInstance;
  database: Database;
  /** Migrator connection for assertions that must see every tenant (owner of the tables, still subject to FORCE RLS). */
  adminDb: Database;
  redis: RedisClient | null;
  store: ReturnType<typeof createMemoryObjectStore>;
  /** Everything the API tried to send by SMS or email (one-time codes for access links). */
  messages: ReturnType<typeof createMemoryMessageSender>;
  /** Nova's model provider; tests script replies per task with `ai.on(task, ...)`. */
  ai: FakeProvider;
  /** The loaded modules, for driving internal commands such as imports (X49). */
  modules: Modules;
  close(): Promise<void>;
}

export async function createTestContext(
  opts: { redis?: boolean; scanner?: MalwareScanner; rasterizePage?: RasterizePage } = {},
): Promise<TestContext> {
  const config = loadConfig({
    NODE_ENV: 'test',
    API_DATABASE_URL: testAppUrl(),
    API_APP_ORIGINS: APP_ORIGIN,
    API_PUBLIC_HOSTS: API_HOST,
    API_WEB_SIGN_IN_URL: `${APP_ORIGIN}/login`,
    LOG_LEVEL: 'silent',
  });
  const database = createDatabase(testAppUrl(), { max: 5 });
  const adminDb = createDatabase(testMigratorUrl(), { max: 2 });
  const redisUrl = testRedisUrl();
  const redis = opts.redis !== false && redisUrl ? createRedis(redisUrl) : null;
  const store = createMemoryObjectStore();
  const messages = createMemoryMessageSender();
  const ai = createFakeProvider({ ...DEFAULT_FAKE_RESPONDERS });
  let modules: Modules | null = null;
  const app = await buildApp({
    onModules: (m) => {
      modules = m;
    },
    config,
    database,
    redis,
    logger: createLogger('test', 'silent'),
    store,
    scanner: opts.scanner ?? noScanner,
    aiProvider: ai,
    ...(opts.rasterizePage ? { aiRasterizePage: opts.rasterizePage } : {}),
    messages,
  });
  await app.ready();
  return {
    app,
    database,
    adminDb,
    redis,
    store,
    messages,
    ai,
    modules: modules!,
    async close() {
      await app.close();
      await database.close();
      await adminDb.close();
      redis?.disconnect();
    },
  };
}

/** A browser on app.<domain>: keeps cookies, sends Origin and the CSRF header like the web auth-client does. */
let browsers = 0;
export class Browser {
  cookies = new Map<string, string>();
  csrf: string | null = null;
  /** Each browser is its own device on its own address, so per-IP limits don't couple unrelated tests. */
  private ip = `10.${(++browsers >> 8) & 255}.${browsers & 255}.7`;
  constructor(private app: FastifyInstance) {}

  private absorb(res: LightMyRequestResponse) {
    for (const c of res.cookies) {
      if (
        c.value === '' ||
        (c.maxAge !== undefined && c.maxAge <= 0) ||
        (c.expires && c.expires.getTime() < Date.now())
      ) {
        this.cookies.delete(c.name);
      } else {
        this.cookies.set(c.name, c.value);
      }
    }
    const body = res.headers['content-type']?.toString().includes('json')
      ? (res.json() as { csrfToken?: string })
      : null;
    if (body?.csrfToken) this.csrf = body.csrfToken;
  }

  async request(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const res = await this.app.inject({
      method,
      url,
      remoteAddress: this.ip,
      headers: {
        host: APP_HOST,
        ...(method !== 'GET' ? { origin: APP_ORIGIN } : {}),
        ...(this.csrf && method !== 'GET' ? { 'x-csrf-token': this.csrf } : {}),
        ...(this.cookies.size
          ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }
          : {}),
        ...headers,
      },
      ...(body !== undefined ? { payload: body as Record<string, unknown> } : {}),
    });
    this.absorb(res);
    return res;
  }

  get = (url: string, headers?: Record<string, string>) =>
    this.request('GET', url, undefined, headers);
  post = (url: string, body?: unknown, headers?: Record<string, string>) =>
    this.request('POST', url, body ?? {}, headers);
  patch = (url: string, body?: unknown, headers?: Record<string, string>) =>
    this.request('PATCH', url, body ?? {}, headers);
  put = (url: string, body?: unknown, headers?: Record<string, string>) =>
    this.request('PUT', url, body ?? {}, headers);
  del = (url: string, headers?: Record<string, string>) =>
    this.request('DELETE', url, undefined, headers);
}

export async function signUp(app: FastifyInstance, label = 'user') {
  const browser = new Browser(app);
  const email = uniqueEmail(label);
  const res = await browser.post('/v1/auth/signup', {
    email,
    password: TEST_PASSWORD,
    name: `${label} tester`,
  });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.statusCode} ${res.body}`);
  const userId = (res.json() as { user: { id: string } }).user.id;
  return { browser, email, userId };
}

export async function createOrg(browser: Browser, name = 'Acme Builders') {
  const res = await browser.post('/v1/orgs', { name });
  if (res.statusCode !== 201) throw new Error(`createOrg failed: ${res.statusCode} ${res.body}`);
  return res.json() as { id: string; slug: string };
}

export async function createProject(
  browser: Browser,
  orgId: string,
  body: Record<string, unknown> = { name: 'Tower A', state: 'QLD' },
) {
  const res = await browser.post(`/v1/orgs/${orgId}/projects`, body);
  if (res.statusCode !== 201)
    throw new Error(`createProject failed: ${res.statusCode} ${res.body}`);
  return res.json() as { id: string; version: number; timezone: string };
}

/** Uploads a small file into a project through the real presign → PUT → complete flow and returns its id. */
export async function uploadFile(
  t: TestContext,
  browser: Browser,
  orgId: string,
  projectId: string,
  filename = 'A-101.pdf',
  module = 'documents',
) {
  const content = `${filename} ${Math.random()}`;
  const sha256 = createHash('sha256').update(content).digest('hex');
  const created = await browser.post(`/v1/orgs/${orgId}/uploads`, {
    filename,
    mime: 'application/pdf',
    sizeBytes: content.length,
    sha256,
    module,
    projectId,
  });
  if (created.statusCode !== 201)
    throw new Error(`upload failed: ${created.statusCode} ${created.body}`);
  const uploadId = (created.json() as { id: string }).id;
  t.store.put(quarantineKey(decodeId('upload', uploadId)!), content.length, hexToBase64(sha256));
  const done = await browser.post(`/v1/orgs/${orgId}/uploads/${uploadId}/complete`);
  if (done.statusCode !== 200) throw new Error(`complete failed: ${done.statusCode} ${done.body}`);
  return (done.json() as { id: string }).id;
}

/** Uploads real bytes (a generated PDF) through the same flow and returns the file id. */
export async function uploadBytes(
  t: TestContext,
  browser: Browser,
  orgId: string,
  projectId: string,
  bytes: Uint8Array,
  filename = 'document.pdf',
  mime = 'application/pdf',
) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const created = await browser.post(`/v1/orgs/${orgId}/uploads`, {
    filename,
    mime,
    sizeBytes: bytes.length,
    sha256,
    module: 'documents',
    projectId,
  });
  if (created.statusCode !== 201)
    throw new Error(`upload failed: ${created.statusCode} ${created.body}`);
  const uploadId = (created.json() as { id: string }).id;
  t.store.put(
    quarantineKey(decodeId('upload', uploadId)!),
    bytes.length,
    hexToBase64(sha256),
    bytes,
  );
  const done = await browser.post(`/v1/orgs/${orgId}/uploads/${uploadId}/complete`);
  if (done.statusCode !== 200) throw new Error(`complete failed: ${done.statusCode} ${done.body}`);
  return (done.json() as { id: string }).id;
}

/** Adds `email` to the project under a seeded template, with a new company of `companyType`. */
export async function addMember(
  owner: Browser,
  orgId: string,
  projectId: string,
  email: string,
  template: string,
  companyName = 'Sparky Electrical',
  trades: string[] = [],
) {
  const company = (
    await owner.post(`/v1/orgs/${orgId}/companies`, {
      name: companyName,
      type: 'subcontractor',
      ...(trades.length ? { trades } : {}),
    })
  ).json() as { id: string };
  const templates = (await owner.get(`/v1/orgs/${orgId}/permission-templates`)).json()
    .data as Array<{ id: string; name: string }>;
  const tpl = templates.find((x) => x.name === template);
  if (!tpl) throw new Error(`no template ${template}`);
  const res = await owner.post(`/v1/orgs/${orgId}/projects/${projectId}/members`, {
    email,
    companyId: company.id,
    permissionTemplateId: tpl.id,
  });
  if (res.statusCode !== 201) throw new Error(`addMember failed: ${res.statusCode} ${res.body}`);
  return { companyId: company.id };
}

/** The `data` of every outbox event of a type in an org, oldest first (public org and user ids). */
export async function outboxData<T>(
  t: TestContext,
  orgId: string,
  userId: string,
  type: string,
): Promise<T[]> {
  const org = decodeId('org', orgId)!;
  const rows = await t.adminDb.withTenantTx(
    {
      orgId: org,
      userId: decodeId('user', userId)!,
      principalType: 'member' as const,
      orgRole: 'owner' as const,
      entitlements: { plan: 'x', state: 'active' as const, modules: [], limits: {} },
      requestId: 'test',
    },
    ({ tx }) =>
      tx.execute(sql`select data from shared.outbox
                     where org_id = ${org} and type = ${type} order by occurred_at`),
  );
  return (rows.rows as Array<{ data: T }>).map((r) => r.data);
}
