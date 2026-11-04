import { decodeId } from '@archova/domain';
import type { TenantContext } from '@archova/kernel';
import {
  createWebhookService,
  vaultFromKey,
  type WebhookPayload,
  type WebhookTransport,
} from '@archova/mod-integrations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEV_WEBHOOK_KEY } from '../../src/config';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  type TestContext,
} from './helpers';

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: string;
}
const sent: Sent[] = [];
let answer: { status: number | null; error: string | null } = { status: 200, error: null };
const transport: WebhookTransport = {
  async send(req) {
    sent.push({ url: req.url, headers: req.headers, body: req.body });
    return answer;
  },
};

/** The tenant context the worker runs deliveries under. */
const jobContext = (orgId: string, requestId: string): TenantContext => ({
  orgId,
  userId: '00000000-0000-0000-0000-000000000000',
  principalType: 'member',
  orgRole: null,
  entitlements: { plan: 'system', state: 'active', modules: [], limits: {} },
  requestId,
});

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext({ webhookTransport: transport });
});
afterAll(() => t.close());

async function setup(label: string) {
  const owner = await signUp(t.app, label);
  const org = await createOrg(owner.browser, 'Hook Builders');
  const project = await createProject(owner.browser, org.id, { name: 'Tower H', state: 'VIC' });
  return { owner, org, project };
}
const body = (extra: object = {}) => ({
  url: 'https://hooks.example.com/archova',
  eventTypes: ['rfis.rfi.created.v1'],
  ...extra,
});

describe('webhook endpoints (integrations/06 §5)', () => {
  it('proves the endpoint with a signed test event, then shows the secret once', async () => {
    const s = await setup('wh-create');
    answer = { status: 200, error: null };
    sent.length = 0;
    const res = await s.owner.browser.post(`/v1/orgs/${s.org.id}/webhooks`, body());
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created.secret).toMatch(/^whsec_/);
    expect(created).toMatchObject({ status: 'active', projectIds: null });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers['webhook-signature']).toMatch(/^v1,/);
    expect(JSON.parse(sent[0]!.body)).toMatchObject({ type: 'webhook.test.v1' });

    const listed = (await s.owner.browser.get(`/v1/orgs/${s.org.id}/webhooks`)).json();
    expect(listed.data).toHaveLength(1);
    expect(listed.availableEventTypes).toContain('rfis.rfi.created.v1');
    expect(JSON.stringify(listed)).not.toContain(created.secret);

    const del = await s.owner.browser.del(`/v1/orgs/${s.org.id}/webhooks/${created.id}`);
    expect(del.statusCode).toBe(204);
    expect((await s.owner.browser.get(`/v1/orgs/${s.org.id}/webhooks`)).json().data).toHaveLength(
      0,
    );
  });

  it('refuses an endpoint that does not answer, an unsafe URL and a non-public event type', async () => {
    const s = await setup('wh-refuse');
    sent.length = 0;
    answer = { status: 500, error: null };
    const down = await s.owner.browser.post(`/v1/orgs/${s.org.id}/webhooks`, body());
    expect(down.statusCode).toBe(422);
    expect(down.json()).toMatchObject({ code: 'webhook.verification_failed' });

    answer = { status: 200, error: null };
    sent.length = 0;
    for (const url of [
      'http://example.com/x',
      'https://127.0.0.1/x',
      'https://169.254.169.254/x',
    ]) {
      const r = await s.owner.browser.post(`/v1/orgs/${s.org.id}/webhooks`, body({ url }));
      expect(r.statusCode, url).toBe(422);
    }
    expect(sent).toHaveLength(0);

    const type = await s.owner.browser.post(
      `/v1/orgs/${s.org.id}/webhooks`,
      body({ eventTypes: ['identity.session.created.v1'] }),
    );
    expect(type.statusCode).toBe(422);
    expect(type.json()).toMatchObject({ code: 'webhook.invalid_event_type' });
    expect(sent).toHaveLength(0);
  });

  it('is for owners and admins, and a personal access token cannot reach it', async () => {
    const s = await setup('wh-authz');
    const member = await signUp(t.app, 'wh-member');
    await addMember(s.owner.browser, s.org.id, s.project.id, member.email, 'Subcontractor');
    const res = await member.browser.post(`/v1/orgs/${s.org.id}/webhooks`, body());
    expect([403, 404]).toContain(res.statusCode);

    const token = (
      await s.owner.browser.post(`/v1/orgs/${s.org.id}/api-tokens`, {
        name: 'wh',
        scopes: ['projects:read'],
      })
    ).json().token as string;
    const viaToken = await t.app.inject({
      method: 'GET',
      url: `/v1/orgs/${s.org.id}/webhooks`,
      headers: { host: 'api.archova.test', authorization: `Bearer ${token}` },
    });
    expect(viaToken.statusCode).toBe(403);
  });

  it('keeps one org out of another’s endpoints', async () => {
    const a = await setup('wh-a');
    const b = await setup('wh-b');
    answer = { status: 200, error: null };
    const created = (await a.owner.browser.post(`/v1/orgs/${a.org.id}/webhooks`, body())).json();
    const del = await b.owner.browser.del(`/v1/orgs/${b.org.id}/webhooks/${created.id}`);
    expect(del.statusCode).toBe(404);
    expect((await b.owner.browser.get(`/v1/orgs/${b.org.id}/webhooks`)).json().data).toHaveLength(
      0,
    );
  });
});

