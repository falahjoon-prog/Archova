import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localDateOf, addDays } from '@archova/time';
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
const etagOf = (res: { headers: Record<string, unknown> }) => res.headers.etag as string;

async function setup(label: string) {
  const pm = await signUp(t.app, `${label}-pm`);
  const sm = await signUp(t.app, `${label}-sm`);
  const sub = await signUp(t.app, `${label}-sub`);
  const sub2 = await signUp(t.app, `${label}-sub2`);
  const org = await createOrg(pm.browser, `${label} Builder`);
  const project = await createProject(pm.browser, org.id, { name: 'Wharf St', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, sm.email, 'Site Manager', `${label} Builder`);
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Formco');
  await addMember(pm.browser, org.id, project.id, sub2.email, 'Subcontractor', 'Sparky');
  const site = await sm.browser.post(`${base}/attendance/sites`, { name: 'Main site' });
  const gate = await sm.browser.post(`${base}/attendance/sites/${site.json().id}/gates`, {
    name: 'Main gate',
  });
  const code = gate.json().code as string;
  // Two subcontractors and the site manager each work a 3 hour stint today.
  const startedAt = new Date(Date.now() - 3 * 3600_000).toISOString();
  const day = localDateOf(new Date(startedAt), TZ);
  for (const who of [sub, sub2, sm]) {
    await who.browser.post(`${base}/attendance/sign-in`, { gateCode: code, clientAt: startedAt });
    expect(
      (await who.browser.post(`${base}/attendance/sign-out`, { gateCode: code })).statusCode,
    ).toBe(200);
  }
  return { pm, sm, sub, sub2, base, day };
}

describe('timesheets (ATT-US9)', () => {
  it('builds drafts from sign-ins, scopes them by company and is safe to repeat', async () => {
    const s = await setup('ts-gen');
    const made = await s.sm.browser.post(`${s.base}/timesheets/generate`, { date: s.day });
    expect(made.statusCode).toBe(200);
    const sheets = made.json().data as Array<{
      id: string;
      status: string;
      totalMinutes: number;
      lines: Array<{ source: string }>;
    }>;
    expect(sheets).toHaveLength(3);
    for (const sheet of sheets) {
      expect(sheet.status).toBe('draft');
      expect(sheet.totalMinutes).toBeGreaterThanOrEqual(179);
      expect(sheet.lines).toHaveLength(1);
      expect(sheet.lines[0]!.source).toBe('attendance');
    }
    const again = await s.sm.browser.post(`${s.base}/timesheets/generate`, { date: s.day });
    expect(again.json().data).toHaveLength(3);
    expect(again.json().data[0].lines).toHaveLength(1);

    // A subcontractor sees only their own company's timesheet, and can't generate.
    const own = (await s.sub.browser.get(`${s.base}/timesheets?from=${s.day}&to=${s.day}`)).json();
    expect(own.data).toHaveLength(1);
    expect(own.data[0].companyId).not.toBeNull();
    expect(
      (await s.sub.browser.post(`${s.base}/timesheets/generate`, { date: s.day })).statusCode,
    ).toBe(403);
    const all = (await s.sm.browser.get(`${s.base}/timesheets?from=${s.day}&to=${s.day}`)).json();
    const other = all.data.find(
      (x: { id: string; companyId: string | null }) => x.id !== own.data[0].id && x.companyId,
    );
    expect((await s.sub.browser.get(`${s.base}/timesheets/${other.id}`)).statusCode).toBe(404);

    const future = addDays(s.day, 3);
    expect(
      (await s.sm.browser.post(`${s.base}/timesheets/generate`, { date: future })).json().code,
    ).toBe('timesheet.future_date');
  });

  it('adjusts with a reason, submits, approves, locks and sends back', async () => {
    const s = await setup('ts-flow');
    await s.sm.browser.post(`${s.base}/timesheets/generate`, { date: s.day });
    const mine = (await s.sub.browser.get(`${s.base}/timesheets?from=${s.day}&to=${s.day}`)).json()
      .data[0];
    const url = `${s.base}/timesheets/${mine.id}`;
    let version = `"${mine.version}"`;

    // Hours that are not from a sign-in need a reason.
    const noReason = await s.sub.browser.post(
      `${url}/lines`,
      { minutes: 30 },
      { 'if-match': version },
    );
    expect(noReason.statusCode).toBe(422);
    const tooLong = await s.sub.browser.post(
      `${url}/lines`,
      { minutes: 1400, reason: 'Left late' },
      { 'if-match': version },
    );
    expect(tooLong.json().code).toBe('timesheet.day_too_long');
    const added = await s.sub.browser.post(
      `${url}/lines`,
      { minutes: 30, reason: 'Loading out after sign-out' },
      { 'if-match': version },
    );
    expect(added.statusCode).toBe(201);
    expect(added.json().lines).toHaveLength(2);
    version = etagOf(added);
    // A stale version is refused.
    expect(
      (await s.sub.browser.post(`${url}/lines`, { minutes: 5, reason: 'x' }, { 'if-match': '"1"' }))
        .statusCode,
    ).toBe(412);

    // A line from a sign-in is adjusted, not removed.
    const fromSignIn = added
      .json()
      .lines.find((l: { source: string }) => l.source === 'attendance');
    const adjusted = await s.sub.browser.patch(
      `${url}/lines/${fromSignIn.id}`,
      { minutes: 170, breakMinutes: 20, reason: 'Phone was flat at sign-out' },
      { 'if-match': version },
    );
    expect(adjusted.statusCode).toBe(200);
    expect(adjusted.json().lines.find((l: { id: string }) => l.id === fromSignIn.id)).toMatchObject(
      {
        source: 'adjusted',
        minutes: 170,
        breakMinutes: 20,
      },
    );
    version = etagOf(adjusted);
    expect(
      (await s.sub.browser.del(`${url}/lines/${fromSignIn.id}`, { 'if-match': version }))
        .statusCode,
    ).toBe(422);

    const submitted = await s.sub.browser.post(`${url}/submit`, undefined, { 'if-match': version });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().status).toBe('submitted');
    version = etagOf(submitted);
    // Not editable while waiting for approval, and a subcontractor can't approve.
    expect(
      (
        await s.sub.browser.post(
          `${url}/lines`,
          { minutes: 5, reason: 'x' },
          { 'if-match': version },
        )
      ).json().code,
    ).toBe('timesheet.locked');
    expect(
      (await s.sub.browser.post(`${url}/approve`, undefined, { 'if-match': version })).statusCode,
    ).toBe(403);

    const approved = await s.sm.browser.post(`${url}/approve`, undefined, { 'if-match': version });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ status: 'approved', rejectionReason: null });
    expect(approved.json().decidedBy).toBeTruthy();
    version = etagOf(approved);

    // Approved is locked until a supervisor sends it back with a reason.
    expect(
      (
        await s.sub.browser.post(
          `${url}/lines`,
          { minutes: 5, reason: 'x' },
          { 'if-match': version },
        )
      ).json().code,
    ).toBe('timesheet.locked');
    expect((await s.sm.browser.post(`${url}/reject`, {}, { 'if-match': version })).statusCode).toBe(
      422,
    );
    const rejected = await s.sm.browser.post(
      `${url}/reject`,
      { reason: 'Break is missing' },
      { 'if-match': version },
    );
    expect(rejected.json()).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Break is missing',
    });
    version = etagOf(rejected);
    const fixed = await s.sub.browser.patch(
      `${url}/lines/${fromSignIn.id}`,
      { minutes: 170, breakMinutes: 30, reason: 'Added the lunch break' },
      { 'if-match': version },
    );
    expect(fixed.statusCode).toBe(200);
    const again = await s.sub.browser.post(`${url}/submit`, undefined, {
      'if-match': etagOf(fixed),
    });
    expect(again.json().status).toBe('submitted');
  });

  it('will not let a supervisor approve their own hours', async () => {
    const s = await setup('ts-own');
    await s.pm.browser.post(`${s.base}/timesheets/generate`, { date: s.day });
    const all = (await s.pm.browser.get(`${s.base}/timesheets?from=${s.day}&to=${s.day}`)).json()
      .data as Array<{
      id: string;
      version: number;
      workerName: string;
      lines: Array<{ id: string }>;
    }>;
    // Everyone's sheet goes in; the site manager then approves them all. Theirs alone is refused.
    const outcomes: number[] = [];
    for (const sheet of all) {
      const url = `${s.base}/timesheets/${sheet.id}`;
      const sub = await s.pm.browser.post(`${url}/submit`, undefined, {
        'if-match': `"${sheet.version}"`,
      });
      expect(sub.statusCode).toBe(200);
      const res = await s.sm.browser.post(`${url}/approve`, undefined, { 'if-match': etagOf(sub) });
      outcomes.push(res.statusCode);
      if (res.statusCode === 403) expect(res.json().code).toBe('timesheet.own_timesheet');
    }
    expect(outcomes.filter((c) => c === 403)).toHaveLength(1);
    expect(outcomes.filter((c) => c === 200)).toHaveLength(all.length - 1);
  });
});
