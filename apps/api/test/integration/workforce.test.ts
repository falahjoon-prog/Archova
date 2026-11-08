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

    // Deleting the pre-filled line sticks: the next sign-out does not add it back.
    const removed = await s.sm.browser.del(`${s.base}/diary/${day}/labour/${diary.labour[0].id}`);
    expect(removed.statusCode).toBe(204);
    await t.database.withTenantTx(tenantOf(s.org.id, s.pm.userId), (scope) =>
      t.modules.diary.api.applyAttendanceTotals(scope, {
        projectId: decodeId('project', s.project.id)!,
        localDate: evt!.data.localDate,
        ...totals,
      }),
    );
    expect((await s.sm.browser.get(`${s.base}/diary/${day}`)).json().labour).toHaveLength(0);
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
    // After the app is closed mid-evacuation, the supervisor finds the open roll call again, with its marks.
    const open = (await s.sub.browser.get(`${s.base}/attendance/roll-calls?open=true`)).json().data;
    expect(open.map((c: { id: string }) => c.id)).toEqual([call.id]);
    expect(open[0].counts).toMatchObject({ accountedFor: 1, unmarked: 1 });
    const ended = await s.sm.browser.post(`${s.base}/attendance/roll-calls/${call.id}/end`);
    expect(ended.json().endedAt).toBeTruthy();
    const none = (await s.sub.browser.get(`${s.base}/attendance/roll-calls?open=true`)).json().data;
    expect(none).toEqual([]);
    const closed = (await s.sm.browser.get(`${s.base}/attendance/roll-calls?open=false`)).json()
      .data;
    expect(closed.map((c: { id: string }) => c.id)).toEqual([call.id]);
    expect((await s.sm.browser.get(`${s.base}/attendance/roll-calls?open=maybe`)).statusCode).toBe(
      422,
    );
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

describe('Rosters (ATT-US11)', () => {
  const day = (h: number) => `2030-03-04T${String(h).padStart(2, '0')}:00:00Z`;

  it('drafts, assigns, publishes and answers a shift, with company scoping and overlap checks', async () => {
    const s = await setup('roster');
    const mk = async (browser: typeof s.sm.browser, fullName: string, companyId: string) => {
      const r = await browser.post(`${s.base}/workers`, { fullName, companyId });
      expect(r.statusCode).toBe(201);
      return r.json().id as string;
    };
    const w1 = await mk(s.sm.browser, 'Dana Formworker', s.subCo.companyId);
    const w2 = await mk(s.sm.browser, 'Eli Sparky', s.sub2Co.companyId);

    // A subcontractor cannot build rosters.
    const denied = await s.sub.browser.post(`${s.base}/shifts`, {
      siteId: s.site.id,
      trade: 'Formwork',
      startsAt: day(7),
      endsAt: day(15),
      requiredHeadcount: 2,
    });
    expect(denied.statusCode).toBe(403);

    const bad = await s.sm.browser.post(`${s.base}/shifts`, {
      siteId: s.site.id,
      trade: 'Formwork',
      startsAt: day(15),
      endsAt: day(7),
      requiredHeadcount: 2,
    });
    expect(bad.statusCode).toBe(422);

    const created = await s.sm.browser.post(`${s.base}/shifts`, {
      siteId: s.site.id,
      crew: 'Slab crew',
      trade: 'Formwork',
      startsAt: day(7),
      endsAt: day(15),
      requiredHeadcount: 2,
    });
    expect(created.statusCode).toBe(201);
    const shift = created.json();
    expect(shift).toMatchObject({ status: 'draft', filled: 0, publishedAt: null });
    const sp = `${s.base}/shifts/${shift.id}`;

    // Drafts are the site manager's own.
    expect((await s.sub.browser.get(sp)).statusCode).toBe(404);

    const assigned = await s.sm.browser.post(`${sp}/assignments`, { workerIds: [w1, w2] });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json()).toMatchObject({ filled: 2 });
    expect(
      assigned.json().assignments.every((a: { notifiedAt: unknown }) => a.notifiedAt === null),
    ).toBe(true);

    // The same person can't be on an overlapping shift; back to back is fine.
    const second = (
      await s.sm.browser.post(`${s.base}/shifts`, {
        siteId: s.site.id,
        trade: 'Formwork',
        startsAt: day(14),
        endsAt: day(18),
        requiredHeadcount: 1,
      })
    ).json();
    const clash = await s.sm.browser.post(`${s.base}/shifts/${second.id}/assignments`, {
      workerIds: [w1],
    });
    expect(clash.statusCode).toBe(409);

    const published = await s.sm.browser.post(`${sp}/publish`);
    expect(published.statusCode).toBe(200);
    expect(published.json().status).toBe('published');
    expect((await s.sm.browser.post(`${sp}/publish`)).statusCode).toBe(409);

    // A subcontractor sees the shift but only its own worker's assignment, and answers only for them.
    const seen = (await s.sub.browser.get(sp)).json();
    expect(seen.assignments).toHaveLength(1);
    expect(seen.filled).toBe(2);
    const mine = seen.assignments[0];
    expect(mine.notifiedAt).not.toBeNull();
    const yes = await s.sub.browser.post(`${sp}/assignments/${mine.id}/respond`, {
      status: 'accepted',
    });
    expect(yes.statusCode).toBe(200);
    expect(yes.json().assignments[0].status).toBe('accepted');
    const theirs = (await s.sm.browser.get(sp))
      .json()
      .assignments.find((a: { workerId: string }) => a.workerId === w2);
    expect(
      (await s.sub.browser.post(`${sp}/assignments/${theirs.id}/respond`, { status: 'accepted' }))
        .statusCode,
    ).toBe(404);

    // Attendance is the manager's call, and only once the shift has begun (this one is in 2030).
    expect(
      (await s.sm.browser.post(`${sp}/assignments/${mine.id}/respond`, { status: 'attended' }))
        .statusCode,
    ).toBe(409);

    const listed = await s.sm.browser.get(`${s.base}/shifts?from=${day(0)}&to=${day(23)}`);
    expect(listed.json().data).toHaveLength(2);

    const cancelled = await s.sm.browser.post(`${sp}/cancel`);
    expect(cancelled.json().status).toBe('cancelled');
    expect((await s.sm.browser.post(`${sp}/assignments`, { workerIds: [w1] })).statusCode).toBe(
      409,
    );
  });
});

