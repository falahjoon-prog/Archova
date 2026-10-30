import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeId } from '@archova/domain';
import { createLogger, type TenantContext } from '@archova/kernel';
import { FAKE_MODELS, createAiModule } from '@archova/mod-ai';
import { TRIAL_ENTITLEMENTS } from '@archova/mod-billing';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  uploadBytes,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

async function pdf(lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  lines.forEach((text, i) => page.drawText(text, { x: 50, y: 780 - i * 22, size: 11, font }));
  return doc.save();
}

describe('Nova induction drafts (F33)', () => {
  it('drafts from the site documents, flags what they do not cover, and waits for the builder', async () => {
    const owner = await signUp(t.app, 'ind');
    const org = await createOrg(owner.browser, 'Induction Builders');
    const project = await createProject(owner.browser, org.id, { name: 'Riverbend', state: 'VIC' });
    const base = `/v1/orgs/${org.id}/projects/${project.id}`;

    // Before anything is indexed there is nothing to draft from.
    const empty = await owner.browser.post(`${base}/ai/induction-drafts`, {
      siteName: 'Riverbend',
    });
    expect(empty.statusCode).toBe(422);
    expect(empty.json().code).toBe('ai.induction.no_documents');

    const folder = (await owner.browser.post(`${base}/folders`, { name: 'Safety' })).json();
    for (const [title, lines] of [
      [
        'Emergency Plan',
        [
          'EMERGENCY PLAN',
          'On the continuous siren, stop work and go to the assembly point: the oval near the cricket nets.',
          'In an emergency call 000 and give the site address: 5 Riverbend Drive, Werribee VIC.',
        ],
      ],
      [
        'Site Rules',
        [
          'SITE CONTACTS',
          'Site manager: Priscilla Tan, mobile 0434 555 661.',
          'Working hours are 7:00 am to 3:30 pm Monday to Friday.',
        ],
      ],
    ] as const) {
      const fileId = await uploadBytes(t, owner.browser, org.id, project.id, await pdf([...lines]));
      const res = await owner.browser.post(`${base}/documents`, {
        folderId: folder.id,
        title,
        revision: { rev: 'A', fileId },
      });
      expect(res.statusCode).toBe(201);
    }
    expect((await owner.browser.post(`${base}/ai/index`)).json().indexed).toBe(2);

    const res = await owner.browser.post(`${base}/ai/induction-drafts`, { siteName: 'Riverbend' });
    expect(res.statusCode).toBe(201);
    const s = res.json();
    expect(s).toMatchObject({
      task: 'induction.draft',
      status: 'pending',
      targetType: 'project',
      targetId: project.id,
      runId: expect.stringMatching(/^air_/),
    });
    const sections = new Map(
      (s.payload.sections as Array<{ section: string; status: string }>).map((x) => [x.section, x]),
    );
    expect(sections.size).toBe(9);
    const emergencies = JSON.stringify(sections.get('emergencies_and_first_aid'));
    expect(sections.get('emergencies_and_first_aid')).toMatchObject({ status: 'covered' });
    expect(emergencies).toContain('the oval near the cricket nets');
    // Citations carry public document ids.
    expect(emergencies).toMatch(/"sourceId":"doc_/);
    // Nothing in the documents covers PPE or consultation: flagged, not invented.
    expect(sections.get('ppe')).toMatchObject({ status: 'missing', slides: [] });
    expect(sections.get('consultation')).toMatchObject({ status: 'missing' });
    expect(s.payload.fixedText.declaration).toMatch(/fit for work/);
    expect(s.payload.quiz.length).toBeGreaterThan(0);

    // Edits happen in the induction editor; here the builder can only accept or reject.
    const url = `${base}/ai/suggestions/${s.id}/decision`;
    expect((await owner.browser.post(url, { decision: 'edited' })).statusCode).toBe(422);
    const accepted = await owner.browser.post(url, { decision: 'accepted' });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().status).toBe('accepted');

    // Three credits for the draft.
    const usage = (await owner.browser.get(`/v1/orgs/${org.id}/ai/usage`)).json();
    expect(usage.byFeature).toEqual(
      expect.arrayContaining([expect.objectContaining({ feature: 'inductions', credits: 3 })]),
    );

    // A subcontractor can't draft one.
    const sub = await signUp(t.app, 'ind-sub');
    await addMember(owner.browser, org.id, project.id, sub.email, 'Subcontractor');
    const denied = await sub.browser.post(`${base}/ai/induction-drafts`, { siteName: 'Riverbend' });
    expect(denied.statusCode).toBe(403);

    // Nor can they read or decide the builder's draft: every member holds `ai.suggestions.read`, but the draft is
    // for whoever holds the induction permission.
    const listed = async (b: typeof sub.browser) =>
      (await b.get(`${base}/ai/suggestions?task=induction.draft`)).json().data as Array<{
        id: string;
      }>;
    expect(await listed(sub.browser)).toEqual([]);
    expect((await listed(owner.browser)).map((x) => x.id)).toEqual([s.id]);
    expect((await sub.browser.post(url, { decision: 'rejected' })).statusCode).toBe(404);
  });
});

