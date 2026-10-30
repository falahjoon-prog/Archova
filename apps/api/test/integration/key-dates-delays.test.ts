import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const today = () => localDateOf(new Date(), 'Australia/Brisbane');
const etagOf = (res: { headers: Record<string, unknown> }) => res.headers.etag as string;

async function setup(label: string) {
  const pm = await signUp(t.app, `${label}-pm`);
  const sm = await signUp(t.app, `${label}-sm`);
  const sub = await signUp(t.app, `${label}-sub`);
  const org = await createOrg(pm.browser, `${label} Builders`);
  const project = await createProject(pm.browser, org.id, { name: 'Wharf St', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, sm.email, 'Site Manager', `${label} Builders`);
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Formco');
  return { pm, sm, sub, org, project, base };
}

describe('project key dates (X46, SCH-AC1)', () => {
  it('starts empty at version 0, saves with If-Match "0", and keeps a history', async () => {
    const s = await setup('kd-basic');
    const empty = await s.pm.browser.get(`${s.base}/key-dates`);
    expect(empty.json()).toMatchObject({
      version: 0,
      pcTarget: null,
      daysToPc: null,
      sections: [],
    });
    expect(etagOf(empty)).toBe('"0"');

    const pc = addDays(today(), 84);
    const saved = await s.pm.browser.patch(
      `${s.base}/key-dates`,
      {
        possessionDate: addDays(today(), -30),
        pcTarget: pc,
        dlpEnd: addDays(pc, 365),
        ldRatePerDay: '4500.00',
        sections: [{ name: 'Stage 1 podium', targetDate: addDays(pc, -28) }],
      },
      { 'if-match': '"0"' },
    );
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({
      version: 1,
      pcTarget: pc,
      ldRatePerDay: '4500.00',
      daysToPc: 84,
    });
    expect(saved.json().sections[0]).toMatchObject({ name: 'Stage 1 podium', actualDate: null });

    // First-time entries need no reason.
    const history = (await s.pm.browser.get(`${s.base}/key-dates/changes`)).json().data;
    expect(history.map((h: { field: string }) => h.field).sort()).toEqual(
      ['dlpEnd', 'ldRatePerDay', 'pcTarget', 'possessionDate', 'sectionAdded'].sort(),
    );
    expect(history[0].changedBy.name).toBeTruthy();
  });

  it('needs a reason to move a target that was set, and records it', async () => {
    const s = await setup('kd-reason');
    const pc = addDays(today(), 60);
    await s.pm.browser.patch(`${s.base}/key-dates`, { pcTarget: pc }, { 'if-match': '"0"' });
    const moved = addDays(pc, 14);

    const noReason = await s.pm.browser.patch(
      `${s.base}/key-dates`,
      { pcTarget: moved },
      { 'if-match': '"1"' },
    );
    expect(noReason.statusCode).toBe(422);
    expect(noReason.json().code).toBe('validation_failed');

    const ok = await s.pm.browser.patch(
      `${s.base}/key-dates`,
      { pcTarget: moved, reason: 'eot_granted', note: 'EOT 3 granted for 14 days' },
      { 'if-match': '"1"' },
    );
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ version: 2, pcTarget: moved, daysToPc: 74 });
    const [latest] = (await s.pm.browser.get(`${s.base}/key-dates/changes`)).json().data;
    expect(latest).toMatchObject({
      field: 'pcTarget',
      from: pc,
      to: moved,
      reason: 'eot_granted',
      note: 'EOT 3 granted for 14 days',
    });

    // Actual PC stops the countdown and needs no reason.
    const done = await s.pm.browser.patch(
      `${s.base}/key-dates`,
      { pcActual: today() },
      { 'if-match': '"2"' },
    );
    expect(done.json()).toMatchObject({ pcActual: today(), daysToPc: null });
  });

  it('checks versions and date order, and limits editing to project admins', async () => {
    const s = await setup('kd-checks');
    const stale = await s.pm.browser.patch(
      `${s.base}/key-dates`,
      { pcTarget: today() },
      { 'if-match': '"3"' },
    );
    expect(stale.statusCode).toBe(412);
    const noHeader = await s.pm.browser.patch(`${s.base}/key-dates`, { pcTarget: today() });
    expect(noHeader.statusCode).toBe(428);
    const order = await s.pm.browser.patch(
      `${s.base}/key-dates`,
      { pcTarget: today(), dlpEnd: addDays(today(), -1) },
      { 'if-match': '"0"' },
    );
    expect(order.statusCode).toBe(422);
    const dup = await s.pm.browser.patch(
      `${s.base}/key-dates`,
      { sections: [{ name: 'A' }, { name: 'a' }] },
      { 'if-match': '"0"' },
    );
    expect(dup.statusCode).toBe(422);

    // A site manager can read the dates but not change them.
    expect((await s.sm.browser.get(`${s.base}/key-dates`)).statusCode).toBe(200);
    const denied = await s.sm.browser.patch(
      `${s.base}/key-dates`,
      { pcTarget: today() },
      { 'if-match': '"0"' },
    );
    expect(denied.statusCode).toBe(403);
  });

  it("does not show another organisation's project", async () => {
    const a = await setup('kd-iso-a');
    const b = await setup('kd-iso-b');
    const res = await b.pm.browser.get(`${a.base}/key-dates`);
    expect([403, 404]).toContain(res.statusCode);
  });
});