describe('Equipment', () => {
  it('registers a machine, refuses clashing bookings and logs hours in quarter hours', async () => {
    const s = await setup('equipment');
    const eq = `${s.base}/equipment`;

    // Only a site manager keeps the register.
    const denied = await s.sub.browser.post(eq, {
      name: 'Excavator',
      assetNumber: 'EX-1',
      type: 'Excavator',
    });
    expect(denied.statusCode).toBe(403);

    const created = await s.sm.browser.post(eq, {
      name: '5t excavator',
      assetNumber: 'EX-1',
      type: 'Excavator',
    });
    expect(created.statusCode).toBe(201);
    const e = created.json();
    expect(e).toMatchObject({ status: 'available', assetNumber: 'EX-1' });
    const dup = await s.sm.browser.post(eq, {
      name: 'Another',
      assetNumber: 'EX-1',
      type: 'Excavator',
    });
    expect(dup.statusCode).toBe(409);

    const book = (startsOn: string, endsOn: string, bookedFor: string) =>
      s.sm.browser.post(`${eq}/${e.id}/bookings`, { startsOn, endsOn, bookedFor });
    const first = await book('2030-03-04', '2030-03-06', 'Slab crew');
    expect(first.statusCode).toBe(201);
    expect((await book('2030-03-06', '2030-03-08', 'Drainer')).statusCode).toBe(409);
    expect((await book('2030-03-07', '2030-03-08', 'Drainer')).statusCode).toBe(201);
    expect((await book('2030-03-09', '2030-03-08', 'Backwards')).statusCode).toBe(422);

    // A cancelled booking frees the days.
    const cancelled = await s.sm.browser.post(`${eq}/${e.id}/bookings/${first.json().id}/cancel`);
    expect(cancelled.json().status).toBe('cancelled');
    expect((await book('2030-03-05', '2030-03-06', 'Drainer')).statusCode).toBe(201);

    const range = (
      await s.sub.browser.get(`${s.base}/equipment-bookings?from=2030-03-07&to=2030-03-07`)
    ).json().data;
    expect(range).toHaveLength(1);

    // A machine in maintenance can't be booked.
    const m = await s.sm.browser.patch(`${eq}/${e.id}`, { status: 'maintenance' });
    expect(m.json().status).toBe('maintenance');
    expect((await book('2030-04-01', '2030-04-02', 'Late')).statusCode).toBe(409);

    // Anyone with site access logs hours, in quarter hours.
    const log = (hours: string) =>
      s.sub.browser.post(`${eq}/${e.id}/logs`, { date: '2030-03-04', hours, operator: 'Pat' });
    expect((await log('7.5')).statusCode).toBe(201);
    expect((await log('7.3')).statusCode).toBe(422);
    const logs = (await s.sm.browser.get(`${eq}/${e.id}/logs`)).json().data;
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ hours: '7.50', operator: 'Pat' });
  });
});

