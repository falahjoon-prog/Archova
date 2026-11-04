import { sql } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StaffRole } from '@archova/contracts';
import { decodeId } from '@archova/domain';
import { createOrg, createProject, createTestContext, signUp, type TestContext } from './helpers';

let t: TestContext;
const HOST = 'localhost:4000';
const ORIGIN = 'http://localhost:3008';
const PASSWORD = 'Console-Test-Pw-1';

beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

/** A staff member's browser on the console origin. */
class Console {
  cookie: string | null = null;
  constructor(
    private app: FastifyInstance,
    readonly email: string,
  ) {}

  async call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) {
    const res: LightMyRequestResponse = await this.app.inject({
      method,
      url: `/internal/v1${url}`,
      headers: {
        host: HOST,
        ...(method !== 'GET' ? { origin: ORIGIN } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      ...(body !== undefined ? { payload: body as Record<string, unknown> } : {}),
    });
    const set = res.cookies.find((c) => c.name === 'csid');
    if (set) this.cookie = `csid=${set.value}`;
    return res;
  }
  get = (u: string) => this.call('GET', u);
  post = (u: string, b?: unknown) => this.call('POST', u, b ?? {});
  put = (u: string, b: unknown) => this.call('PUT', u, b);

  async signIn() {
    const res = await this.post('/auth/login', { email: this.email, password: PASSWORD });
    expect(res.statusCode).toBe(200);
    return this;
  }
}

let n = 0;
async function staff(roles: StaffRole[], label = 'staff') {
  const email = `${label}-${++n}-${Date.now()}@archova.test`;
  await t.modules.backoffice.api.upsertLocalStaff({
    email,
    name: `${label} ${n}`,
    password: PASSWORD,
    roles,
  });
  return new Console(t.app, email).signIn();
}

const code = (res: LightMyRequestResponse) => (res.json() as { code?: string }).code;

describe('public price book', () => {
  it('serves the founding price list with no sign-in and never a draft', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/public/price-book',
      headers: { host: 'app.archova.test' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toBeTruthy();
    const book = res.json() as { version: string; plans: Array<{ code: string; price: unknown }> };
    expect(book.version).toBe('founding-2026-10');
    expect(book.plans.map((p) => p.code)).toEqual([
      'subcontractor',
      'team',
      'business',
      'enterprise',
    ]);
    expect(book.plans[1]!.price).toEqual({
      unit: 'user_month',
      fromPrice: false,
      amountCents: 9900,
    });
  });
});

describe('staff sign-in and realms', () => {
  it('signs in, reads me, and rejects a wrong password', async () => {
    const c = await staff(['owner']);
    const me = (await c.get('/me')).json() as {
      email: string;
      roles: string[];
      permissions: string[];
    };
    expect(me.email).toBe(c.email);
    expect(me.roles).toEqual(['owner']);
    expect(me.permissions).toContain('backoffice.pricing.approve');
    const bad = await new Console(t.app, c.email).post('/auth/login', {
      email: c.email,
      password: 'wrong-password',
    });
    expect(bad.statusCode).toBe(401);
    expect(code(bad)).toBe('auth.invalid_credentials');
  });

  it('answers 404 on the customer hosts and 401 without a staff session', async () => {
    const onApp = await t.app.inject({
      method: 'GET',
      url: '/internal/v1/me',
      headers: { host: 'app.archova.test' },
    });
    expect(onApp.statusCode).toBe(404);
    const anon = await new Console(t.app, 'x@y.z').get('/me');
    expect(anon.statusCode).toBe(401);
  });

  it('never accepts a customer session as staff, or a staff session on /v1', async () => {
    const { browser } = await signUp(t.app, 'realm');
    const sid = [...browser.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const asStaff = await t.app.inject({
      method: 'GET',
      url: '/internal/v1/me',
      headers: { host: HOST, cookie: sid },
    });
    expect(asStaff.statusCode).toBe(401);
    const c = await staff(['owner']);
    const onV1 = await t.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { host: 'app.archova.test', cookie: c.cookie! },
    });
    expect(onV1.statusCode).toBe(401);
  });

  it('blocks a cross-site write', async () => {
    const c = await staff(['owner']);
    const res = await t.app.inject({
      method: 'POST',
      url: '/internal/v1/auth/logout',
      headers: { host: HOST, origin: 'https://evil.example', cookie: c.cookie! },
    });
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe('auth.csrf_failed');
  });

  it('enforces roles: sales cannot edit pricing', async () => {
    const sales = await staff(['sales']);
    expect((await sales.get('/orgs')).statusCode).toBe(200);
    const res = await sales.post('/price-books');
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe('backoffice.permission_denied');
  });
});

describe('customers', () => {
  it('lists orgs from the tenant directory, searches and pages them', async () => {
    const { browser } = await signUp(t.app, 'dir');
    const a = await createOrg(browser, 'Zephyr Directory Test Builders');
    await createOrg(browser, 'Zephyr Directory Other Builders');
    const c = await staff(['support']);
    const found = (await c.get('/orgs?q=zephyr%20directory')).json() as {
      items: Array<{ orgId: string; name: string; plan: string; state: string }>;
    };
    expect(found.items.map((o) => o.name)).toEqual([
      'Zephyr Directory Other Builders',
      'Zephyr Directory Test Builders',
    ]);
    expect(found.items[0]).toMatchObject({ plan: 'trial', state: 'trialing' });
    const page1 = (await c.get('/orgs?q=zephyr%20directory&limit=1')).json() as {
      items: unknown[];
      nextCursor: string | null;
    };
    expect(page1.items).toHaveLength(1);
    const page2 = (
      await c.get(`/orgs?q=zephyr%20directory&limit=1&cursor=${page1.nextCursor}`)
    ).json() as {
      items: Array<{ name: string }>;
      nextCursor: string | null;
    };
    expect(page2.items[0]!.name).toBe('Zephyr Directory Test Builders');
    expect(page2.nextCursor).toBeNull();
    const one = await c.get(`/orgs/${a.id}`);
    expect(one.statusCode).toBe(200);
    expect((await c.get('/orgs/org_00000000000000000000000000')).statusCode).toBe(404);
  });
});