describe('delay register (SCH-AC2)', () => {
  it('lists diary delays and RFIs that cost time in one place', async () => {
    const s = await setup('dr-all');
    const day = addDays(today(), -1);
    await s.sm.browser.post(`${s.base}/diary/${day}/delays`, {
      type: 'weather',
      description: 'Rain stopped the pour',
      hours: 3,
    });
    await s.sm.browser.post(`${s.base}/diary/${day}/delays`, {
      type: 'subcontractor',
      description: 'Pump arrived late',
      hours: 1.5,
    });

    const draft = await s.pm.browser.post(`${s.base}/rfis`, {
      subject: 'Slab edge detail',
      question: 'Which edge detail applies at grid C?',
      assigneeIds: [s.sm.userId],
      scheduleImpactDays: 4,
      dueDate: addDays(today(), -3),
    });
    expect(draft.statusCode, draft.body).toBe(201);
    const opened = await s.pm.browser.post(
      `${s.base}/rfis/${draft.json().rfi.id}/open`,
      undefined,
      {
        'if-match': etagOf(draft),
      },
    );
    expect(opened.statusCode, opened.body).toBe(200);
    // A draft RFI with an impact stays out.
    await s.pm.browser.post(`${s.base}/rfis`, {
      subject: 'Not sent',
      question: 'Draft only',
      assigneeIds: [],
      scheduleImpactDays: 9,
    });

    const res = await s.pm.browser.get(`${s.base}/delay-register`);
    expect(res.statusCode, res.body).toBe(200);
    const { data, totals, truncated } = res.json();
    expect(truncated).toBe(false);
    expect(data.map((r: { kind: string }) => r.kind).sort()).toEqual([
      'diary_delay',
      'diary_delay',
      'rfi_late_answer',
      'rfi_schedule_impact',
    ]);
    const late = data.find((r: { kind: string }) => r.kind === 'rfi_late_answer');
    expect(late).toMatchObject({ source: 'rfi', cause: 'design', days: 3, possibleEot: true });
    expect(late.title).toMatch(/^RFI-\d+ Slab edge detail$/);
    const rain = data.find((r: { title: string }) => r.title === 'Rain stopped the pour');
    expect(rain).toMatchObject({
      source: 'diary',
      cause: 'weather',
      hours: 3,
      diaryDate: day,
      possibleEot: true,
    });
    expect(totals).toMatchObject({ rows: 4, possibleEotRows: 3, diaryHours: 4.5, rfiDays: 7 });

    // Filters.
    const eotRes = await s.pm.browser.get(`${s.base}/delay-register?eotOnly=true`);
    expect(eotRes.statusCode, eotRes.body).toBe(200);
    const eot = eotRes.json();
    expect(eot.data).toHaveLength(3);
    const design = (await s.pm.browser.get(`${s.base}/delay-register?cause=design`)).json();
    expect(design.data.every((r: { source: string }) => r.source === 'rfi')).toBe(true);
    const weather = (await s.pm.browser.get(`${s.base}/delay-register?cause=weather`)).json();
    expect(weather.data).toHaveLength(1);
    const future = (
      await s.pm.browser.get(`${s.base}/delay-register?from=${addDays(today(), 5)}`)
    ).json();
    expect(future.data).toHaveLength(0);
    const diaryOnly = (await s.pm.browser.get(`${s.base}/delay-register?source=diary`)).json();
    expect(diaryOnly.data).toHaveLength(2);
    const backwards = await s.pm.browser.get(
      `${s.base}/delay-register?from=${today()}&to=${addDays(today(), -2)}`,
    );
    expect(backwards.statusCode).toBe(422);
  });

  it('is for builder staff: a subcontractor gets no diary rows and no RFIs they cannot see', async () => {
    const s = await setup('dr-sub');
    const day = addDays(today(), -1);
    await s.sm.browser.post(`${s.base}/diary/${day}/delays`, {
      type: 'client',
      description: 'Client changed the finish',
      hours: 2,
    });
    const draft = await s.pm.browser.post(`${s.base}/rfis`, {
      subject: 'Private to builder',
      question: 'Not shared with anyone',
      assigneeIds: [s.sm.userId],
      scheduleImpactDays: 2,
    });
    await s.pm.browser.post(`${s.base}/rfis/${draft.json().rfi.id}/open`, undefined, {
      'if-match': etagOf(draft),
    });
    const res = await s.sub.browser.get(`${s.base}/delay-register`);
    // Subcontractors hold diary read limited to their own labour, so the register shows them nothing.
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data).toEqual([]);
  });
});