describe('Nova induction drafts: out-of-date check (F33 I2)', () => {
  it('flags the sections that rest on a document once it has a newer revision, and not before', async () => {
    const owner = await signUp(t.app, 'ind-cur');
    const org = await createOrg(owner.browser, 'Currency Builders');
    const project = await createProject(owner.browser, org.id, { name: 'Rosebery', state: 'NSW' });
    const base = `/v1/orgs/${org.id}/projects/${project.id}`;
    const folder = (await owner.browser.post(`${base}/folders`, { name: 'Safety' })).json();
    const upload = async (lines: string[]) =>
      uploadBytes(t, owner.browser, org.id, project.id, await pdf(lines));

    const planFile = await upload([
      'EMERGENCY PLAN',
      'On the continuous siren, stop work and go to the assembly point: the oval near the cricket nets.',
      'In an emergency call 000 and give the site address: 9 Rosebery Street, Sydney NSW.',
    ]);
    const plan = (
      await owner.browser.post(`${base}/documents`, {
        folderId: folder.id,
        title: 'Emergency Plan',
        revision: { rev: 'A', fileId: planFile },
      })
    ).json().document;
    await owner.browser.post(`${base}/ai/index`);
    const drafted = await owner.browser.post(`${base}/ai/induction-drafts`, {
      siteName: 'Rosebery',
    });
    expect(drafted.statusCode, drafted.body).toBe(201);
    const draftId = drafted.json().id as string;
    const currency = (id = draftId, b = owner.browser) =>
      b.get(`${base}/ai/induction-drafts/${id}/currency`);

    // Nothing has changed since: up to date, and no model was called to find out.
    const before = (await owner.browser.get(`/v1/orgs/${org.id}/ai/usage`)).json();
    const fresh = await currency();
    expect(fresh.statusCode, fresh.body).toBe(200);
    expect(fresh.json()).toEqual({
      suggestionId: draftId,
      upToDate: true,
      changed: [],
      hiddenChanges: 0,
    });

    // A new emergency plan is published.
    const planB = await upload([
      'EMERGENCY PLAN',
      'On the continuous siren, stop work and go to the assembly point: the car park behind the site office.',
      'In an emergency call 000 and give the site address: 9 Rosebery Street, Sydney NSW.',
    ]);
    const added = await owner.browser.post(`${base}/documents/${plan.id}/revisions`, {
      rev: 'B',
      fileId: planB,
    });
    expect(added.statusCode, added.body).toBe(201);

    const stale = (await currency()).json();
    expect(stale).toMatchObject({ suggestionId: draftId, upToDate: false, hiddenChanges: 0 });
    expect(stale.changed).toHaveLength(1);
    expect(stale.changed[0]).toMatchObject({
      sourceType: 'document',
      sourceId: plan.id,
      title: 'Emergency Plan',
      citedRevision: 'A',
      currentRevision: 'B',
      reason: 'newer_revision',
    });
    expect(stale.changed[0].sections).toContain('emergencies_and_first_aid');
    expect(stale.changed[0].quizQuestions).toBeGreaterThan(0);
    const after = (await owner.browser.get(`/v1/orgs/${org.id}/ai/usage`)).json();
    expect(after).toEqual(before);

    // Index the new revision and draft again: the new draft cites revision B, so it is current. The first one still is not.
    await owner.browser.post(`${base}/ai/index`);
    const second = (
      await owner.browser.post(`${base}/ai/induction-drafts`, { siteName: 'Rosebery' })
    ).json();
    expect((await currency(second.id)).json()).toMatchObject({ upToDate: true, changed: [] });
    expect((await currency()).json().upToDate).toBe(false);

    // A subcontractor holds no induction permission; an unknown or wrong-kind suggestion is a 404.
    const sub = await signUp(t.app, 'ind-cur-sub');
    await addMember(owner.browser, org.id, project.id, sub.email, 'Subcontractor');
    expect((await currency(draftId, sub.browser)).statusCode).toBe(403);
    const unknown = `ais_${'0'.repeat(26)}`;
    expect((await currency(unknown)).statusCode).toBe(404);
    const other = await createProject(owner.browser, org.id, { name: 'Elsewhere', state: 'NSW' });
    const elsewhere = await owner.browser.get(
      `/v1/orgs/${org.id}/projects/${other.id}/ai/induction-drafts/${draftId}/currency`,
    );
    expect(elsewhere.statusCode).toBe(404);
  });
});