describe('delivery', () => {
  const service = (clock: { now: Date }) =>
    createWebhookService({
      vault: vaultFromKey(DEV_WEBHOOK_KEY),
      transport,
      now: () => clock.now,
    });
  const event = (
    orgId: string,
    projectId: string | null,
    extra: Partial<WebhookPayload> = {},
  ): WebhookPayload => ({
    id: crypto.randomUUID(),
    type: 'rfis.rfi.created.v1',
    orgId,
    projectId,
    entityType: 'rfi',
    entityId: crypto.randomUUID(),
    entityVersion: 1,
    occurredAt: new Date().toISOString(),
    ...extra,
  });

  it('sends a signed notice, retries with backoff, and disables the endpoint after 72 hours', async () => {
    const s = await setup('wh-deliver');
    answer = { status: 200, error: null };
    const created = (
      await s.owner.browser.post(
        `/v1/orgs/${s.org.id}/webhooks`,
        body({ projectIds: [s.project.id] }),
      )
    ).json();
    const orgId = decodeId('org', s.org.id)!;
    const projectId = decodeId('project', s.project.id)!;
    const clock = { now: new Date() };
    const svc = service(clock);
    const run = <T>(fn: Parameters<typeof t.database.withTenantTx<T>>[1]) =>
      t.database.withTenantTx(jobContext(orgId, 'test'), fn);

    // an event on another project, and one of a type nobody subscribed to, create nothing
    expect(await run((sc) => svc.fanOut(sc, event(orgId, crypto.randomUUID())))).toBe(0);
    expect(
      await run((sc) => svc.fanOut(sc, event(orgId, projectId, { type: 'rfis.rfi.closed.v1' }))),
    ).toBe(0);

    const e = event(orgId, projectId);
    expect(await run((sc) => svc.fanOut(sc, e))).toBe(1);
    // the same event handed over twice is still one delivery
    expect(await run((sc) => svc.fanOut(sc, e))).toBe(0);

    answer = { status: 503, error: null };
    sent.length = 0;
    const first = await run((sc) => svc.attemptDue(sc));
    expect(first).toMatchObject({ delivered: 0, retried: 1, abandoned: 0 });
    expect(first.nextAt!.getTime()).toBe(clock.now.getTime() + 30_000);
    // not due yet
    expect(await run((sc) => svc.attemptDue(sc))).toMatchObject({ retried: 0 });

    clock.now = new Date(clock.now.getTime() + 31_000);
    answer = { status: 200, error: null };
    expect(await run((sc) => svc.attemptDue(sc))).toMatchObject({ delivered: 1, nextAt: null });
    const last = sent.at(-1)!;
    expect(JSON.parse(last.body)).toMatchObject({ id: e.id, type: e.type, entityType: 'rfi' });
    expect(JSON.parse(last.body)).not.toHaveProperty('data');
    expect(last.headers['webhook-id']).toBe(e.id);

    const log = (
      await s.owner.browser.get(`/v1/orgs/${s.org.id}/webhooks/${created.id}/deliveries`)
    ).json().data;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ status: 'succeeded', attempts: 2, lastStatus: 200 });

    // a failing endpoint is given up on after 72 hours and switched off
    const e2 = event(orgId, projectId);
    await run((sc) => svc.fanOut(sc, e2));
    answer = { status: 500, error: null };
    clock.now = new Date(clock.now.getTime() + 73 * 3_600_000);
    expect(await run((sc) => svc.attemptDue(sc))).toMatchObject({ abandoned: 1 });
    const after = (await s.owner.browser.get(`/v1/orgs/${s.org.id}/webhooks`)).json().data[0];
    expect(after).toMatchObject({ status: 'disabled' });
    // and a disabled endpoint receives nothing further
    expect(await run((sc) => svc.fanOut(sc, event(orgId, projectId)))).toBe(0);
  });

  it('stops at once when the endpoint answers 410 Gone', async () => {
    const s = await setup('wh-gone');
    answer = { status: 200, error: null };
    await s.owner.browser.post(`/v1/orgs/${s.org.id}/webhooks`, body());
    const orgId = decodeId('org', s.org.id)!;
    const clock = { now: new Date() };
    const svc = service(clock);
    await t.database.withTenantTx(jobContext(orgId, 'test'), (sc) =>
      svc.fanOut(sc, event(orgId, null)),
    );
    answer = { status: 410, error: null };
    const r = await t.database.withTenantTx(jobContext(orgId, 'test'), (sc) => svc.attemptDue(sc));
    expect(r).toMatchObject({ abandoned: 1 });
    const list = (await s.owner.browser.get(`/v1/orgs/${s.org.id}/webhooks`)).json().data[0];
    expect(list).toMatchObject({
      status: 'disabled',
      disabledReason: expect.stringContaining('410'),
    });
  });
});
