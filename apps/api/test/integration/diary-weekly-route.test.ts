import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, isoWeekday, localDateOf } from '@archova/time';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  type TestContext,
} from './helpers';

// F4 (ai/01): "Nova summary" on a diary week, through the real diary and ai modules.
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

const TZ = 'Australia/Brisbane';
const today = localDateOf(new Date(), TZ);
/** The Monday three weeks ago: a whole past week. */
const monday = addDays(today, -(isoWeekday(today) - 1) - 21);
const weeklyCalls = () => t.ai.calls.filter((c) => c.task === 'diary.weekly');

async function setup(label: string) {
  const pm = await signUp(t.app, `${label}-pm`);
  const sm = await signUp(t.app, `${label}-sm`);
  const sub = await signUp(t.app, `${label}-sub`);
  const spark = await signUp(t.app, `${label}-spark`);
  const org = await createOrg(pm.browser, `${label} Builder`);
  const project = await createProject(pm.browser, org.id, { name: 'Wharf St', state: 'QLD' });
  const diary = `/v1/orgs/${org.id}/projects/${project.id}/diary`;
  await addMember(pm.browser, org.id, project.id, sm.email, 'Site Manager', `${label} Builder`);
  const formco = await addMember(
    pm.browser,
    org.id,
    project.id,
    sub.email,
    'Subcontractor',
    'Formco',
  );
  const sparky = await addMember(
    pm.browser,
    org.id,
    project.id,
    spark.email,
    'Subcontractor',
    'Sparky',
  );
  return { pm, sm, sub, org, project, diary, formco, sparky };
}
type Setup = Awaited<ReturnType<typeof setup>>;

/** Monday and Wednesday of the week: labour from two companies, and a weather delay on Monday. */
async function fillWeek(s: Setup) {
  const post = async (path: string, body: object) =>
    expect((await s.sm.browser.post(`${s.diary}/${path}`, body)).statusCode).toBe(201);
  const wed = addDays(monday, 2);
  await post(`${monday}/labour`, {
    companyId: s.formco.companyId,
    trade: 'Formwork',
    headcount: 6,
    hours: 45.5,
  });
  await post(`${monday}/labour`, {
    companyId: s.sparky.companyId,
    trade: 'Electrical',
    headcount: 2,
    hours: 16,
  });
  await post(`${monday}/delays`, {
    type: 'weather',
    description: 'Rain stopped the pour',
    hours: 2,
    affectedCompanyIds: [s.formco.companyId],
  });
  await post(`${wed}/labour`, {
    companyId: s.formco.companyId,
    trade: 'Steel fixing',
    headcount: 3,
    hours: 24,
  });
}

