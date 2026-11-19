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
  outboxData,
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

    const made = await outboxData<Record<string, unknown>>(
      t,
      s.org.id,
      s.owner.userId,
      'integrations.webhook.created.v1',
    );
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ url: 'https://hooks.example.com/archova' });
    expect(JSON.stringify(made)).not.toContain(created.secret);
    expect(
      await outboxData(t, s.org.id, s.owner.userId, 'integrations.webhook.deleted.v1'),
    ).toHaveLength(1);
  });

  it('allows ten create attempts an hour, then answers 429', async () => {
    const s = await setup('wh-limit');
    answer = { status: 500, error: null };
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      codes.push((await s.owner.browser.post(`/v1/orgs/${s.org.id}/webhooks`, body())).statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 422)).toBe(true);
    expect(codes[10]).toBe(429);
    answer = { status: 200, error: null };
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
    const first = await svc.attemptDue(t.database, jobContext(orgId, 'test'));
    expect(first).toMatchObject({ delivered: 0, retried: 1, abandoned: 0 });
    expect(first.nextAt!.getTime()).toBe(clock.now.getTime() + 30_000);
    // not due yet
    expect(await svc.attemptDue(t.database, jobContext(orgId, 'test'))).toMatchObject({
      retried: 0,
    });

    clock.now = new Date(clock.now.getTime() + 31_000);
    answer = { status: 200, error: null };
    expect(await svc.attemptDue(t.database, jobContext(orgId, 'test'))).toMatchObject({
      delivered: 1,
      nextAt: null,
    });
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
    expect(await svc.attemptDue(t.database, jobContext(orgId, 'test'))).toMatchObject({
      abandoned: 1,
    });
    const after = (await s.owner.browser.get(`/v1/orgs/${s.org.id}/webhooks`)).json().data[0];
    expect(after).toMatchObject({ status: 'disabled' });
    // and a disabled endpoint receives nothing further
    expect(await run((sc) => svc.fanOut(sc, event(orgId, projectId)))).toBe(0);
  });

  it('switches an endpoint off, and drops its queue, once too many events are waiting', async () => {
    const s = await setup('wh-cap');
    answer = { status: 200, error: null };
    await s.owner.browser.post(`/v1/orgs/${s.org.id}/webhooks`, body());
    const orgId = decodeId('org', s.org.id)!;
    const svc = createWebhookService({
      vault: vaultFromKey(DEV_WEBHOOK_KEY),
      transport,
      now: () => new Date(),
      maxPending: 2,
    });
    const fan = () =>
      t.database.withTenantTx(jobContext(orgId, 'test'), (sc) =>
        svc.fanOut(sc, event(orgId, null)),
      );
    expect(await fan()).toBe(1);
    expect(await fan()).toBe(1);
    expect(await fan()).toBe(0);
    const hook = (await s.owner.browser.get(`/v1/orgs/${s.org.id}/webhooks`)).json().data[0];
    expect(hook).toMatchObject({
      status: 'disabled',
      disabledReason: expect.stringContaining('waiting'),
    });
    const r = await svc.attemptDue(t.database, jobContext(orgId, 'test'));
    expect(r).toMatchObject({ delivered: 0, retried: 0 });
  });

  it('reseals secrets onto a new key version, never back to an older one', async () => {
    const s = await setup('wh-reseal');
    answer = { status: 200, error: null };
    await s.owner.browser.post(`/v1/orgs/${s.org.id}/webhooks`, body());
    const orgId = decodeId('org', s.org.id)!;
    const newKey = Buffer.alloc(32, 9).toString('base64');
    const svcWith = (spec: string) =>
      createWebhookService({ vault: vaultFromKey(spec), transport, now: () => new Date() });
    const rotated = svcWith(`2:${DEV_WEBHOOK_KEY},3:${newKey}`);
    const reseal = (svc: ReturnType<typeof svcWith>) =>
      t.database.withTenantTx(jobContext(orgId, 'test'), (sc) => svc.reseal(sc));
    expect(await reseal(rotated)).toBe(1);
    expect(await reseal(rotated)).toBe(0);
    // A worker that only knows the old key list does not move it back.
    expect(await reseal(svcWith(`2:${DEV_WEBHOOK_KEY}`))).toBe(0);
    // With the old key gone, the endpoint still gets signed notices.
    const onlyNew = svcWith(`3:${newKey}`);
    await t.database.withTenantTx(jobContext(orgId, 'test'), (sc) =>
      onlyNew.fanOut(sc, event(orgId, null)),
    );
    sent.length = 0;
    expect(await onlyNew.attemptDue(t.database, jobContext(orgId, 'test'))).toMatchObject({
      delivered: 1,
    });
    expect(sent[0]!.headers['webhook-signature']).toMatch(/^v1,/);
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
    const r = await svc.attemptDue(t.database, jobContext(orgId, 'test'));
    expect(r).toMatchObject({ abandoned: 1 });
    const list = (await s.owner.browser.get(`/v1/orgs/${s.org.id}/webhooks`)).json().data[0];
    expect(list).toMatchObject({
      status: 'disabled',
      disabledReason: expect.stringContaining('410'),
    });
  });
  it('sends with no transaction open, and leases a claimed delivery so a second worker skips it', async () => {
    const s = await setup('wh-lease');
    answer = { status: 200, error: null };
    await s.owner.browser.post(`/v1/orgs/${s.org.id}/webhooks`, body());
    const orgId = decodeId('org', s.org.id)!;
    const clock = { now: new Date() };
    const svc = service(clock);
    const ctx = jobContext(orgId, 'test');
    await t.database.withTenantTx(ctx, (sc) => svc.fanOut(sc, event(orgId, null)));

    // two passes at once: the claim leases the row, so only one of them sends it
    sent.length = 0;
    let openDuringSend = -1;
    const probe: WebhookTransport = {
      async send(req) {
        const r = await t.adminDb.pool.query(
          "select count(*)::int as n from pg_stat_activity where usename = 'app_rw' and state like 'idle in transaction%'",
        );
        openDuringSend = r.rows[0].n;
        return transport.send(req);
      },
    };
    const probing = createWebhookService({
      vault: vaultFromKey(DEV_WEBHOOK_KEY),
      transport: probe,
      now: () => clock.now,
    });
    const [a, b] = await Promise.all([
      probing.attemptDue(t.database, ctx),
      probing.attemptDue(t.database, ctx),
    ]);
    expect(a.delivered + b.delivered).toBe(1);
    expect(sent).toHaveLength(1);
    expect(openDuringSend).toBe(0);
  });
});