describe('price book publishing', () => {
  it('needs a second approver, step-up, and 60 days notice for an increase', async () => {
    const editor = await staff(['billing_ops'], 'editor');
    const approver = await staff(['pricing_approver'], 'approver');

    const draft = (await editor.post('/price-books')).json() as {
      id: string;
      status: string;
      prices: Array<{
        planCode: string;
        unit: string;
        fromPrice: boolean;
        amountCents: number | null;
      }>;
    };
    expect(draft.status).toBe('draft');
    expect(draft.prices).toHaveLength(4);
    // A second open draft is refused.
    expect((await editor.post('/price-books')).statusCode).toBe(409);

    const raise = (cents: number) =>
      draft.prices.map((p) => (p.planCode === 'team' ? { ...p, amountCents: cents } : p));
    await editor.put(`/price-books/${draft.id}`, { effectiveFrom: null, prices: raise(10900) });
    const preview = (await editor.post(`/price-books/${draft.id}/preview`)).json() as {
      hasIncrease: boolean;
      problems: string[];
      changes: Array<{ planCode: string; kind: string }>;
    };
    expect(preview.hasIncrease).toBe(true);
    expect(preview.changes.find((c) => c.planCode === 'team')!.kind).toBe('increase');
    const tooSoon = await editor.post(`/price-books/${draft.id}/submit`, {
      reason: 'Annual review',
    });
    expect(tooSoon.statusCode).toBe(422);
    expect(code(tooSoon)).toBe('backoffice.notice_too_short');

    const when = new Date(Date.now() + 61 * 86_400_000).toISOString();
    await editor.put(`/price-books/${draft.id}`, { effectiveFrom: when, prices: raise(10900) });
    const submitted = await editor.post(`/price-books/${draft.id}/submit`, {
      reason: 'Annual review',
    });
    expect(submitted.statusCode).toBe(201);
    const request = submitted.json() as { id: string; status: string; kind: string };
    expect(request).toMatchObject({ status: 'pending', kind: 'pricebook.publish' });

    // The draft is locked while it awaits approval.
    expect(
      (await editor.put(`/price-books/${draft.id}`, { effectiveFrom: when, prices: raise(11900) }))
        .statusCode,
    ).toBe(409);
    // The requester has no approval right, and cannot approve their own request.
    const own = await editor.post(`/requests/${request.id}/approve`);
    expect(own.statusCode).toBe(403);
    expect(code(own)).toBe('backoffice.permission_denied');

    // A stale password check needs a step-up first.
    await t.adminDb.db.execute(
      sql`update backoffice.staff_sessions set auth_time = now() - interval '10 minutes'`,
    );
    const stale = await approver.post(`/requests/${request.id}/approve`);
    expect(stale.statusCode).toBe(403);
    expect(code(stale)).toBe('auth.step_up_required');
    expect((await approver.post('/auth/step-up', { password: 'wrong-password' })).statusCode).toBe(
      401,
    );
    expect((await approver.post('/auth/step-up', { password: PASSWORD })).statusCode).toBe(200);

    const done = (await approver.post(`/requests/${request.id}/approve`)).json() as {
      status: string;
      result: { outcome: string };
      approvedBy: { name: string };
    };
    expect(done.status).toBe('executed');
    expect(done.result.outcome).toBe('scheduled');

    const live = async () =>
      (
        await t.app.inject({
          method: 'GET',
          url: '/v1/public/price-book',
          headers: { host: 'app.archova.test' },
        })
      ).json() as {
        version: string;
        plans: Array<{ code: string; price: { amountCents: number } }>;
      };
    // Scheduled: the old price stays live until its date.
    expect((await live()).plans.find((p) => p.code === 'team')!.price.amountCents).toBe(9900);

    // The date arrives: the next read activates it.
    await t.adminDb.db.execute(
      sql`update billing.price_books set effective_from = now() - interval '1 minute' where status = 'scheduled'`,
    );
    const after = await live();
    expect(after.plans.find((p) => p.code === 'team')!.price.amountCents).toBe(10900);
    expect(after.version).not.toBe('founding-2026-10');

    // The action log shows who asked and who approved.
    const log = (await approver.get('/requests?status=executed')).json() as {
      items: Array<{
        id: string;
        requestedBy: { name: string };
        approvedBy: { name: string } | null;
      }>;
    };
    const entry = log.items.find((r) => r.id === request.id)!;
    expect(entry.requestedBy.name).toContain('editor');
    expect(entry.approvedBy!.name).toContain('approver');
  });

  it('rejecting or cancelling returns the draft for editing', async () => {
    const editor = await staff(['billing_ops'], 'editor');
    const approver = await staff(['pricing_approver'], 'approver');
    const book = (await editor.post('/price-books')).json() as {
      id: string;
      prices: Array<{
        planCode: string;
        unit: string;
        fromPrice: boolean;
        amountCents: number | null;
      }>;
    };
    const cut = book.prices.map((p) => (p.planCode === 'team' ? { ...p, amountCents: 8900 } : p));
    await editor.put(`/price-books/${book.id}`, { effectiveFrom: null, prices: cut });
    const r1 = (
      await editor.post(`/price-books/${book.id}/submit`, { reason: 'Launch offer' })
    ).json() as { id: string };
    expect(
      (await approver.post(`/requests/${r1.id}/reject`, { reason: 'Too deep a cut' })).statusCode,
    ).toBe(200);
    expect(
      ((await editor.get(`/price-books/${book.id}`)).json() as { status: string }).status,
    ).toBe('draft');
    const r2 = (
      await editor.post(`/price-books/${book.id}/submit`, { reason: 'Launch offer again' })
    ).json() as { id: string };
    expect(
      ((await editor.post(`/requests/${r2.id}/cancel`)).json() as { status: string }).status,
    ).toBe('cancelled');
    expect((await editor.post(`/requests/${r2.id}/cancel`)).statusCode).toBe(409);
    // A decrease needs no notice and goes live at once once approved.
    const r3 = (
      await editor.post(`/price-books/${book.id}/submit`, { reason: 'Launch offer, final' })
    ).json() as { id: string };
    const ok = (await approver.post(`/requests/${r3.id}/approve`)).json() as {
      result: { outcome: string };
    };
    expect(ok.result.outcome).toBe('published');
    const live = (
      await t.app.inject({
        method: 'GET',
        url: '/v1/public/price-book',
        headers: { host: 'app.archova.test' },
      })
    ).json() as { plans: Array<{ code: string; price: { amountCents: number } }> };
    expect(live.plans.find((p) => p.code === 'team')!.price.amountCents).toBe(8900);
  });

  it('solo-owner mode: the only Owner waits out the cooling-off before approving their own change', async () => {
    await t.adminDb.db.execute(sql`update backoffice.staff_users set status = 'disabled'`);
    const owner = await staff(['owner'], 'solo');
    const book = (await owner.post('/price-books')).json() as {
      id: string;
      prices: Array<{
        planCode: string;
        unit: string;
        fromPrice: boolean;
        amountCents: number | null;
      }>;
    };
    const cut = book.prices.map((p) => (p.planCode === 'team' ? { ...p, amountCents: 8500 } : p));
    await owner.put(`/price-books/${book.id}`, { effectiveFrom: null, prices: cut });
    const req = (
      await owner.post(`/price-books/${book.id}/submit`, { reason: 'Solo owner change' })
    ).json() as {
      id: string;
      coolingOffUntil: string | null;
    };
    expect(req.coolingOffUntil).not.toBeNull();
    const early = await owner.post(`/requests/${req.id}/approve`);
    expect(early.statusCode).toBe(409);
    expect(code(early)).toBe('backoffice.cooling_off');
    await t.adminDb.db.execute(
      sql`update backoffice.requests set cooling_off_until = now() - interval '1 minute' where id = ${req.id}`,
    );
    const done = (await owner.post(`/requests/${req.id}/approve`)).json() as { status: string };
    expect(done.status).toBe('executed');
  });
});