describe('Timesheets (ATT-US9)', () => {
  it('builds a sheet from sign-ins, adjusts it with a reason, approves, locks and exports it', async () => {
    const s = await setup('timesheet');
    const startedAt = new Date(Date.now() - 3 * 3600_000).toISOString();
    const day = localDateOf(new Date(startedAt), TZ);
    const ts = `${s.base}/timesheets`;
    const range = { from: day, to: day };
    await s.sub.browser.post(`${s.base}/attendance/sign-in`, {
      gateCode: s.code,
      clientAt: startedAt,
    });
    await s.eng.browser.post(`${s.base}/attendance/sign-in`, {
      gateCode: s.code,
      clientAt: startedAt,
    });

    // Nothing to build from while they are still on site.
    expect((await s.sm.browser.post(`${ts}/generate`, range)).json()).toMatchObject({
      sheetsCreated: 0,
    });
    await s.sub.browser.post(`${s.base}/attendance/sign-out`, { gateCode: s.code });

    // A subcontractor builds only its own crew's sheets.
    const gen = await s.sub.browser.post(`${ts}/generate`, range);
    expect(gen.statusCode).toBe(200);
    expect(gen.json()).toMatchObject({ sheetsCreated: 1, linesAdded: 1 });
    expect((await s.sub.browser.post(`${ts}/generate`, range)).json()).toMatchObject({
      sheetsCreated: 0,
      linesAdded: 0,
    });

    const mine = (await s.sub.browser.get(`${ts}?from=${day}&to=${day}`)).json().data;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ status: 'draft', companyId: s.subCo.companyId });
    expect(mine[0].paidMinutes).toBeGreaterThanOrEqual(179);
    const sheet = mine[0];
    const sp = `${ts}/${sheet.id}`;
    expect((await s.sub2.browser.get(sp)).statusCode).toBe(404);

    // Changing a sign-in line needs a reason; a break can't exceed the time worked.
    const line = sheet.lines[0];
    expect(
      (await s.sub.browser.patch(`${sp}/lines/${line.id}`, { breakMinutes: 30 })).statusCode,
    ).toBe(422);
    expect(
      (await s.sub.browser.patch(`${sp}/lines/${line.id}`, { breakMinutes: 9999, reason: 'x' }))
        .statusCode,
    ).toBe(422);
    const adjusted = await s.sub.browser.patch(`${sp}/lines/${line.id}`, {
      breakMinutes: 30,
      reason: 'Half hour lunch',
    });
    expect(adjusted.statusCode).toBe(200);
    expect(adjusted.json().lines[0]).toMatchObject({ source: 'adjusted', breakMinutes: 30 });
    expect(adjusted.json().paidMinutes).toBe(sheet.paidMinutes - 30);
    const added = await s.sub.browser.post(`${sp}/lines`, {
      minutes: 60,
      reason: 'Loading out after sign-out',
    });
    expect(added.json().lines).toHaveLength(2);

    // Approving is the supervisor's job, and only after the sheet is submitted.
    expect((await s.sm.browser.post(`${sp}/approve`)).statusCode).toBe(409);
    expect((await s.sub.browser.post(`${sp}/submit`)).json().status).toBe('submitted');
    expect((await s.sub.browser.post(`${sp}/approve`)).statusCode).toBe(403);
    expect(
      (await s.sub.browser.patch(`${sp}/lines/${line.id}`, { minutes: 1, reason: 'x' })).statusCode,
    ).toBe(409);

    // A rejection reopens it with the reason; resubmit and approve.
    const rejected = await s.sm.browser.post(`${sp}/reject`, { reason: 'Lunch looks long' });
    expect(rejected.json()).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Lunch looks long',
    });
    await s.sub.browser.post(`${sp}/submit`);
    const approved = await s.sm.browser.post(`${sp}/approve`);
    expect(approved.json().status).toBe('approved');

    // Approved is locked, and building again adds nothing to it.
    expect(
      (await s.sub.browser.post(`${sp}/lines`, { minutes: 5, reason: 'late' })).statusCode,
    ).toBe(409);
    expect((await s.sm.browser.post(`${ts}/generate`, range)).json()).toMatchObject({
      linesAdded: 0,
    });

    // Only supervisors export; a sheet goes out once.
    expect((await s.sub.browser.post(`${ts}/export`, range)).statusCode).toBe(403);
    const out = await s.sm.browser.post(`${ts}/export`, range);
    expect(out.statusCode).toBe(200);
    expect(out.json().count).toBe(1);
    expect(out.json().csv).toContain('date,worker,minutes,break_minutes,paid_hours');
    expect(out.json().csv).toContain('Half hour lunch');
    expect((await s.sm.browser.post(`${ts}/export`, range)).json().count).toBe(0);
    expect((await s.sm.browser.get(sp)).json().status).toBe('exported');
  });
});

