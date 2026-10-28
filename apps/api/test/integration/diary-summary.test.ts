import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeId, encodeId, uuidv7 } from '@archova/domain';
import { createLogger, type TenantContext } from '@archova/kernel';
import {
  DEFAULT_FAKE_RESPONDERS,
  FAKE_MODELS,
  createAiModule,
  type AiApi,
  type DiaryDayForSummary,
} from '@archova/mod-ai';
import { TRIAL_ENTITLEMENTS } from '@archova/mod-billing';
import { createOrg, createProject, createTestContext, signUp, type TestContext } from './helpers';

// F4 (ai/01): the diary route will pass `diary.api.dayForSummary` (Ben's diary follow-up); until then these tests
// call the ai module API with the day that function returns.
let t: TestContext;
let nova: AiApi;
beforeAll(async () => {
  t = await createTestContext();
  nova = createAiModule(
    { database: t.database, redis: t.redis, logger: createLogger('test', 'silent') },
    {
      config: { provider: { kind: 'fake' }, models: FAKE_MODELS },
      orgTimeZone: async () => 'Australia/Sydney',
      readFile: async () => {
        throw new Error('not used');
      },
      assert: async () => undefined,
      sources: async () => [],
      accessScopes: async () => [],
      rfiSources: async () => [],
      rfiAccessScopes: async () => [],
      similarRfis: async () => [],
      getDrawingRevision: async () => {
        throw new Error('unused');
      },
      getPreviousDrawingRevision: async () => null,
      getMarkup: async () => ({ shapes: [] }),
      dayForSummary: async () => null,
      projectCompanies: async () => [],
      openDefectsNear: async () => [],
      quotePackage: async () => {
        throw new Error('not used');
      },
      openRfisOnDrawing: async () => [],
      provider: t.ai,
    },
  ).api;
});
afterAll(() => t.close());

async function newProject(label: string) {
  const { browser, userId } = await signUp(t.app, label);
  const org = await createOrg(browser, `${label} Builders`);
  const project = await createProject(browser, org.id, { name: 'Harbourside', state: 'NSW' });
  const ctx: TenantContext = {
    orgId: decodeId('org', org.id)!,
    userId: decodeId('user', userId)!,
    principalType: 'member',
    orgRole: 'owner',
    entitlements: TRIAL_ENTITLEMENTS,
    requestId: 'test',
  };
  return { browser, org, project, projectId: decodeId('project', project.id)!, ctx };
}

const line = (
  kind: string,
  text: string,
  extra: Partial<DiaryDayForSummary['lines'][number]> = {},
) => ({
  id: uuidv7(),
  kind,
  text,
  company: null,
  headcount: null,
  hours: null,
  delayCause: null,
  at: null,
  photoCaptions: [],
  ...extra,
});