describe('solo-owner mode is re-checked at approval', () => {
  it('refuses a self-approval once another approver exists', async () => {
    await t.adminDb.db.execute(sql`update backoffice.staff_users set status = 'disabled'`);
    const owner = await staff(['owner'], 'solo2');
    const book = (await owner.post('/price-books')).json() as {
      id: string;
      prices: Array<{
        planCode: string;
        unit: string;
        fromPrice: boolean;
        amountCents: number | null;
      }>;
    };
    const cut = book.prices.map((p) => (p.planCode === 'team' ? { ...p, amountCents: 8000 } : p));
    await owner.put(`/price-books/${book.id}`, { effectiveFrom: null, prices: cut });
    const req = (
      await owner.post(`/price-books/${book.id}/submit`, { reason: 'Solo, then a hire' })
    ).json() as { id: string };
    await t.adminDb.db.execute(
      sql`update backoffice.requests set cooling_off_until = now() - interval '1 minute' where id = ${req.id}`,
    );
    await staff(['pricing_approver'], 'newcomer');
    const res = await owner.post(`/requests/${req.id}/approve`);
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe('backoffice.self_approval');
    // The request stays pending for the second person.
    expect(
      (
        (await owner.get('/requests?status=pending')).json() as { items: Array<{ id: string }> }
      ).items.map((r) => r.id),
    ).toContain(req.id);
    await owner.post(`/requests/${req.id}/cancel`);
    await owner.call('DELETE', `/price-books/${book.id}`);
  });

  it('a failed publish reopens the draft and is recorded, in one transaction', async () => {
    const editor = await staff(['billing_ops'], 'editor3');
    const approver = await staff(['pricing_approver'], 'approver3');
    const book = (await editor.post('/price-books')).json() as {
      id: string;
      prices: Array<{
        planCode: string;
        unit: string;
        fromPrice: boolean;
        amountCents: number | null;
      }>;
    };
    const cut = book.prices.map((p) => (p.planCode === 'team' ? { ...p, amountCents: 7000 } : p));
    await editor.put(`/price-books/${book.id}`, { effectiveFrom: null, prices: cut });
    const req = (
      await editor.post(`/price-books/${book.id}/submit`, { reason: 'Will fail' })
    ).json() as { id: string };
    // Break the book after submission: a plan it prices is removed from the catalogue's rules (an increase with no notice).
    await t.adminDb.db.execute(
      sql`update billing.prices set amount_cents = 99999 where price_book_id = ${book.id} and plan_code = 'team'`,
    );
    const done = (await approver.post(`/requests/${req.id}/approve`)).json() as {
      status: string;
      result: { error: string };
    };
    expect(done.status).toBe('failed');
    expect(done.result.error).toMatch(/60 days/);
    expect(
      ((await editor.get(`/price-books/${book.id}`)).json() as { status: string }).status,
    ).toBe('draft');
    await editor.call('DELETE', `/price-books/${book.id}`);
  });
});

