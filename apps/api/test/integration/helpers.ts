import { createHash } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { decodeId } from '@archova/domain';
import {
  createDatabase,
  createLogger,
  createRedis,
  type Database,
  type RedisClient,
} from '@archova/kernel';
import { createMemoryObjectStore, hexToBase64, noScanner, quarantineKey } from '@archova/mod-files';
import {
  TEST_PASSWORD,
  testAppUrl,
  testMigratorUrl,
  testRedisUrl,
  uniqueEmail,
} from '@archova/testing';
import { buildApp } from '../../src/app';
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
  close(): Promise<void>;
}

export async function createTestContext(opts: { redis?: boolean } = {}): Promise<TestContext> {
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
  const app = await buildApp({
    config,
    database,
    redis,
    logger: createLogger('test', 'silent'),
    store,
    scanner: noScanner,
  });
  await app.ready();
  return {
    app,
    database,
    adminDb,
    redis,
    store,
    async close() {
      await app.close();
      await database.close();
      await adminDb.close();
      redis?.disconnect();
    },
  };
}

/** A browser on app.<domain>: keeps cookies, sends Origin and the CSRF header like the web auth-client does. */
export class Browser {
  cookies = new Map<string, string>();
  csrf: string | null = null;
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

/** Adds `email` to the project under a seeded template, with a new company of `companyType`. */
export async function addMember(
  owner: Browser,
  orgId: string,
  projectId: string,
  email: string,
  template: string,
  companyName = 'Sparky Electrical',
) {
  const company = (
    await owner.post(`/v1/orgs/${orgId}/companies`, { name: companyName, type: 'subcontractor' })
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