describe('Nova diary summary (F4)', () => {
  it('drafts a traceable summary, keeps every delay, caches per entry version and charges half a credit', async () => {
    const { browser, org, project, projectId, ctx } = await newProject('diary-sum');
    const delay = line('delay', 'Pour of L4 slab postponed, rain', {
      delayCause: 'weather',
      hours: 5.5,
    });
    const inspection = line('inspection', 'Engineer passed L4 reo', { at: '13:15' });
    const day: DiaryDayForSummary = {
      entryId: uuidv7(),
      date: '2026-10-06',
      timeZone: 'Australia/Sydney',
      status: 'draft',
      version: 4,
      weather: { summary: 'Heavy rain from 10am', minC: 9, maxC: 15, rainMm: 32, lostHours: 5.5 },
      lines: [
        line('labour', 'L4 forms', { company: 'Harbour Formwork', headcount: 8, hours: 20 }),
        delay,
        inspection,
      ],
    };

    // The model invents a number in one sentence and skips the delay: both are caught.
    const fake = DEFAULT_FAKE_RESPONDERS['diary.summary']!;
    let prompt = '';
    t.ai.on('diary.summary', async (req) => {
      prompt = req.text;
      const reply = await fake(req);
      const out = (reply as { output: { sentences: Array<{ text: string; sources: string[] }> } })
        .output;
      return {
        output: {
          ...out,
          sentences: [
            ...out.sentences.filter((s) => !/postponed/.test(s.text)),
            { text: 'Harbour Formwork had 12 people on site.', sources: ['l1'] },
          ],
        },
      };
    });
    const before = t.ai.calls.length;
    const s = await nova.summariseDiaryDay(ctx, projectId, day);
    expect(prompt).toContain('Date: 2026-10-06 (Tuesday)');
    expect(prompt).toContain(
      '<fact id="t" kind="totals">8 people, 20 hours, 1 company on site</fact>',
    );
    expect(s).toMatchObject({
      task: 'diary.summary',
      status: 'pending',
      targetType: 'diary_entry',
      targetId: day.entryId,
    });
    const payload = s.payload as {
      sentences: Array<{ text: string; sources: Array<{ kind: string; id: string | null }> }>;
      possibleDelay: unknown;
      unmentionedDelays: unknown;
      dropped: number;
      entryVersion: number;
    };
    expect(payload.entryVersion).toBe(4);
    expect(payload.dropped).toBe(1);
    expect(payload.sentences.map((x) => x.text).join(' ')).not.toContain('12 people');
    expect(payload.sentences[0]).toMatchObject({ sources: [{ kind: 'weather', id: null }] });
    expect(payload.unmentionedDelays).toEqual([{ kind: 'delay', id: delay.id }]);
    expect(payload.possibleDelay).toEqual({
      flagged: true,
      cause: 'weather',
      sources: [{ kind: 'delay', id: delay.id }],
    });

    // Pressing the button again on the same version costs nothing; an edit makes a new draft.
    expect((await nova.summariseDiaryDay(ctx, projectId, day)).id).toBe(s.id);
    expect(t.ai.calls.length - before).toBe(1);
    t.ai.on('diary.summary', fake);
    const next = await nova.summariseDiaryDay(ctx, projectId, { ...day, version: 5 });
    expect(next.id).not.toBe(s.id);
    expect((next.payload as { unmentionedDelays: unknown[] }).unmentionedDelays).toEqual([]);

    // Through the API: line ids are public diary ids, and the site manager takes or discards the draft.
    const base = `/v1/orgs/${org.id}/projects/${project.id}/ai`;
    const listed = (
      await browser.get(`${base}/suggestions?task=diary.summary&status=pending`)
    ).json();
    const dto = listed.data.find((x: { id: string }) => x.id === encodeId('aiSuggestion', next.id));
    expect(dto).toMatchObject({ targetId: encodeId('diary', day.entryId) });
    expect(JSON.stringify(dto.payload)).toContain(encodeId('diaryDelay', delay.id));
    expect(JSON.stringify(dto.payload)).toContain(encodeId('diaryEvent', inspection.id));
    const decided = await browser.post(`${base}/suggestions/${dto.id}/decision`, {
      decision: 'accepted',
    });
    expect(decided.statusCode).toBe(200);

    // Half a credit for each draft written; the cached one was free.
    const usage = (await browser.get(`/v1/orgs/${org.id}/ai/usage`)).json();
    expect(usage.byFeature).toEqual([{ feature: 'diary_summary', credits: 1, runs: 2 }]);
  });

  it('says so when the day has nothing to summarise', async () => {
    const { projectId, ctx } = await newProject('diary-empty');
    await expect(
      nova.summariseDiaryDay(ctx, projectId, {
        entryId: uuidv7(),
        date: '2026-10-07',
        timeZone: 'Australia/Sydney',
        status: 'draft',
        version: 1,
        weather: null,
        lines: [],
      }),
    ).rejects.toMatchObject({ code: 'ai.diary.nothing_to_summarise' });
  });
});