describe('plans', () => {
  it('edits a draft, publishes it through approval, and the pricing page follows', async () => {
    const editor = await staff(['billing_ops'], 'planner');
    const approver = await staff(['pricing_approver'], 'planner-approver');
    const plans = (await editor.get('/plans')).json() as {
      items: Array<{
        code: string;
        published: {
          name: string;
          blurb: string;
          features: string[];
          modules: string[];
          aiCreditsMonthly: number;
          ctaLabel: string;
          ctaHref: string;
        };
      }>;
    };
    const team = plans.items.find((p) => p.code === 'team')!;
    const { name: _n, ...rest } = team.published;
    void _n;
    const body = { ...rest, name: 'Team Plus', aiCreditsMonthly: 800 };
    expect((await editor.put('/plans/team/draft', { ...body, modules: ['nope'] })).statusCode).toBe(
      422,
    );
    expect((await editor.put('/plans/team/draft', body)).statusCode).toBe(204);
    const req = (
      await editor.post('/plans/team/draft/submit', { reason: 'More Nova credits' })
    ).json() as { id: string };
    // Locked while pending.
    expect((await editor.put('/plans/team/draft', body)).statusCode).toBe(409);
    const done = (await approver.post(`/requests/${req.id}/approve`)).json() as { status: string };
    expect(done.status).toBe('executed');
    const live = (
      await t.app.inject({
        method: 'GET',
        url: '/v1/public/price-book',
        headers: { host: 'app.archova.test' },
      })
    ).json() as { plans: Array<{ code: string; name: string }> };
    expect(live.plans.find((p) => p.code === 'team')!.name).toBe('Team Plus');
  });

  it('a new plan stays off the pricing page until a price book prices it', async () => {
    const editor = await staff(['billing_ops'], 'planner');
    const draft = {
      name: 'Starter',
      blurb: 'For one-project builders.',
      features: ['Documents'],
      modules: ['documents'],
      aiCreditsMonthly: 100,
      ctaLabel: 'Request a demo',
      ctaHref: '/demo',
    };
    expect((await editor.post('/plans', { code: 'starter', draft })).statusCode).toBe(201);
    expect((await editor.post('/plans', { code: 'starter', draft })).statusCode).toBe(409);
    const live = (
      await t.app.inject({
        method: 'GET',
        url: '/v1/public/price-book',
        headers: { host: 'app.archova.test' },
      })
    ).json() as { plans: Array<{ code: string }> };
    expect(live.plans.map((p) => p.code)).not.toContain('starter');
    expect((await editor.call('DELETE', '/plans/starter/draft')).statusCode).toBe(204);
  });
});

