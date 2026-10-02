import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { decodeId } from '@archova/domain';
import { addDays, localDateOf } from '@archova/time';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

const TZ = 'Australia/Brisbane';
const today = () => localDateOf(new Date(), TZ);
const etagOf = (res: { headers: Record<string, unknown> }) => res.headers.etag as string;

async function setup(label: string) {
  const pm = await signUp(t.app, `${label}-pm`);
  const sm = await signUp(t.app, `${label}-sm`);
  const sub = await signUp(t.app, `${label}-sub`);
  const sub2 = await signUp(t.app, `${label}-sub2`);
  const eng = await signUp(t.app, `${label}-eng`);
  const org = await createOrg(pm.browser, `${label} Builder`);
  const project = await createProject(pm.browser, org.id, { name: 'Wharf St', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, sm.email, 'Site Manager', `${label} Builder`);
  const subCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    sub.email,
    'Subcontractor',
    'Formco',
  );
  const sub2Co = await addMember(
    pm.browser,
    org.id,
    project.id,
    sub2.email,
    'Subcontractor',
    'Sparky',
  );
  await addMember(pm.browser, org.id, project.id, eng.email, 'Consultant', 'Smith Engineers');
  const site = await sm.browser.post(`${base}/attendance/sites`, { name: 'Main site' });
  expect(site.statusCode).toBe(201);
  const gate = await sm.browser.post(`${base}/attendance/sites/${site.json().id}/gates`, {
    name: 'Main gate',
  });
  expect(gate.statusCode).toBe(201);
  return {
    pm,
    sm,
    sub,
    sub2,
    eng,
    org,
    project,
    base,
    subCo,
    sub2Co,
    site: site.json(),
    gate: gate.json().gate,
    gateEtag: etagOf(gate),
    code: gate.json().code as string,
  };
}

function tenantOf(orgId: string, userId: string) {
  return {
    orgId: decodeId('org', orgId)!,
    userId: decodeId('user', userId)!,
    principalType: 'member' as const,
    orgRole: 'owner' as const,
    entitlements: { plan: 'x', state: 'active' as const, modules: [], limits: {} },
    requestId: 'test',
  };
}