describe('Nova diary week summary route (F4)', () => {
  it('drafts a sourced weekly summary, caches it until the week changes, and costs one credit', async () => {
    const s = await setup('dwr-a');
    await fillWeek(s);
    const url = `${s.diary}/weeks/${monday}/nova-summary`;

    const first = await s.sm.browser.post(url);
    expect(first.statusCode).toBe(200);
    const a = first.json();
    expect(a).toMatchObject({ task: 'diary.weekly', status: 'pending', targetType: 'project' });
    expect(a.id).toMatch(/^ais_/);
    expect(a.targetId).toMatch(/^prj_/);
    expect(a.payload).toMatchObject({
      weekStart: monday,
      weekEnd: addDays(monday, 6),
      daysWithEntries: 2,
      truncated: false,
      delayHours: { total: 2, byCause: [{ cause: 'weather', hours: 2 }] },
    });
    expect(a.payload.sentences.length).toBeGreaterThan(0);
    // Every sentence names what it came from, as public ids, with the day it belongs to.
    const sources = a.payload.sentences.flatMap(
      (x: { sources: Array<{ kind: string; id: string | null; date?: string }> }) => x.sources,
    );
    for (const src of sources) {
      if (src.id !== null) expect(src.id).toMatch(/^d(lb|pl|dl|vs|dy|sd|ev)_/);
      if (src.kind !== 'totals' || src.id !== null) expect(src.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(weeklyCalls()).toHaveLength(1);
    // The week's totals went to the model as one fact, added up in code.
    expect(weeklyCalls()[0]!.text).toMatch(/<fact id="wt" kind="week_totals">.*labour 85\.5 hours/);

    // Asking again before the week changes is free and returns the same suggestion.
    const again = await s.sm.browser.post(url);
    expect(again.json().id).toBe(a.id);
    expect(weeklyCalls()).toHaveLength(1);
    const usage = (await s.pm.browser.get(`/v1/orgs/${s.org.id}/ai/usage`)).json();
    expect(usage.byFeature).toContainEqual({ feature: 'diary_summary', credits: 1, runs: 1 });

    // A change to any day's lines is a new summary.
    await s.sm.browser.post(`${s.diary}/${addDays(monday, 4)}/labour`, {
      companyId: s.formco.companyId,
      trade: 'Formwork',
      headcount: 4,
      hours: 32,
    });
    const fresh = await s.sm.browser.post(url);
    expect(fresh.json().id).not.toBe(a.id);
    expect(fresh.json().payload.daysWithEntries).toBe(3);
    expect(weeklyCalls()).toHaveLength(2);
  });

  it('keeps the summary to the person who asked, and writes a company only its own lines', async () => {
    const s = await setup('dwr-b');
    await fillWeek(s);
    const url = `${s.diary}/weeks/${monday}/nova-summary`;
    const base = `/v1/orgs/${s.org.id}/projects/${s.project.id}`;
    const list = async (b: typeof s.sm.browser) =>
      (await b.get(`${base}/ai/suggestions?task=diary.weekly`)).json().data as Array<{
        id: string;
      }>;

    const made = (await s.sm.browser.post(url)).json();
    expect(weeklyCalls().at(-1)!.text).toContain('Electrical');
    expect((await list(s.sm.browser)).map((x) => x.id)).toEqual([made.id]);
    expect(await list(s.sub.browser)).toEqual([]);
    expect(await list(s.pm.browser)).toEqual([]);
    for (const other of [s.sub, s.pm]) {
      const res = await other.browser.post(`${base}/ai/suggestions/${made.id}/decision`, {
        decision: 'accepted',
      });
      expect(res.statusCode).toBe(404);
    }

    // A subcontractor asking gets a draft of their own, written from their own company's lines only.
    const theirs = await s.sub.browser.post(url);
    expect(theirs.statusCode).toBe(200);
    expect(theirs.json().id).not.toBe(made.id);
    const sent = weeklyCalls().at(-1)!.text;
    expect(sent).toContain('Formwork');
    expect(sent).not.toContain('Electrical');
    expect((await list(s.sub.browser)).map((x) => x.id)).toEqual([theirs.json().id]);

    // The person who asked takes it.
    const decided = await s.sm.browser.post(`${base}/ai/suggestions/${made.id}/decision`, {
      decision: 'accepted',
    });
    expect(decided.statusCode).toBe(200);
  });

  it('refuses a week that does not start on a Monday, has no entries, or only empty ones', async () => {
    const s = await setup('dwr-c');
    const tuesday = addDays(monday, 1);
    const notMonday = await s.sm.browser.post(`${s.diary}/weeks/${tuesday}/nova-summary`);
    expect(notMonday.statusCode).toBe(422);
    expect(notMonday.json().code).toBe('validation_failed');

    const none = await s.sm.browser.post(`${s.diary}/weeks/${monday}/nova-summary`);
    expect(none.statusCode).toBe(404);
    expect(none.json().code).toBe('diary.not_found');

    expect((await s.sm.browser.put(`${s.diary}/${addDays(monday, 3)}`, {})).statusCode).toBe(200);
    const empty = await s.sm.browser.post(`${s.diary}/weeks/${monday}/nova-summary`);
    expect(empty.statusCode).toBe(422);
    expect(empty.json().code).toBe('ai.diary.nothing_to_summarise');

    const stranger = await signUp(t.app, 'dwr-c-stranger');
    const denied = await stranger.browser.post(`${s.diary}/weeks/${monday}/nova-summary`);
    expect([403, 404]).toContain(denied.statusCode);
  });
});