describe('feature flags and pilot cohorts', () => {
  const flagOf = async (c: Console, key: string) =>
    ((await c.get('/flags')).json() as { items: Array<Record<string, unknown>> }).items.find(
      (f) => f.key === key,
    )!;

  it('lists registry flags off by default and evaluates per org, cohort and percentage', async () => {
    const { browser } = await signUp(t.app, 'flags');
    await createOrg(browser, 'Flag Pilot Builders');
    await createOrg(browser, 'Flag Other Builders');
    const owner = await staff(['owner']);
    const orgs = (
      (await owner.get('/orgs?q=flag%20')).json() as {
        items: Array<{ orgId: string; name: string }>;
      }
    ).items;
    const pilot = orgs.find((o) => o.name === 'Flag Pilot Builders')!;
    const other = orgs.find((o) => o.name === 'Flag Other Builders')!;

    const key = 'nova_estimating';
    expect(await flagOf(owner, key)).toMatchObject({ enabledForAll: false, percent: 0, orgs: [] });

    const support = await staff(['support']);
    // A single org is a within-limit change for support, and it needs a reason.
    expect(
      (
        await support.put(`/flags/${key}`, {
          scope: 'org',
          orgId: pilot.orgId,
          on: true,
          reason: 'x',
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await support.put(`/flags/${key}`, {
          scope: 'org',
          orgId: pilot.orgId,
          on: true,
          reason: 'Pilot builder asked for it',
        })
      ).statusCode,
    ).toBe(200);
    expect(await flagOf(support, key)).toMatchObject({
      orgs: [{ orgId: pilot.orgId, name: 'Flag Pilot Builders' }],
      lastChange: { summary: 'Turned on for Flag Pilot Builders', by: expect.any(String) },
    });

    // The kernel-side evaluation sees the rule: on for the pilot org, off for the other.
    const isOn = t.modules.backoffice.api.flags.isOn;
    expect(await isOn(key, decodeId('org', pilot.orgId)!)).toBe(true);
    expect(await isOn(key, decodeId('org', other.orgId)!)).toBe(false);

    // Cohorts: create, add the other org, turn the flag on for the cohort, then remove the org.
    const cohort = (
      await support.post('/cohorts', { name: 'Flag Pilot Builders Group' })
    ).json() as {
      id: string;
    };
    expect(code(await support.post('/cohorts', { name: 'flag pilot builders group' }))).toBe(
      'backoffice.cohort_exists',
    );
    expect(
      (await support.post(`/cohorts/${cohort.id}/members`, { orgId: other.orgId })).statusCode,
    ).toBe(200);
    await support.put(`/flags/${key}`, {
      scope: 'cohort',
      cohortId: cohort.id,
      on: true,
      reason: 'Pilot cohort rollout',
    });
    const list = (await support.get('/cohorts')).json() as {
      items: Array<{ id: string; members: Array<{ name: string }> }>;
    };
    expect(list.items.find((c) => c.id === cohort.id)!.members.map((m) => m.name)).toEqual([
      'Flag Other Builders',
    ]);
    expect(
      (await support.call('DELETE', `/cohorts/${cohort.id}/members/${other.orgId}`)).statusCode,
    ).toBe(204);

    expect(await isOn(key, decodeId('org', pilot.orgId)!)).toBe(true);

    // Cohort changes are audited too: they change which orgs a flag reaches.
    const audit = await t.adminDb.db.execute(
      sql`select summary from backoffice.flag_changes where cohort_id = ${cohort.id} order by created_at, id`,
    );
    expect((audit.rows as Array<{ summary: string }>).map((r) => r.summary)).toEqual([
      'Created cohort Flag Pilot Builders Group',
      'Added Flag Other Builders to cohort Flag Pilot Builders Group',
      'Removed Flag Other Builders from cohort Flag Pilot Builders Group',
    ]);

    // Kill switch: no approval, everything off, and it is logged.
    const kill = await support.post(`/flags/${key}/kill`, { reason: 'Pilot paused after a bug' });
    expect(kill.statusCode).toBe(200);
    expect(await isOn(key, decodeId('org', pilot.orgId)!)).toBe(false);
    expect(await flagOf(support, key)).toMatchObject({
      orgs: [],
      cohorts: [],
      enabledForAll: false,
      lastChange: { reason: 'Pilot paused after a bug' },
    });
  });

  it('serves the org its own flags and gates flagged routes on them', async () => {
    const { browser } = await signUp(t.app, 'flag-routes');
    const org = await createOrg(browser, 'Flag Routes Builders');
    const project = await createProject(browser, org.id);
    const key = 'nova_estimating';
    const flags = async () =>
      (
        (await browser.get(`/v1/orgs/${org.id}/feature-flags`)).json() as {
          flags: Record<string, boolean>;
        }
      ).flags;
    const detect = () =>
      browser.post(`/v1/orgs/${org.id}/projects/${project.id}/ai/takeoff-detections`, {
        revisionId: `drv_${'0'.repeat(26)}`,
        target: { kind: 'count', what: 'power points' },
      });

    // Every registry flag is listed, off by default, and the flagged route looks like it does not exist.
    expect(await flags()).toEqual({
      nova_estimating: false,
      photo_progress_flags: false,
      subcontractor_wallet: false,
    });
    const off = await detect();
    expect(off.statusCode).toBe(404);
    expect(code(off)).toBe('feature-unavailable');

    // Turning it on for this org flips both the listing and the route; other flags stay off.
    const support = await staff(['support']);
    await support.put(`/flags/${key}`, {
      scope: 'org',
      orgId: org.id,
      on: true,
      reason: 'Pilot builder asked for it',
    });
    expect((await flags())[key]).toBe(true);
    expect((await flags()).subcontractor_wallet).toBe(false);
    expect(code(await detect())).not.toBe('feature-unavailable');

    // The kill switch takes it away again at once.
    await support.post(`/flags/${key}/kill`, { reason: 'Pilot paused after a bug' });
    expect((await flags())[key]).toBe(false);
    expect(code(await detect())).toBe('feature-unavailable');

    // Signed-out callers cannot read it.
    const anon = await t.app.inject({
      method: 'GET',
      url: `/v1/orgs/${org.id}/feature-flags`,
      headers: { host: 'app.archova.test' },
    });
    expect(anon.statusCode).toBe(401);
  });

  it('keeps all-orgs and percentage rollouts to an Owner with a fresh password check', async () => {
    const key = 'photo_progress_flags';
    const support = await staff(['support']);
    const denied = await support.put(`/flags/${key}`, {
      scope: 'all',
      on: true,
      reason: 'Launch it everywhere',
    });
    expect(denied.statusCode).toBe(403);
    expect(code(denied)).toBe('backoffice.owner_required');

    const owner = await staff(['owner']);
    expect(
      (await owner.put(`/flags/${key}`, { scope: 'percent', percent: 150, reason: 'Too high' }))
        .statusCode,
    ).toBe(422);
    expect(
      (await owner.put(`/flags/${key}`, { scope: 'percent', percent: 25, reason: 'Gradual start' }))
        .statusCode,
    ).toBe(200);
    expect(await flagOf(owner, key)).toMatchObject({ percent: 25 });
    expect(
      (await owner.put('/flags/not_a_flag', { scope: 'all', on: true, reason: 'No flag' }))
        .statusCode,
    ).toBe(404);
    await owner.post(`/flags/${key}/kill`, { reason: 'Reset after test' });
  });

  it('is read-only for roles without flag edit', async () => {
    const reader = await staff(['finance_read']);
    expect((await reader.get('/flags')).statusCode).toBe(200);
    const res = await reader.post('/cohorts', { name: 'Not allowed' });
    expect(res.statusCode).toBe(403);
  });
});

describe('customer account actions', () => {
  async function company(label: string) {
    const { browser } = await signUp(t.app, label);
    const org = await createOrg(browser, `Account ${label} Builders`);
    const project = await createProject(browser, org.id, { name: 'Wharf St', state: 'QLD' });
    const owner = await staff(['owner']);
    const found = (
      (await owner.get(`/orgs?q=${encodeURIComponent(`Account ${label}`)}`)).json() as {
        items: Array<{ orgId: string }>;
      }
    ).items[0]!;
    return {
      browser,
      owner,
      orgRef: found.orgId,
      attendance: `/v1/orgs/${org.id}/projects/${project.id}/attendance/sites`,
      projects: `/v1/orgs/${org.id}/projects`,
      orgId: org.id,
    };
  }
  const act = (c: Console, orgRef: string, action: string, body: Record<string, unknown>) =>
    c.post(`/orgs/${orgRef}/actions/${action}`, {
      reason: 'Customer asked in the ticket',
      ticketRef: 'SUP-101',
      ...body,
    });

  it('grants Nova credits for the month, needs the credits permission and step-up, and logs it', async () => {
    const c = await company('credits');
    const sales = await staff(['sales']);
    expect(
      (await act(sales, c.orgRef, 'grant-credits', { credits: 20, kind: 'goodwill' })).statusCode,
    ).toBe(403);
    const ops = await staff(['billing_ops']);
    await ops.post('/auth/step-up', { password: PASSWORD });
    expect(
      (await act(ops, c.orgRef, 'grant-credits', { credits: 5000, kind: 'top_up' })).statusCode,
    ).toBe(422);
    const res = await act(ops, c.orgRef, 'grant-credits', { credits: 20, kind: 'goodwill' });
    expect(res.statusCode, res.body).toBe(200);
    const detail = res.json() as { actions: Array<{ kind: string; summary: string }> };
    expect(detail.actions[0]).toMatchObject({ kind: 'credits.grant' });
    expect(detail.actions[0]!.summary).toMatch(/20 Nova credits/);

    // The customer's admins see the action in their own words, without the reason or the staff member.
    const seen = await c.browser.get(`/v1/orgs/${c.orgId}/staff-actions`);
    expect(seen.statusCode, seen.body).toBe(200);
    const items = (seen.json() as { items: Array<Record<string, string>> }).items;
    expect(items[0]).toMatchObject({
      kind: 'credits.grant',
      ticketRef: 'SUP-101',
      summary: expect.stringMatching(/^Archova staff added 20 Nova credits/),
    });
    expect(JSON.stringify(items)).not.toMatch(/Customer asked in the ticket/);
    expect(Object.keys(items[0]!).sort()).toEqual(['at', 'id', 'kind', 'summary', 'ticketRef']);
    const stranger = await signUp(t.app, 'stranger-actions');
    expect(
      (await stranger.browser.get(`/v1/orgs/${c.orgId}/staff-actions`)).statusCode,
    ).toBeGreaterThanOrEqual(403);
    const usage = await c.browser.get(`${c.projects.replace('/projects', '')}/ai/usage`);
    expect(usage.json()).toMatchObject({ granted: 20 });
  });

  it('extends a trial within the limits, with a reason and ticket, and logs it', async () => {
    const c = await company('trial');
    const support = await staff(['support']);
    expect(
      (await support.post(`/orgs/${c.orgRef}/actions/trial-extend`, { days: 10 })).statusCode,
    ).toBe(422);
    expect((await act(support, c.orgRef, 'trial-extend', { days: 31 })).statusCode).toBe(422);
    const res = await act(support, c.orgRef, 'trial-extend', { days: 30 });
    expect(res.statusCode, res.body).toBe(200);
    const detail = res.json() as {
      account: { plan: string; trialExtendedDays: number };
      actions: Array<{ kind: string; ticketRef: string; summary: string }>;
    };
    expect(detail.account).toMatchObject({ plan: 'trial', trialExtendedDays: 30 });
    expect(detail.actions[0]).toMatchObject({ kind: 'trial.extend', ticketRef: 'SUP-101' });
    // 30 + 30 + 30 + 30 = 120 is allowed; the fifth extension needs an Owner.
    for (let n = 0; n < 3; n++)
      expect((await act(support, c.orgRef, 'trial-extend', { days: 30 })).statusCode).toBe(200);
    const over = await act(support, c.orgRef, 'trial-extend', { days: 1 });
    expect(over.statusCode).toBe(422);
    expect(code(over)).toBe('backoffice.trial_limit');
    expect((await act(c.owner, c.orgRef, 'trial-extend', { days: 1 })).statusCode).toBe(200);
  });

  it('moves a company to a plan, which changes its entitlements, and refuses a downgrade', async () => {
    const c = await company('plan');
    expect((await c.browser.get(c.attendance)).statusCode).toBe(200);

    const sales = await staff(['sales']);
    // Plan changes need a fresh password check, and support cannot make them.
    expect(
      (await act(await staff(['support']), c.orgRef, 'change-plan', { planCode: 'team' }))
        .statusCode,
    ).toBe(403);
    expect((await act(sales, c.orgRef, 'change-plan', { planCode: 'nope' })).statusCode).toBe(404);
    const team = await act(sales, c.orgRef, 'change-plan', { planCode: 'team' });
    expect(team.statusCode, team.body).toBe(200);
    expect(team.json()).toMatchObject({ plan: 'team', state: 'active' });
    // The Team plan has no workforce module.
    const denied = await c.browser.get(c.attendance);
    expect(denied.statusCode).toBe(403);
    expect(code(denied)).toBe('entitlement-required');

    const business = await act(sales, c.orgRef, 'change-plan', { planCode: 'business' });
    expect(business.statusCode, business.body).toBe(200);
    expect((await c.browser.get(c.attendance)).statusCode).toBe(200);

    const down = await act(sales, c.orgRef, 'change-plan', { planCode: 'team' });
    expect(down.statusCode).toBe(422);
    expect(code(down)).toBe('backoffice.downgrade_at_term_end');
  });

  it('suspends and reactivates: only an Owner or Security lead, read-only while suspended', async () => {
    const c = await company('susp');
    expect((await c.browser.post(c.projects, { name: 'Before', state: 'QLD' })).statusCode).toBe(
      201,
    );

    const support = await staff(['support']);
    expect((await act(support, c.orgRef, 'suspend', { category: 'abuse' })).statusCode).toBe(403);
    // Non-payment is not a suspension reason.
    expect((await act(c.owner, c.orgRef, 'suspend', { category: 'non_payment' })).statusCode).toBe(
      422,
    );

    const lead = await staff(['security_lead']);
    // A Security lead suspends only for a security emergency.
    expect((await act(lead, c.orgRef, 'suspend', { category: 'fraud' })).statusCode).toBe(403);
    const done = await act(lead, c.orgRef, 'suspend', { category: 'security' });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json()).toMatchObject({
      account: { state: 'suspended', suspended: { category: 'security' } },
      actions: [{ summary: 'Suspended (security) by security lead' }],
    });
    expect(code(await act(lead, c.orgRef, 'suspend', { category: 'security' }))).toBe(
      'backoffice.already_suspended',
    );
    // Reads still work; writes stop.
    expect((await c.browser.get(c.projects)).statusCode).toBe(200);
    const blocked = await c.browser.post(c.projects, { name: 'During', state: 'QLD' });
    expect(blocked.statusCode).toBe(403);
    expect(code(blocked)).toBe('org.read_only');
    expect(
      ((await c.owner.get('/orgs?q=Account%20susp')).json() as { items: Array<{ state: string }> })
        .items[0]!.state,
    ).toBe('suspended');

    expect((await act(lead, c.orgRef, 'reactivate', {})).statusCode).toBe(200);
    expect((await c.browser.post(c.projects, { name: 'After', state: 'QLD' })).statusCode).toBe(
      201,
    );
    expect(code(await act(lead, c.orgRef, 'reactivate', {}))).toBe('backoffice.not_suspended');
  });

  it('fails closed for a plan with no version, and keeps a retired plan for companies on it', async () => {
    const c = await company('ghost');
    const orgUuid = decodeId('org', c.orgRef)!;
    await t.adminDb.db.execute(sql`
      insert into billing.org_accounts (id, plan_code, state) values (${orgUuid}, 'ghost_plan', 'active')`);
    const denied = await c.browser.get(c.attendance);
    expect(denied.statusCode).toBe(403);
    expect(code(denied)).toBe('entitlement-required');
    expect(code(await c.browser.post(c.projects, { name: 'Nope', state: 'QLD' }))).toBe(
      'org.read_only',
    );

    // A plan retired from sale still gives its latest version to companies already on it.
    const db = t.adminDb.db;
    await db.execute(sql`insert into billing.plans (code, sort_order) values ('legacy_plan', 5)`);
    await db.execute(sql`
      insert into billing.plan_versions
        (id, plan_code, version, status, name, blurb, features, modules, ai_credits_monthly, cta_label, cta_href)
      values (gen_random_uuid(), 'legacy_plan', 1, 'retired', 'Legacy', 'Old plan', '{}', array['workforce'], 10, 'Ask', '/demo')`);
    await db.execute(
      sql`update billing.org_accounts set plan_code = 'legacy_plan' where id = ${orgUuid}`,
    );
    expect((await c.browser.get(c.attendance)).statusCode).toBe(200);
  });
});

describe('support access', () => {
  async function company(label: string) {
    const { browser } = await signUp(t.app, label);
    const org = await createOrg(browser, `Support ${label} Builders`);
    const reader = await staff(['finance_read']);
    const found = (
      (await reader.get(`/orgs?q=${encodeURIComponent(`Support ${label}`)}`)).json() as {
        items: Array<{ orgId: string }>;
      }
    ).items[0]!;
    return {
      browser,
      orgId: org.id,
      orgRef: found.orgId,
      base: `/v1/orgs/${org.id}/support-access`,
    };
  }
  const start = (c: Console, orgRef: string, ticketRef: string) =>
    c.post(`/orgs/${orgRef}/support-access/sessions`, { ticketRef });

  it('is off by default, and only an org admin can grant or see it', async () => {
    const c = await company('off');
    const support = await staff(['support']);
    const none = await start(support, c.orgRef, 'SUP-1');
    expect(none.statusCode).toBe(409);
    expect(code(none)).toBe('backoffice.no_support_grant');

    const other = await signUp(t.app, 'stranger');
    expect((await other.browser.get(c.base)).statusCode).toBeGreaterThanOrEqual(403);
    const tooLong = await c.browser.post(`${c.base}/grants`, { ticketRef: 'SUP-1', hours: 73 });
    expect(tooLong.statusCode).toBe(422);
    expect((await c.browser.get(c.base)).json()).toEqual({ grants: [], sessions: [] });
  });

  it('runs a grant, a session for the same ticket, and ends it on revoke', async () => {
    const c = await company('flow');
    const grant = await c.browser.post(`${c.base}/grants`, { ticketRef: 'SUP-42', hours: 24 });
    expect(grant.statusCode, grant.body).toBe(201);
    const g = grant.json() as { id: string; status: string; level: string };
    expect(g).toMatchObject({ status: 'active', level: 'view' });

    // Only Support and Security lead hold the permission; Owner, Sales and Finance never do.
    for (const role of ['owner', 'sales', 'finance_read'] as const) {
      const denied = await start(await staff([role]), c.orgRef, 'SUP-42');
      expect(denied.statusCode).toBe(403);
    }
    const support = await staff(['support']);
    expect(code(await start(support, c.orgRef, 'SUP-99'))).toBe(
      'backoffice.support_ticket_mismatch',
    );
    const started = await start(support, c.orgRef, 'sup-42');
    expect(started.statusCode, started.body).toBe(201);
    const session = (
      started.json() as {
        sessions: Array<{ id: string; status: string; expiresAt: string; startedAt: string }>;
      }
    ).sessions[0]!;
    expect(session.status).toBe('open');
    expect(Date.parse(session.expiresAt) - Date.parse(session.startedAt)).toBe(3_600_000);
    expect(code(await start(support, c.orgRef, 'SUP-42'))).toBe('backoffice.support_session_open');

    // The customer sees the session.
    const seen = (await c.browser.get(c.base)).json() as {
      sessions: Array<{ status: string; ticketRef: string }>;
    };
    expect(seen.sessions[0]).toMatchObject({ status: 'open', ticketRef: 'SUP-42' });

    // Revoking ends the open session at once.
    expect((await c.browser.post(`${c.base}/grants/${g.id}/revoke`, {})).statusCode).toBe(204);
    const after = (await support.get(`/orgs/${c.orgRef}/support-access`)).json() as {
      grants: Array<{ status: string }>;
      sessions: Array<{ status: string }>;
    };
    expect(after.grants[0]!.status).toBe('revoked');
    expect(after.sessions[0]!.status).toBe('revoked');
    expect(code(await start(support, c.orgRef, 'SUP-42'))).toBe('backoffice.no_support_grant');
  });

  it('lets staff end their own session, and nobody else', async () => {
    const c = await company('end');
    await c.browser.post(`${c.base}/grants`, { ticketRef: 'SUP-7', hours: 2 });
    const lead = await staff(['security_lead']);
    const s = ((await start(lead, c.orgRef, 'SUP-7')).json() as { sessions: Array<{ id: string }> })
      .sessions[0]!;
    const other = await staff(['support']);
    expect(
      (await other.post(`/orgs/${c.orgRef}/support-access/sessions/${s.id}/end`)).statusCode,
    ).toBe(404);
    const ended = await lead.post(`/orgs/${c.orgRef}/support-access/sessions/${s.id}/end`);
    expect(ended.statusCode).toBe(200);
    expect((ended.json() as { sessions: Array<{ status: string }> }).sessions[0]!.status).toBe(
      'ended',
    );
  });
  it('shows the project list only inside an open session, logs it, and shows a banner to the company', async () => {
    const c = await company('view');
    await createProject(c.browser, c.orgId, { name: 'Harbour Rd', state: 'NSW' });
    const support = await staff(['support']);
    const list = `/orgs/${c.orgRef}/support-access/projects`;

    // No grant, then a grant but no session: nothing is readable and the banner stays off.
    expect(code(await support.get(list))).toBe('backoffice.support_no_session');
    const grant = (
      await c.browser.post(`${c.base}/grants`, { ticketRef: 'SUP-9', hours: 4 })
    ).json() as { id: string };
    expect(code(await support.get(list))).toBe('backoffice.support_no_session');
    expect((await c.browser.get(`${c.base}/banner`)).json()).toEqual({
      active: false,
      since: null,
    });

    const second = await c.browser.post(`${c.base}/grants`, { ticketRef: 'SUP-10', hours: 1 });
    expect(second.statusCode).toBe(409);
    expect(code(second)).toBe('backoffice.support_grant_exists');
    await start(support, c.orgRef, 'SUP-9');
    expect((await c.browser.get(`${c.base}/banner`)).json()).toMatchObject({ active: true });
    // Another staff member has no session of their own.
    expect(code(await (await staff(['security_lead'])).get(list))).toBe(
      'backoffice.support_no_session',
    );
    const view = await support.get(list);
    expect(view.statusCode, view.body).toBe(200);
    expect((view.json() as { items: Array<{ name: string }> }).items.map((p) => p.name)).toEqual([
      'Harbour Rd',
    ]);
    const seen = (await c.browser.get(c.base)).json() as {
      sessions: Array<{ pagesViewed: number }>;
    };
    expect(seen.sessions[0]!.pagesViewed).toBe(1);

    // Withdrawing consent stops reads and clears the banner.
    expect((await c.browser.post(`${c.base}/grants/${grant.id}/revoke`, {})).statusCode).toBe(204);
    expect(code(await support.get(list))).toBe('backoffice.support_no_session');
    expect((await c.browser.get(`${c.base}/banner`)).json()).toMatchObject({ active: false });
  });

  it('lets a suspended company withdraw consent', async () => {
    const c = await company('susp');
    const grant = (
      await c.browser.post(`${c.base}/grants`, { ticketRef: 'SUP-3', hours: 2 })
    ).json() as { id: string };
    const owner = await staff(['owner']);
    const susp = await owner.post(`/orgs/${c.orgRef}/actions/suspend`, {
      category: 'security',
      reason: 'Security test',
      ticketRef: 'SUP-3',
    });
    expect(susp.statusCode, susp.body).toBe(200);
    expect(
      (await c.browser.post(`${c.base}/grants`, { ticketRef: 'SUP-4', hours: 1 })).statusCode,
    ).toBe(403);
    expect((await c.browser.post(`${c.base}/grants/${grant.id}/revoke`, {})).statusCode).toBe(204);
  });
});