describe('Nova induction drafts: refresh after a document changes (F33 I2)', () => {
  const EMERGENCY_A = [
    'EMERGENCY PLAN',
    'On the continuous siren, stop work and go to the assembly point: the oval near the cricket nets.',
    'In an emergency call 000 and give the site address: 9 Rosebery Street, Sydney NSW.',
    'Exclusion zones are marked with red barriers; do not enter.',
  ];
  const EMERGENCY_B = [
    'EMERGENCY PLAN',
    'On the continuous siren, stop work and go to the assembly point: the car park behind the site office.',
    'In an emergency call 000 and give the site address: 9 Rosebery Street, Sydney NSW.',
    'Exclusion zones are marked with red barriers; do not enter.',
  ];
  const RULES = [
    'SITE CONTACTS',
    'Site manager: Priscilla Tan, phone 0434 555 661.',
    'Site hours are 7:00 am to 3:30 pm Monday to Friday.',
  ];

  /** An org with an emergency plan and site rules indexed, and an induction drafted from them. */
  async function setup(label: string, rulesPrivate = false) {
    const owner = await signUp(t.app, label);
    const org = await createOrg(owner.browser, `${label} Builders`);
    const project = await createProject(owner.browser, org.id, { name: 'Rosebery', state: 'NSW' });
    const base = `/v1/orgs/${org.id}/projects/${project.id}`;
    const open = (await owner.browser.post(`${base}/folders`, { name: 'Safety' })).json();
    const hidden = rulesPrivate
      ? (await owner.browser.post(`${base}/folders`, { name: 'Plans', isPrivate: true })).json()
      : open;
    const add = async (folderId: string, title: string, lines: string[]) => {
      const fileId = await uploadBytes(t, owner.browser, org.id, project.id, await pdf(lines));
      const res = await owner.browser.post(`${base}/documents`, {
        folderId,
        title,
        revision: { rev: 'A', fileId },
      });
      expect(res.statusCode, res.body).toBe(201);
      return res.json().document as { id: string };
    };
    const plan = await add(open.id, 'Emergency Plan', EMERGENCY_A);
    const rules = await add(hidden.id, 'Site Rules', RULES);
    const revise = async (doc: { id: string }, lines: string[], rev = 'B') => {
      const fileId = await uploadBytes(t, owner.browser, org.id, project.id, await pdf(lines));
      const res = await owner.browser.post(`${base}/documents/${doc.id}/revisions`, {
        rev,
        fileId,
      });
      expect(res.statusCode, res.body).toBe(201);
    };
    expect((await owner.browser.post(`${base}/ai/index`)).statusCode).toBe(200);
    const drafted = await owner.browser.post(`${base}/ai/induction-drafts`, {
      siteName: 'Rosebery',
    });
    expect(drafted.statusCode, drafted.body).toBe(201);
    const draft = drafted.json();
    const refresh = (id = draft.id as string, b = owner.browser) =>
      b.post(`${base}/ai/induction-drafts/${id}/refresh`);
    const credits = async () =>
      (
        (await owner.browser.get(`/v1/orgs/${org.id}/ai/usage`)).json().byFeature as Array<{
          feature: string;
          credits: number;
        }>
      ).find((f) => f.feature === 'inductions')?.credits;
    return {
      owner,
      userId: owner.userId,
      org,
      project,
      base,
      plan,
      rules,
      draft,
      revise,
      refresh,
      credits,
    };
  }
  const sectionOf = (payload: { sections: Array<{ section: string }> }, key: string) =>
    payload.sections.find((x) => x.section === key);

  it('redraws only the sections that rest on the changed document, from the new revision, and says which', async () => {
    const s = await setup('ind-ref');
    expect(await s.credits()).toBe(3);

    // Nothing changed: nothing to refresh, and nothing charged.
    const same = await s.refresh();
    expect(same.statusCode).toBe(409);
    expect(same.json().code).toBe('ai.induction.up_to_date');

    // A new emergency plan is published, but Nova has not read it yet: it would rebuild the section from the old text.
    await s.revise(s.plan, EMERGENCY_B);
    const early = await s.refresh();
    expect(early.statusCode).toBe(409);
    expect(early.json().code).toBe('ai.index.catching_up');
    expect(early.json().detail ?? early.body).toContain('Emergency Plan');
    expect(await s.credits()).toBe(3);

    expect((await s.owner.browser.post(`${s.base}/ai/index`)).statusCode).toBe(200);
    const callsBefore = t.ai.calls.length;
    const res = await s.refresh();
    expect(res.statusCode, res.body).toBe(201);
    const refreshed = res.json();
    expect(refreshed).toMatchObject({
      task: 'induction.refresh',
      status: 'pending',
      targetType: 'project',
      targetId: s.project.id,
      runId: expect.stringMatching(/^air_/),
    });
    const { refresh } = refreshed.payload as {
      refresh: { baseSuggestionId: string; sections: string[]; skipped: string[] };
    };
    expect(refresh.baseSuggestionId).toBe(s.draft.id);
    expect(refresh.sections).toContain('emergencies_and_first_aid');
    expect(refresh.skipped).toEqual([]);
    // The site rules did not change, so what rests on them is not redrafted.
    expect(refresh.sections).not.toContain('who_and_access');

    // The model was asked about the changed sections only, from the new text only.
    const call = t.ai.calls.slice(callsBefore).find((c) => c.task === 'induction.refresh')!;
    expect(call.text).toContain('- emergencies_and_first_aid:');
    expect(call.text).not.toContain('- who_and_access:');
    const seen = call.passages.map((p) => p.text).join('\n');
    expect(seen).toContain('the car park behind the site office');
    expect(seen).not.toContain('cricket nets');

    // The redrafted section is the new text; every other section and question is the draft's own.
    const emergencies = JSON.stringify(sectionOf(refreshed.payload, 'emergencies_and_first_aid'));
    expect(emergencies).toContain('the car park behind the site office');
    expect(emergencies).not.toContain('cricket nets');
    expect(emergencies).toMatch(/"sourceId":"doc_/);
    expect(refreshed.payload.sections).toHaveLength(9);
    for (const sec of draftSections(s.draft.payload))
      if (!refresh.sections.includes(sec.section))
        expect(sectionOf(refreshed.payload, sec.section)).toEqual(sec);
    const kept = (s.draft.payload.quiz as Array<{ section: string }>).filter(
      (q) => !refresh.sections.includes(q.section),
    );
    expect(kept.length).toBeGreaterThan(0);
    for (const q of kept) expect(refreshed.payload.quiz).toContainEqual(q);
    expect(refreshed.payload.fixedText).toEqual(s.draft.payload.fixedText);

    // One credit, and the refresh cites the new revision: it is current while the draft it came from is not.
    expect(await s.credits()).toBe(4);
    const currency = (id: string) =>
      s.owner.browser.get(`${s.base}/ai/induction-drafts/${id}/currency`);
    expect((await currency(refreshed.id)).json()).toMatchObject({ upToDate: true, changed: [] });
    expect((await currency(s.draft.id)).json().upToDate).toBe(false);
    const again = await s.refresh(refreshed.id);
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('ai.induction.up_to_date');

    // The builder accepts or rejects it like the draft; only people who may draft inductions can see it.
    const sub = await signUp(t.app, 'ind-ref-sub');
    await addMember(s.owner.browser, s.org.id, s.project.id, sub.email, 'Subcontractor');
    const listed = async (b: typeof sub.browser) =>
      (await b.get(`${s.base}/ai/suggestions?task=induction.refresh`)).json().data as Array<{
        id: string;
      }>;
    expect((await listed(s.owner.browser)).map((x) => x.id)).toEqual([refreshed.id]);
    expect(await listed(sub.browser)).toEqual([]);
    const decision = `${s.base}/ai/suggestions/${refreshed.id}/decision`;
    expect((await sub.browser.post(decision, { decision: 'accepted' })).statusCode).toBe(404);
    expect((await s.owner.browser.post(decision, { decision: 'accepted' })).statusCode).toBe(200);
  });

  it('is closed to people without the induction permission, unknown suggestions and other projects', async () => {
    const s = await setup('ind-ref-deny');
    await s.revise(s.plan, EMERGENCY_B);
    await s.owner.browser.post(`${s.base}/ai/index`);
    const sub = await signUp(t.app, 'ind-ref-deny-sub');
    await addMember(s.owner.browser, s.org.id, s.project.id, sub.email, 'Subcontractor');
    expect((await s.refresh(s.draft.id, sub.browser)).statusCode).toBe(403);
    expect((await s.refresh(`ais_${'0'.repeat(26)}`)).statusCode).toBe(404);
    const other = await createProject(s.owner.browser, s.org.id, {
      name: 'Elsewhere',
      state: 'NSW',
    });
    const elsewhere = await s.owner.browser.post(
      `/v1/orgs/${s.org.id}/projects/${other.id}/ai/induction-drafts/${s.draft.id}/refresh`,
    );
    expect(elsewhere.statusCode).toBe(404);
    expect(await s.credits()).toBe(3);
  });

  it('leaves alone what rests on a changed document the caller cannot open, and never sends its text to the model', async () => {
    const s = await setup('ind-ref-hidden', true);
    // The draft was made by someone who could open both documents.
    expect(JSON.stringify(s.draft.payload)).toContain('Priscilla Tan');
    await s.revise(s.plan, EMERGENCY_B);
    await s.revise(s.rules, [...RULES, 'All workers must sign in at Gate 2 before starting work.']);
    expect((await s.owner.browser.post(`${s.base}/ai/index`)).statusCode).toBe(200);

    // The same module, for a caller who cannot open the private folder.
    const orgId = decodeId('org', s.org.id)!;
    const projectId = decodeId('project', s.project.id)!;
    const ctx: TenantContext = {
      orgId,
      userId: decodeId('user', s.userId)!,
      principalType: 'member',
      orgRole: 'owner',
      entitlements: TRIAL_ENTITLEMENTS,
      requestId: 'test',
    };
    const scopesOf =
      (hideTitles: string[]) =>
      async (scope: Parameters<typeof t.modules.documents.api.aiAccessScopes>[0], id: string) => {
        const sources = await t.modules.documents.api.aiSources(scope, id);
        const hide = new Set(
          sources.filter((x) => hideTitles.includes(x.title)).map((x) => x.accessScope),
        );
        return (await t.modules.documents.api.aiAccessScopes(scope, id)).filter(
          (x) => !hide.has(x),
        );
      };
    const nova = (accessScopes: ReturnType<typeof scopesOf>) =>
      createAiModule(
        { database: t.database, redis: t.redis, logger: createLogger('test', 'silent') },
        {
          config: { provider: { kind: 'fake' }, models: FAKE_MODELS },
          orgTimeZone: async () => 'Australia/Sydney',
          readFile: async () => {
            throw new Error('not used');
          },
          assert: async () => undefined,
          can: async () => true,
          sources: t.modules.documents.api.aiSources,
          accessScopes,
          rfiSources: async () => [],
          rfiAccessScopes: async () => [],
          defectSources: async () => [],
          defectAccessScopes: async () => [],
          diarySources: async () => [],
          diaryAccessScopes: async () => [],
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
    const draftId = decodeId('aiSuggestion', s.draft.id)!;

    // Who cannot open the site rules: the check counts that change and never names it.
    const outsider = nova(scopesOf(['Site Rules']));
    const check = await outsider.inductionDraftCurrency(ctx, projectId, draftId);
    expect(check).toMatchObject({ upToDate: false, hiddenChanges: 1 });
    expect(check.changed.map((c) => c.title)).toEqual(['Emergency Plan']);
    expect(JSON.stringify(check)).not.toContain('Site Rules');

    const callsBefore = t.ai.calls.length;
    const row = await outsider.refreshInductionDraft(ctx, projectId, draftId);
    const payload = row.payload as {
      refresh: { sections: string[]; skipped: string[] };
      sections: Array<{ section: string }>;
    };
    // The sections that rest on the site rules are skipped, not redrafted without them.
    const restsOn = (title: string) =>
      draftSections(s.draft.payload)
        .map((x) => x.section)
        .filter((key) =>
          JSON.stringify([
            sectionOf(s.draft.payload, key),
            ...s.draft.payload.quiz.filter((q: { section: string }) => q.section === key),
          ]).includes(`${title}, rev A`),
        );
    const onRules = restsOn('Site Rules');
    const onPlan = restsOn('Emergency Plan');
    expect(onRules).toContain('who_and_access');
    expect(payload.refresh.skipped).toEqual(onRules);
    expect(payload.refresh.sections).toEqual(onPlan.filter((key) => !onRules.includes(key)));
    expect(payload.refresh.sections.length).toBeGreaterThan(0);
    // The skipped sections are the draft's own words (the module returns internal ids, so compare the text).
    const words = (sec: unknown) =>
      JSON.stringify(
        (
          sec as {
            slides: Array<{
              title: string;
              points: Array<{ text: string }>;
              script: Array<{ text: string }>;
            }>;
          }
        ).slides.map((sl) => [
          sl.title,
          sl.points.map((p) => p.text),
          sl.script.map((p) => p.text),
        ]),
      );
    for (const key of payload.refresh.skipped)
      expect(words(sectionOf(payload, key))).toBe(words(sectionOf(s.draft.payload, key)));
    const seen = t.ai.calls
      .slice(callsBefore)
      .flatMap((c) => c.passages.map((p) => p.text))
      .join('\n');
    expect(seen).toContain('the car park behind the site office');
    expect(seen).not.toMatch(/Priscilla Tan|Gate 2/);

    // Someone who is shown neither changed document has nothing Nova may redraft from.
    const nothing = nova(scopesOf(['Site Rules', 'Emergency Plan']));
    await expect(nothing.refreshInductionDraft(ctx, projectId, draftId)).rejects.toMatchObject({
      code: 'ai.induction.cannot_refresh',
    });
    expect(await nothing.inductionDraftCurrency(ctx, projectId, draftId)).toMatchObject({
      changed: [],
      hiddenChanges: 2,
    });
  });
});

function draftSections(payload: { sections: Array<{ section: string }> }) {
  return payload.sections;
}
