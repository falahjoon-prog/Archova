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
  uploadFile,
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
  const other = await signUp(t.app, `${label}-other`);
  const org = await createOrg(pm.browser, `${label} Builder`);
  const project = await createProject(pm.browser, org.id, { name: 'Wharf St', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}/diary`;
  await addMember(pm.browser, org.id, project.id, sm.email, 'Site Manager', `${label} Builder`);
  const subCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    sub.email,
    'Subcontractor',
    'Formco',
  );
  const otherCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    other.email,
    'Subcontractor',
    'Sparky',
  );
  return { pm, sm, sub, other, org, project, base, subCo, otherCo };
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

describe('site diary (product/05)', () => {
  it('builds a draft day with labour, delays and stand-downs, with live totals', async () => {
    const s = await setup('dia-draft');
    const day = addDays(today(), -1);
    const photo = await uploadFile(t, s.sm.browser, s.org.id, s.project.id, 'pour.jpg', 'diary');

    const created = await s.sm.browser.put(`${s.base}/${day}`, {
      siteConditions: 'Wet underfoot after overnight rain',
      notes: 'Level 3 pour delayed to 10am.',
      weatherOverride: { rainfallMm: 12.5, conditions: { am: 'Showers' } },
      fileIds: [photo],
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().entry).toMatchObject({
      date: day,
      status: 'draft',
      notes: 'Level 3 pour delayed to 10am.',
      weather: null,
      weatherOverride: { rainfallMm: 12.5 },
      fileIds: [photo],
      isLate: false,
    });

    // Once the day exists, header saves need If-Match.
    const blind = await s.sm.browser.put(`${s.base}/${day}`, { notes: 'x' });
    expect(blind.statusCode).toBe(428);

    const l1 = await s.sm.browser.post(`${s.base}/${day}/labour`, {
      companyId: s.subCo.companyId,
      trade: 'Formwork',
      headcount: 6,
      hours: 45.5,
    });
    expect(l1.statusCode).toBe(201);
    expect(l1.json()).toMatchObject({ companyId: s.subCo.companyId, source: 'manual', version: 1 });
    expect(l1.json().id).toMatch(/^dlb_/);
    await s.sm.browser.post(`${s.base}/${day}/labour`, {
      companyId: s.otherCo.companyId,
      trade: 'Electrical',
      headcount: 2,
      hours: 16,
    });
    const weather = await s.sm.browser.post(`${s.base}/${day}/delays`, {
      type: 'weather',
      description: 'Rain stopped the pour',
      hours: 2,
      affectedCompanyIds: [s.subCo.companyId],
    });
    expect(weather.json()).toMatchObject({ isEotCandidate: true, hours: 2 });
    const subDelay = await s.sm.browser.post(`${s.base}/${day}/delays`, {
      type: 'subcontractor',
      description: 'Pump arrived late',
      hours: 1.5,
    });
    expect(subDelay.json().isEotCandidate).toBe(false);
    const stand = await s.sm.browser.post(`${s.base}/${day}/stand-downs`, {
      startTime: '07:00',
      endTime: '09:30',
      affectedCompanyIds: [s.subCo.companyId],
      reason: 'Inclement weather under the site agreement',
    });
    expect(stand.json()).toMatchObject({ startTime: '07:00', endTime: '09:30' });
    const visitor = await s.sm.browser.post(`${s.base}/${day}/visitors`, {
      name: 'J. Inspector',
      company: 'Council',
      timeIn: '11:00',
    });
    expect(visitor.statusCode).toBe(201);

    const unknownCo = await s.sm.browser.post(`${s.base}/${day}/labour`, {
      companyId: 'cmp_00000000000000000000000000',
      headcount: 1,
    });
    expect(unknownCo.json().code).toBe('company.not_found');

    const detail = (await s.sm.browser.get(`${s.base}/${day}`)).json();
    expect(detail.entry.totals).toEqual({
      labourCompanies: 2,
      labourHeadcount: 8,
      labourHours: 61.5,
      delayHours: 3.5,
    });
    expect(detail.labour).toHaveLength(2);
    expect(detail.delays).toHaveLength(2);

    // `dayForSummary` (ai F4): internal ids, company names, weather lost hours; scoped readers see their own lines.
    const projectUuid = decodeId('project', s.project.id)!;
    const forSummary = (userId: string, orgRole: 'owner' | 'member' = 'owner') =>
      t.database.withTenantTx({ ...tenantOf(s.org.id, userId), orgRole }, (scope) =>
        t.modules.diary.api.dayForSummary(scope, projectUuid, day),
      );
    const full = await forSummary(s.pm.userId);
    expect(full).toMatchObject({ date: day, status: 'draft', weather: { lostHours: 2 } });
    expect(full!.entryId).toBe(decodeId('diary', detail.entry.id));
    expect(full!.lines.filter((l) => l.kind === 'labour')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ company: 'Formco', headcount: 6, hours: 45.5, text: 'Formwork' }),
      ]),
    );
    expect(full!.lines.find((l) => l.kind === 'delay' && l.hours === 2)).toMatchObject({
      delayCause: 'weather',
    });
    expect(full!.lines.find((l) => l.kind === 'visitor')).toMatchObject({
      company: 'Council',
      at: '11:00',
    });
    const scoped = await forSummary(s.sub.userId, 'member');
    expect(scoped!.lines.map((l) => l.kind)).toEqual(['labour']);
    expect(scoped!.lines[0]!.company).toBe('Formco');
    await expect(
      t.database.withTenantTx(tenantOf(s.org.id, s.pm.userId), (scope) =>
        t.modules.diary.api.dayForSummary(scope, projectUuid, addDays(day, -400)),
      ),
    ).resolves.toBeNull();
    expect(detail.standDowns).toHaveLength(1);
    expect(detail.visitors[0]).toMatchObject({
      name: 'J. Inspector',
      timeIn: '11:00',
      timeOut: null,
    });
    expect(detail.amendments).toEqual([]);

    // Draft edits and removals need no reason and leave no amendments.
    const edited = await s.sm.browser.patch(
      `${s.base}/${day}/labour/${l1.json().id}`,
      { headcount: 7 },
      { 'if-match': etagOf(l1) },
    );
    expect(edited.json()).toMatchObject({ headcount: 7, version: 2 });
    expect(
      (await s.sm.browser.del(`${s.base}/${day}/visitors/${visitor.json().id}`)).statusCode,
    ).toBe(204);

    const list = (await s.sm.browser.get(`${s.base}?from=${addDays(day, -6)}&to=${day}`)).json();
    expect(list.data).toHaveLength(1);
    expect(list.data[0].totals.labourHeadcount).toBe(9);

    const future = await s.sm.browser.post(`${s.base}/${addDays(today(), 2)}/labour`, {
      companyId: s.subCo.companyId,
    });
    expect(future.json().code).toBe('diary.future_date');
    const tooLong = await s.sm.browser.get(`${s.base}?from=${addDays(day, -200)}&to=${day}`);
    expect(tooLong.json().code).toBe('diary.range_too_long');
  });

  it('locks on submit, takes amendments with a reason, and signs off', async () => {
    const s = await setup('dia-lock');
    const day = addDays(today(), -3);
    const labour = await s.sm.browser.post(`${s.base}/${day}/labour`, {
      companyId: s.subCo.companyId,
      trade: 'Formwork',
      headcount: 4,
      hours: 32,
    });
    const delay = await s.sm.browser.post(`${s.base}/${day}/delays`, {
      type: 'client',
      description: 'Waiting on client colour selection',
      hours: 1,
    });
    let entry = await s.sm.browser.get(`${s.base}/${day}`);

    // Signing off a draft isn't allowed.
    const early = await s.pm.browser.post(`${s.base}/${day}/sign-off`, undefined, {
      'if-match': etagOf(entry),
    });
    expect(early.json().code).toBe('diary.not_submitted');

    // Submitted three days later: accepted, flagged late, record time from the device.
    const clientAt = new Date(Date.now() - 60_000).toISOString();
    const submitted = await s.sm.browser.post(
      `${s.base}/${day}/submit`,
      { clientAt },
      { 'if-match': etagOf(entry) },
    );
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().entry).toMatchObject({
      status: 'submitted',
      isLate: true,
      submittedAt: clientAt,
    });
    expect(submitted.json().entry.submitReceivedAt).toBeTruthy();
    const again = await s.sm.browser.post(
      `${s.base}/${day}/submit`,
      {},
      { 'if-match': etagOf(submitted) },
    );
    expect(again.json().code).toBe('diary.already_submitted');

    // After submit, edits without a reason are refused.
    const noReason = await s.sm.browser.patch(
      `${s.base}/${day}/labour/${labour.json().id}`,
      { headcount: 5 },
      { 'if-match': etagOf(labour) },
    );
    expect(noReason.statusCode).toBe(409);
    expect(noReason.json().code).toBe('diary.locked');
    expect(
      (await s.sm.browser.post(`${s.base}/${day}/copy-from/${addDays(day, -1)}`)).statusCode,
    ).toBe(404);

    const amended = await s.sm.browser.patch(
      `${s.base}/${day}/labour/${labour.json().id}`,
      { headcount: 5, amendmentReason: 'Late arrival missed at 7am count' },
      { 'if-match': etagOf(labour) },
    );
    expect(amended.statusCode).toBe(200);
    const removed = await s.sm.browser.del(
      `${s.base}/${day}/delays/${delay.json().id}?amendmentReason=${encodeURIComponent('Logged on the wrong day')}`,
    );
    expect(removed.statusCode).toBe(204);
    const added = await s.sm.browser.post(`${s.base}/${day}/events`, {
      kind: 'inspector_visit',
      at: '13:15',
      description: 'WHSQ inspector walked level 2',
      amendmentReason: 'Forgot to record the visit',
    });
    expect(added.statusCode).toBe(201);

    entry = await s.sm.browser.get(`${s.base}/${day}`);
    const d = entry.json();
    expect(d.entry.status).toBe('submitted');
    expect(d.labour[0].headcount).toBe(5);
    expect(d.delays).toEqual([]);
    expect(
      d.amendments.map((a: { action: string; targetType: string }) => [a.targetType, a.action]),
    ).toEqual([
      ['labour', 'update'],
      ['delay', 'delete'],
      ['event', 'create'],
    ]);
    expect(d.amendments[0]).toMatchObject({
      targetId: labour.json().id,
      changes: { headcount: [4, 5] },
      reason: 'Late arrival missed at 7am count',
      amendedBy: s.sm.userId,
    });
    expect(d.amendments[1].changes).toMatchObject({ type: ['client', null], hours: [1, null] });

    const signedOff = await s.pm.browser.post(`${s.base}/${day}/sign-off`, undefined, {
      'if-match': etagOf(entry),
    });
    expect(signedOff.json().entry).toMatchObject({
      status: 'signed_off',
      signedOffBy: s.pm.userId,
    });

    // A change after sign-off is an amendment and sends the day back for sign-off.
    const header = await s.sm.browser.put(
      `${s.base}/${day}`,
      { siteConditions: 'Dry', amendmentReason: 'Conditions were left blank' },
      { 'if-match': etagOf(signedOff) },
    );
    expect(header.statusCode).toBe(200);
    expect(header.json().entry).toMatchObject({
      status: 'submitted',
      signedOffAt: null,
      siteConditions: 'Dry',
    });
    expect(header.json().amendments.at(-1)).toMatchObject({
      targetType: 'entry',
      changes: { siteConditions: [null, 'Dry'] },
    });

    // Amendments are evidence: the database refuses to change them, even for the owner.
    await expect(
      t.database.withTenantTx(tenantOf(s.org.id, s.pm.userId), ({ tx }) =>
        tx.execute(sql`update diary.amendments set reason = 'edited'`),
      ),
    ).rejects.toThrow();
  });

  it("copies yesterday's companies with blank numbers, and asks why attendance numbers change", async () => {
    const s = await setup('dia-copy');
    const yesterday = addDays(today(), -1);
    await s.sm.browser.post(`${s.base}/${yesterday}/labour`, {
      companyId: s.subCo.companyId,
      trade: 'Formwork',
      headcount: 6,
      hours: 48,
    });
    await s.sm.browser.post(`${s.base}/${yesterday}/labour`, {
      companyId: s.otherCo.companyId,
      trade: 'Electrical',
      headcount: 2,
      hours: 16,
    });
    const copied = await s.sm.browser.post(`${s.base}/${today()}/copy-from/${yesterday}`);
    expect(copied.statusCode).toBe(200);
    expect(
      copied
        .json()
        .labour.map((l: { trade: string; headcount: number | null; hours: number | null }) => [
          l.trade,
          l.headcount,
          l.hours,
        ]),
    ).toEqual([
      ['Formwork', null, null],
      ['Electrical', null, null],
    ]);
    // Copying twice doesn't duplicate lines.
    const twice = await s.sm.browser.post(`${s.base}/${today()}/copy-from/${yesterday}`);
    expect(twice.json().labour).toHaveLength(2);

    // A line pre-filled from site attendance (ATT-AC6).
    const entryId = decodeId('diary', copied.json().entry.id)!;
    const lineId = decodeId('diaryLabour', copied.json().labour[0].id)!;
    await t.database.withTenantTx(tenantOf(s.org.id, s.pm.userId), ({ tx }) =>
      tx.execute(sql`update diary.labour set source = 'attendance', headcount = 5, attendance_headcount = 5
                     where id = ${lineId} and entry_id = ${entryId}`),
    );
    const line = copied.json().labour[0];
    const noReason = await s.sm.browser.patch(
      `${s.base}/${today()}/labour/${line.id}`,
      { headcount: 6 },
      { 'if-match': '"1"' },
    );
    expect(noReason.json().code).toBe('diary.edit_reason_required');
    const withReason = await s.sm.browser.patch(
      `${s.base}/${today()}/labour/${line.id}`,
      { headcount: 6, editReason: 'Labourer signed in at the wrong gate' },
      { 'if-match': '"1"' },
    );
    expect(withReason.json()).toMatchObject({
      headcount: 6,
      attendanceHeadcount: 5,
      source: 'attendance',
      editReason: 'Labourer signed in at the wrong gate',
    });
  });

  it('shows subcontractors only their own labour and keeps other orgs out', async () => {
    const s = await setup('dia-scope');
    const day = addDays(today(), -1);
    const other = addDays(today(), -2);
    await s.sm.browser.put(`${s.base}/${day}`, { notes: 'Commercial in confidence' });
    await s.sm.browser.post(`${s.base}/${day}/labour`, {
      companyId: s.subCo.companyId,
      headcount: 3,
      hours: 24,
    });
    await s.sm.browser.post(`${s.base}/${day}/labour`, {
      companyId: s.otherCo.companyId,
      headcount: 2,
      hours: 16,
    });
    await s.sm.browser.post(`${s.base}/${day}/delays`, {
      type: 'subcontractor',
      description: 'Formco short-staffed',
      hours: 2,
    });
    await s.sm.browser.post(`${s.base}/${other}/labour`, {
      companyId: s.otherCo.companyId,
      headcount: 1,
    });

    const seen = await s.sub.browser.get(`${s.base}/${day}`);
    expect(seen.statusCode).toBe(200);
    const v = seen.json();
    expect(v.entry).toMatchObject({ notes: null, totals: { labourHeadcount: 3, delayHours: 0 } });
    expect(v.labour.map((l: { companyId: string }) => l.companyId)).toEqual([s.subCo.companyId]);
    expect(v.delays).toEqual([]);
    const listed = (await s.sub.browser.get(`${s.base}?from=${other}&to=${day}`)).json().data;
    expect(listed.map((e: { date: string }) => e.date)).toEqual([day]);

    const write = await s.sub.browser.post(`${s.base}/${day}/labour`, {
      companyId: s.subCo.companyId,
      headcount: 9,
    });
    expect(write.statusCode).toBe(403);

    const outsider = await signUp(t.app, 'dia-outsider');
    await createOrg(outsider.browser, 'Elsewhere');
    expect((await outsider.browser.get(`${s.base}/${day}`)).statusCode).toBe(404);
  });
});