describe('digital Safety ID badge', () => {
  it('shows a worker their own badge, keeps their emergency contact, and nobody else sees it', async () => {
    const s = await setup('wf-badge');
    const url = `${s.base}/attendance/me/badge`;

    const first = await s.sub.browser.get(url);
    expect(first.statusCode).toBe(200);
    const badge = first.json();
    expect(badge.fullName).toBeTruthy();
    expect(badge.companyName).toBe('Formco');
    expect(badge.status).toBe('active');
    expect(badge.qrValue).toBe(`archova:badge:${badge.workerId}`);
    expect(badge.emergencyContact).toBeNull();
    expect(badge.photoUrl).toBeNull();
    expect(first.headers['cache-control']).toBe('no-store');

    const put = await s.sub.browser.put(`${s.base}/attendance/me/emergency-contact`, {
      contact: { name: ' Sam Tran ', relationship: 'Partner', phone: '0412 345 678' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().emergencyContact).toEqual({
      name: 'Sam Tran',
      relationship: 'Partner',
      phone: '0412345678',
    });
    expect((await s.sub.browser.get(url)).json().emergencyContact.name).toBe('Sam Tran');

    // A badge belongs to its worker: a second worker gets their own, with no contact.
    const other = (await s.sub2.browser.get(url)).json();
    expect(other.workerId).not.toBe(badge.workerId);
    expect(other.emergencyContact).toBeNull();

    // The site manager's worker list never carries the emergency contact.
    const list = await s.sm.browser.get(`${s.base}/attendance/workers`);
    expect(JSON.stringify(list.json())).not.toContain('Sam Tran');

    const bad = await s.sub.browser.put(`${s.base}/attendance/me/emergency-contact`, {
      contact: { name: 'X', phone: '12' },
    });
    expect(bad.statusCode).toBe(422);

    const cleared = await s.sub.browser.put(`${s.base}/attendance/me/emergency-contact`, {
      contact: null,
    });
    expect(cleared.json().emergencyContact).toBeNull();
  });

  it('refuses a photo that is not a ready upload of the caller', async () => {
    const s = await setup('wf-badge-photo');
    const res = await s.sub.browser.put(`${s.base}/attendance/me/photo`, {
      fileId: '0190c0de-0000-7000-8000-000000000001',
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('site clearance', () => {
  it('answers from a scanned Safety ID, and keeps one company out of another’s workers', async () => {
    const s = await setup('wf-clear');
    const badge = (await s.sub.browser.get(`${s.base}/attendance/me/badge`)).json();
    const url = `${s.base}/attendance/clearance`;

    // No white card is recorded yet, so the gate gets a blocking answer with a flag.
    const res = await s.sm.browser.get(`${url}?code=${encodeURIComponent(badge.qrValue)}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.workerId).toBe(badge.workerId);
    expect(body.companyName).toBe('Formco');
    expect(body.result).toBe('blocked');
    expect(body.checks.find((c: { key: string }) => c.key === 'white_card').status).toBe('fail');
    expect(body.flag.severity).toBe('blocking');
    expect(res.headers['cache-control']).toBe('no-store');

    // The bare worker id works too; a made-up code is a validation error.
    expect((await s.sm.browser.get(`${url}?code=${badge.workerId}`)).statusCode).toBe(200);
    expect((await s.sm.browser.get(`${url}?code=nope`)).statusCode).toBe(422);

    // Another subcontractor cannot look up this company's worker.
    expect((await s.sub2.browser.get(`${url}?code=${badge.workerId}`)).statusCode).toBe(404);
  });
});