describe('site sign-in (product/12)', () => {
  it('signs a worker in and out with the gate code, shows the headcount and pre-fills the diary', async () => {
    const s = await setup('wf-qr');
    expect(s.code).toMatch(/^gqr_/);
    const sites = (await s.sm.browser.get(`${s.base}/attendance/sites`)).json().data;
    expect(sites[0]).toMatchObject({
      name: 'Main site',
      dayEndLocal: '19:00',
      gateCheckMode: 'block',
    });
    expect(sites[0].gates[0]).toMatchObject({ name: 'Main gate', qrVersion: 1 });
    expect(JSON.stringify(sites)).not.toContain(s.code);

    const startedAt = new Date(Date.now() - 3 * 3600_000).toISOString();
    // Sessions belong to the site-local day they started on, which can be yesterday just after midnight.
    const day = localDateOf(new Date(startedAt), TZ);
    const signedIn = await s.sub.browser.post(`${s.base}/attendance/sign-in`, {
      gateCode: s.code,
      clientAt: startedAt,
    });
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.json()).toMatchObject({
      outcome: 'accepted',
      eligibility: { result: 'eligible', reasons: [] },
      session: { status: 'on_site', companyId: s.subCo.companyId, signedInAt: startedAt },
      worker: { userId: s.sub.userId, companyId: s.subCo.companyId, kind: 'worker' },
    });
    const again = await s.sub.browser.post(`${s.base}/attendance/sign-in`, { gateCode: s.code });
    expect(again.json().outcome).toBe('already_on_site');
    // A consultant can sign in too, but can't see who else is on site.
    expect(
      (
        await s.eng.browser.post(`${s.base}/attendance/sign-in`, {
          gateCode: s.code,
          clientAt: startedAt,
        })
      ).json().outcome,
    ).toBe('accepted');
    expect((await s.eng.browser.get(`${s.base}/attendance/on-site`)).statusCode).toBe(403);

    const onSite = (await s.sm.browser.get(`${s.base}/attendance/on-site`)).json();
    expect(onSite.total).toBe(2);
    expect(onSite.companies).toEqual(
      expect.arrayContaining([{ companyId: s.subCo.companyId, companyNameOther: null, count: 1 }]),
    );
    // The subcontractor sees only their own crew.
    const own = (await s.sub.browser.get(`${s.base}/attendance/on-site`)).json();
    expect(own.total).toBe(1);

    const out = await s.sub.browser.post(`${s.base}/attendance/sign-out`, { gateCode: s.code });
    expect(out.statusCode).toBe(200);
    expect(out.json()).toMatchObject({ status: 'off_site' });
    expect(out.json().minutes).toBeGreaterThanOrEqual(179);
    expect((await s.sub.browser.post(`${s.base}/attendance/sign-out`, {})).json().code).toBe(
      'attendance.not_on_site',
    );

    const sessions = (await s.sm.browser.get(`${s.base}/attendance/sessions?date=${day}`)).json()
      .data;
    expect(sessions).toHaveLength(2);

    // The session_closed event carries the company's totals for the day; the diary subscriber files them.
    const orgUuid = decodeId('org', s.org.id)!;
    const [evt] = (
      await t.adminDb.withTenantTx(tenantOf(s.org.id, s.pm.userId), ({ tx }) =>
        tx.execute(sql`select data from shared.outbox
                       where org_id = ${orgUuid} and type = 'workforce.attendance.session_closed.v1'`),
      )
    ).rows as Array<{
      data: {
        dayTotals: { companyId: string; headcount: number; hours: number };
        localDate: string;
      };
    }>;
    const totals = evt!.data.dayTotals;
    expect(totals).toMatchObject({
      companyId: decodeId('company', s.subCo.companyId),
      headcount: 1,
    });
    await t.database.withTenantTx(tenantOf(s.org.id, s.pm.userId), (scope) =>
      t.modules.diary.api.applyAttendanceTotals(scope, {
        projectId: decodeId('project', s.project.id)!,
        localDate: evt!.data.localDate,
        ...totals,
      }),
    );
    expect(evt!.data.localDate).toBe(day);
    const diary = (await s.sm.browser.get(`${s.base}/diary/${day}`)).json();
    expect(diary.labour[0]).toMatchObject({
      companyId: s.subCo.companyId,
      source: 'attendance',
      headcount: 1,
      attendanceHeadcount: 1,
      hours: totals.hours,
    });
  });

  it('reissues a gate code, which stops the old poster working', async () => {
    const s = await setup('wf-reissue');
    const re = await s.sm.browser.post(
      `${s.base}/attendance/gates/${s.gate.id}/reissue`,
      undefined,
      {
        'if-match': s.gateEtag,
      },
    );
    expect(re.statusCode).toBe(200);
    expect(re.json().gate.qrVersion).toBe(2);
    expect(re.json().code).not.toBe(s.code);
    const old = await s.sub.browser.post(`${s.base}/attendance/sign-in`, { gateCode: s.code });
    expect(old.json().code).toBe('gate.invalid_code');
    const fresh = await s.sub.browser.post(`${s.base}/attendance/sign-in`, {
      gateCode: re.json().code,
    });
    expect(fresh.json().outcome).toBe('accepted');
    // Subcontractors can't manage gates.
    expect(
      (await s.sub.browser.post(`${s.base}/attendance/sites/${s.site.id}/gates`, { name: 'Hoist' }))
        .statusCode,
    ).toBe(403);
  });

  it('blocks ineligible workers at the gate, lets a site manager admit them, and warns in warn mode', async () => {
    const s = await setup('wf-gate');
    const w = await s.sm.browser.post(`${s.base}/workers`, {
      fullName: 'Pat Labourer',
      companyId: s.subCo.companyId,
      phone: '0400 000 000',
    });
    expect(w.statusCode).toBe(201);
    const inactive = await s.sm.browser.patch(
      `${s.base}/workers/${w.json().id}`,
      { status: 'inactive' },
      { 'if-match': etagOf(w) },
    );
    const blocked = await s.sm.browser.post(`${s.base}/attendance/events`, {
      workerId: w.json().id,
      siteId: s.site.id,
      kind: 'sign_in',
    });
    expect(blocked.json()).toMatchObject({
      outcome: 'blocked',
      session: null,
      eligibility: { result: 'blocked', reasons: [{ code: 'worker.inactive', blocking: true }] },
    });
    const admitted = await s.sm.browser.post(`${s.base}/attendance/events`, {
      workerId: w.json().id,
      siteId: s.site.id,
      kind: 'sign_in',
      overrideReason: 'Re-engaged this morning; paperwork to follow',
    });
    expect(admitted.json()).toMatchObject({
      outcome: 'overridden',
      session: { status: 'on_site' },
    });
    expect(
      (
        await s.sm.browser.post(`${s.base}/attendance/events`, {
          workerId: w.json().id,
          kind: 'sign_out',
        })
      ).json(),
    ).toMatchObject({ outcome: 'signed_out', session: { status: 'off_site' } });

    // Warn mode lets the worker in and shows the reasons.
    const site = await s.sm.browser.get(`${s.base}/attendance/sites`);
    await s.sm.browser.patch(
      `${s.base}/attendance/sites/${s.site.id}`,
      { gateCheckMode: 'warn' },
      { 'if-match': `"${site.json().data[0].version}"` },
    );
    const warned = await s.sm.browser.post(`${s.base}/attendance/events`, {
      workerId: w.json().id,
      siteId: s.site.id,
      kind: 'sign_in',
    });
    expect(warned.json()).toMatchObject({
      outcome: 'accepted',
      eligibility: { result: 'warning' },
    });

    // A company typed at the gate is a warning until the site manager confirms it.
    const other = await s.sm.browser.post(`${s.base}/workers`, {
      fullName: 'Lee Visitor',
      companyNameOther: 'Joe Plumbing',
    });
    expect(other.json()).toMatchObject({ companyId: null, companyNameOther: 'Joe Plumbing' });
    const confirmed = await s.sm.browser.patch(
      `${s.base}/workers/${other.json().id}`,
      { companyId: s.sub2Co.companyId },
      { 'if-match': etagOf(other) },
    );
    expect(confirmed.json()).toMatchObject({
      companyId: s.sub2Co.companyId,
      companyNameOther: null,
    });

    // Events are evidence: the database refuses to change them.
    await expect(
      t.database.withTenantTx(tenantOf(s.org.id, s.pm.userId), ({ tx }) =>
        tx.execute(sql`update workforce.attendance_events set outcome = 'accepted'`),
      ),
    ).rejects.toThrow();
    expect(inactive.statusCode).toBe(200);
  });

  it('keeps subcontractors to their own workers', async () => {
    const s = await setup('wf-scope');
    const own = await s.sub.browser.post(`${s.base}/workers`, { fullName: 'Formco Hand' });
    expect(own.statusCode).toBe(201);
    expect(own.json().companyId).toBe(s.subCo.companyId);
    const foreign = await s.sub.browser.post(`${s.base}/workers`, {
      fullName: 'Not Mine',
      companyId: s.sub2Co.companyId,
    });
    expect(foreign.statusCode).toBe(403);
    await s.sm.browser.post(`${s.base}/workers`, {
      fullName: 'Sparky Hand',
      companyId: s.sub2Co.companyId,
    });
    const listed = (await s.sub.browser.get(`${s.base}/workers`)).json().data;
    expect(listed.map((w: { fullName: string }) => w.fullName)).toEqual(['Formco Hand']);
    expect(listed[0].phone).toBeNull();
    // The site manager sees phone numbers; other orgs see nothing.
    const outsider = await signUp(t.app, 'wf-outsider');
    await createOrg(outsider.browser, 'Elsewhere');
    expect((await outsider.browser.get(`${s.base}/workers`)).statusCode).toBe(404);
  });

  it('runs an evacuation roll call from who is on site', async () => {
    const s = await setup('wf-roll');
    await s.sub.browser.post(`${s.base}/attendance/sign-in`, { gateCode: s.code });
    await s.sub2.browser.post(`${s.base}/attendance/sign-in`, { gateCode: s.code });
    const started = await s.sm.browser.post(`${s.base}/attendance/roll-calls`, {
      reason: 'Fire alarm, level 2',
    });
    expect(started.statusCode).toBe(201);
    const call = started.json();
    expect(call.counts).toEqual({ total: 2, accountedFor: 0, missing: 0, unmarked: 2 });
    const subWorker = call.people.find(
      (p: { companyId: string }) => p.companyId === s.subCo.companyId,
    );
    // A subcontractor supervisor ticks their own crew from their phone.
    const marked = await s.sub.browser.post(`${s.base}/attendance/roll-calls/${call.id}/marks`, {
      workerId: subWorker.workerId,
      status: 'accounted_for',
    });
    expect(marked.json().counts).toMatchObject({ accountedFor: 1, unmarked: 1 });
    const ended = await s.sm.browser.post(`${s.base}/attendance/roll-calls/${call.id}/end`);
    expect(ended.json().endedAt).toBeTruthy();
    const late = await s.sm.browser.post(`${s.base}/attendance/roll-calls/${call.id}/marks`, {
      workerId: subWorker.workerId,
      status: 'missing',
    });
    expect(late.json().code).toBe('roll_call.ended');
  });

  it('closes sessions left open after the day end, flagged as not exact', async () => {
    const s = await setup('wf-auto');
    const yesterday = addDays(today(), -1);
    await s.sub.browser.post(`${s.base}/attendance/sign-in`, {
      gateCode: s.code,
      clientAt: `${yesterday}T07:00:00+10:00`,
    });
    const closed = await t.database.withTenantTx(tenantOf(s.org.id, s.pm.userId), (scope) =>
      t.modules.workforce.api.closeOverdueSessions(scope),
    );
    expect(closed).toBe(1);
    const day = (await s.sm.browser.get(`${s.base}/attendance/sessions?date=${yesterday}`)).json()
      .data;
    expect(day[0].session).toMatchObject({
      status: 'auto_closed',
      signedOutAt: new Date(`${yesterday}T19:00:00+10:00`).toISOString(),
      minutes: 720,
    });
  });
});
