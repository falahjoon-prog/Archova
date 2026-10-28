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

// F4 (ai/01): "Nova summary" on a diary day, through the real diary and ai modules.
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

const TZ = 'Australia/Brisbane';
const yesterday = () => addDays(localDateOf(new Date(), TZ), -1);
const summaryCalls = () => t.ai.calls.filter((c) => c.task === 'diary.summary');

async function setup(label: string) {
  const pm = await signUp(t.app, `${label}-pm`);
  const sm = await signUp(t.app, `${label}-sm`);
  const sub = await signUp(t.app, `${label}-sub`);
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
  // A second subcontractor's labour, which the first one must not see.
  const spark = await signUp(t.app, `${label}-spark`);
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

async function fillDay(s: Setup, day: string) {
  expect(
    (
      await s.sm.browser.post(`${s.diary}/${day}/labour`, {
        companyId: s.formco.companyId,
        trade: 'Formwork',
        headcount: 6,
        hours: 45.5,
      })
    ).statusCode,
  ).toBe(201);
  expect(
    (
      await s.sm.browser.post(`${s.diary}/${day}/labour`, {
        companyId: s.sparky.companyId,
        trade: 'Electrical',
        headcount: 2,
        hours: 16,
      })
    ).statusCode,
  ).toBe(201);
  expect(
    (
      await s.sm.browser.post(`${s.diary}/${day}/delays`, {
        type: 'weather',
        description: 'Rain stopped the pour',
        hours: 2,
        affectedCompanyIds: [s.formco.companyId],
      })
    ).statusCode,
  ).toBe(201);
}

describe('Nova diary summary route (F4)', () => {
  it('drafts a sourced summary, caches it until the day changes, and costs half a credit', async () => {
    const s = await setup('dsr-a');
    const day = yesterday();
    await fillDay(s, day);

    const first = await s.sm.browser.post(`${s.diary}/${day}/nova-summary`);
    expect(first.statusCode).toBe(200);
    const a = first.json();
    expect(a).toMatchObject({
      task: 'diary.summary',
      status: 'pending',
      targetType: 'diary_entry',
    });
    expect(a.id).toMatch(/^ais_/);
    expect(a.targetId).toMatch(/^dia_/);
    expect(a.payload.date).toBe(day);
    expect(a.payload.sentences.length).toBeGreaterThan(0);
    // Every sentence names the diary lines it came from, as public ids.
    const sources = a.payload.sentences.flatMap(
      (x: { sources: Array<{ kind: string; id: string | null }> }) => x.sources,
    );
    expect(sources.length).toBeGreaterThan(0);
    for (const src of sources)
      if (src.id !== null) expect(src.id).toMatch(/^d(lb|pl|dl|vs|dy|sd|ev)_/);
    expect(summaryCalls()).toHaveLength(1);

    // Asking again before the day changes is free and returns the same suggestion.
    const again = await s.sm.browser.post(`${s.diary}/${day}/nova-summary`);
    expect(again.json().id).toBe(a.id);
    expect(summaryCalls()).toHaveLength(1);
    const usage = (await s.pm.browser.get(`/v1/orgs/${s.org.id}/ai/usage`)).json();
    expect(usage.byFeature).toContainEqual({ feature: 'diary_summary', credits: 0.5, runs: 1 });

    // A change to the day's lines is a new version, so a new summary.
    await s.sm.browser.post(`${s.diary}/${day}/labour`, {
      companyId: s.formco.companyId,
      trade: 'Steel fixing',
      headcount: 3,
      hours: 24,
    });
    const fresh = await s.sm.browser.post(`${s.diary}/${day}/nova-summary`);
    expect(fresh.json().id).not.toBe(a.id);
    expect(summaryCalls()).toHaveLength(2);
  });

  it('shows a company only its own lines, and refuses days it cannot read or that are empty', async () => {
    const s = await setup('dsr-b');
    const day = yesterday();
    await fillDay(s, day);

    // The first subcontractor's summary is written from their own lines: no other company's labour.
    const mine = await s.sub.browser.post(`${s.diary}/${day}/nova-summary`);
    expect(mine.statusCode).toBe(200);
    const sent = summaryCalls().at(-1)!.text;
    expect(sent).toContain('Formwork');
    expect(sent).not.toContain('Electrical');

    // Not on the project: no diary to read.
    const stranger = await signUp(t.app, 'dsr-b-stranger');
    const denied = await stranger.browser.post(`${s.diary}/${day}/nova-summary`);
    expect([403, 404]).toContain(denied.statusCode);

    // A day nobody has started, and a day with an entry but nothing in it.
    const none = await s.sm.browser.post(`${s.diary}/${addDays(day, -3)}/nova-summary`);
    expect(none.statusCode).toBe(404);
    expect(none.json().code).toBe('diary.not_found');
    const blank = addDays(day, -5);
    expect((await s.sm.browser.put(`${s.diary}/${blank}`, {})).statusCode).toBe(200);
    const empty = await s.sm.browser.post(`${s.diary}/${blank}/nova-summary`);
    expect(empty.statusCode).toBe(422);
    expect(empty.json().code).toBe('ai.diary.nothing_to_summarise');
  });
});
