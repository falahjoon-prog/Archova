import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { decodeId, encodeId, uuidv7 } from '@archova/domain';
import { addMonths } from '@archova/mod-workforce';
import { localDateOf } from '@archova/time';
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
  await addMember(pm.browser, org.id, project.id, sub2.email, 'Subcontractor', 'Sparky');
  await addMember(pm.browser, org.id, project.id, eng.email, 'Consultant', 'Smith Engineers');
  const site = (await sm.browser.post(`${base}/attendance/sites`, { name: 'Main site' })).json();
  const gate = await sm.browser.post(`${base}/attendance/sites/${site.id}/gates`, {
    name: 'Main gate',
  });
  return { pm, sm, sub, sub2, eng, org, project, base, subCo, site, code: gate.json().code };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const SECTIONS = [
  'who_and_access',
  'layout_and_amenities',
  'emergencies_and_first_aid',
  'site_hazards',
  'high_risk_work_and_permits',
  'ppe',
  'site_rules',
  'incident_reporting',
  'consultation',
] as const;

/** A complete induction: a text block per required section, a video, a SWMS and a four-question quiz. */
async function content(s: Setup) {
  const video = await uploadFile(
    t,
    s.sm.browser,
    s.org.id,
    s.project.id,
    'welcome.mp4',
    'workforce',
  );
  const folder = (await s.pm.browser.post(`${s.base}/folders`, { name: 'Safety' })).json();
  const swmsFile = await uploadFile(t, s.pm.browser, s.org.id, s.project.id, 'swms-scaffold.pdf');
  const swms = (
    await s.pm.browser.post(`${s.base}/documents`, {
      folderId: folder.id,
      title: 'Scaffold erection SWMS',
      docNumber: 'SWMS-004',
      revision: { rev: 'A', fileId: swmsFile },
    })
  ).json().document;
  const sections = SECTIONS.map((key) => ({
    key,
    title: key.replace(/_/g, ' '),
    blocks: [{ type: 'text', body: `About ${key} on this site.` }] as unknown[],
  }));
  sections[0]!.blocks.push({ type: 'video', fileId: video });
  sections[4]!.blocks.push({ type: 'swms', documentId: swms.id });
  const quiz = [
    {
      section: 'emergencies_and_first_aid',
      question: 'Where is the assembly point?',
      options: ['Car park', 'Crane base'],
      answerIndex: 0,
      critical: false,
    },
    {
      section: 'site_hazards',
      question: 'Where is the exclusion zone?',
      options: ['Under the crane', 'Lunch room'],
      answerIndex: 0,
      critical: true,
    },
    {
      section: 'high_risk_work_and_permits',
      question: 'Who needs a hot work permit?',
      options: ['Nobody', 'Anyone welding'],
      answerIndex: 1,
      critical: false,
    },
    {
      section: 'incident_reporting',
      question: 'Who do you tell about a near miss?',
      options: ['The site manager', 'Nobody'],
      answerIndex: 0,
      critical: false,
    },
  ];
  return { sections, quiz, passMark: 80 };
}

async function publishInduction(s: Setup) {
  const created = await s.sm.browser.post(`${s.base}/inductions`, { title: 'Wharf St induction' });
  expect(created.statusCode).toBe(201);
  const ind = created.json();
  const saved = await s.sm.browser.put(
    `${s.base}/inductions/${ind.id}/draft`,
    { content: await content(s) },
    { 'if-match': etagOf(created) },
  );
  expect(saved.statusCode).toBe(200);
  const published = await s.sm.browser.post(
    `${s.base}/inductions/${ind.id}/publish`,
    { redo: 'all' },
    { 'if-match': etagOf(saved) },
  );
  expect(published.statusCode).toBe(201);
  return { induction: saved.json(), version: published.json(), etag: etagOf(published) };
}

/** Answers from the builder's quiz, matched by question text since the worker's copy has no answers. */
function answersFor(
  completion: { content: { quiz: Array<{ id: string; question: string }> } },
  draft: { quiz: Array<{ question: string; answerIndex: number; options: string[] }> },
  wrong = false,
) {
  return completion.content.quiz.map((q) => {
    const src = draft.quiz.find((d) => d.question === q.question)!;
    return {
      questionId: q.id,
      answerIndex: wrong ? (src.answerIndex + 1) % src.options.length : src.answerIndex,
    };
  });
}

describe('online inductions (product/14)', () => {
  it('builds a site induction from the template and publishes it only when complete', async () => {
    const s = await setup('ind-build');
    const created = await s.sm.browser.post(`${s.base}/inductions`, {
      title: 'Wharf St induction',
    });
    expect(created.statusCode).toBe(201);
    const ind = created.json();
    expect(ind.draft.sections.map((x: { key: string }) => x.key)).toEqual(SECTIONS);
    expect(ind.draft.passMark).toBe(80);
    expect(ind.problems.length).toBeGreaterThan(9);
    expect((await s.sm.browser.post(`${s.base}/inductions`, { title: 'Again' })).json().code).toBe(
      'induction.exists',
    );

    const early = await s.sm.browser.post(
      `${s.base}/inductions/${ind.id}/publish`,
      { redo: 'all' },
      { 'if-match': etagOf(created) },
    );
    expect(early.json().code).toBe('induction.incomplete');

    const c = await content(s);
    const low = await s.sm.browser.put(
      `${s.base}/inductions/${ind.id}/draft`,
      { content: { ...c, passMark: 60 } },
      { 'if-match': etagOf(created) },
    );
    expect(low.json().code).toBe('validation_failed');

    const saved = await s.sm.browser.put(
      `${s.base}/inductions/${ind.id}/draft`,
      { content: c },
      { 'if-match': etagOf(created) },
    );
    expect(saved.statusCode).toBe(200);
    const draft = saved.json().draft;
    expect(saved.json().problems).toEqual([]);
    expect(draft.sections[4].blocks[1]).toMatchObject({
      type: 'swms',
      title: 'SWMS-004 Scaffold erection SWMS',
    });
    // Emergency questions are always critical; every question gets an id.
    expect(draft.quiz[0]).toMatchObject({ critical: true, id: expect.any(String) });

    const published = await s.sm.browser.post(
      `${s.base}/inductions/${ind.id}/publish`,
      { redo: 'none' },
      { 'if-match': etagOf(saved) },
    );
    expect(published.statusCode).toBe(201);
    // Nobody has done the first version, so everyone must.
    expect(published.json()).toMatchObject({ number: 1, redo: 'all', aiGenerated: false });
    expect(published.json().contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(published.json().declarationText).toContain('fit for work');

    const got = await s.sm.browser.get(`${s.base}/inductions/${ind.id}`);
    expect(got.json()).toMatchObject({
      status: 'published',
      currentVersion: { number: 1 },
      requiredVersion: { number: 1 },
    });
    // The consultant can't build inductions.
    expect((await s.eng.browser.get(`${s.base}/inductions`)).statusCode).toBe(403);

    // Published versions are indexed for Nova's worker Q&A once committed.
    const indexed = await t.adminDb.withTenantTx(
      {
        orgId: decodeId('org', s.org.id)!,
        userId: decodeId('user', s.sm.userId)!,
        principalType: 'member',
        orgRole: 'owner',
        entitlements: { plan: 'x', state: 'active', modules: [], limits: {} },
        requestId: 't',
      },
      ({ tx }) =>
        tx.execute(
          sql`select 1 from ai.ai_index_entries where revision_id = ${decodeId('inductionVersion', published.json().id)!}`,
        ),
    );
    expect(indexed.rows.length).toBe(1);
  });

  it('takes a worker through the induction on their phone, then lets them through the gate', async () => {
    const s = await setup('ind-take');
    const { induction, etag } = await publishInduction(s);

    // Not inducted and no white card: blocked at the gate (G2, G3).
    const blocked = await s.sub.browser.post(`${s.base}/attendance/sign-in`, { gateCode: s.code });
    expect(blocked.json().outcome).toBe('blocked');
    expect(blocked.json().eligibility.reasons.map((r: { code: string }) => r.code)).toEqual([
      'induction.missing',
      'white_card.missing',
    ]);

    const started = await s.sub.browser.post(`${s.base}/induction-completions`, {});
    expect(started.statusCode).toBe(200);
    const c = started.json();
    expect(c).toMatchObject({ status: 'in_progress', method: 'self', versionNumber: 1 });
    expect(c.content.quiz[0]).not.toHaveProperty('answerIndex');
    expect(c.content.swmsNotice).toContain("doesn't replace signing on");
    const url = `${s.base}/induction-completions/${c.id}`;
    // Starting again picks up the same one.
    expect((await s.sub.browser.post(`${s.base}/induction-completions`, {})).json().id).toBe(c.id);

    expect(
      (
        await s.sub.browser.post(`${url}/quiz-attempts`, {
          answers: answersFor(c, induction.draft),
        })
      ).json().code,
    ).toBe('induction.sections_not_viewed');
    for (let i = 0; i < c.content.sections.length; i++)
      await s.sub.browser.post(`${url}/progress`, { section: i, seconds: 30 });

    const failed = await s.sub.browser.post(`${url}/quiz-attempts`, {
      answers: answersFor(c, induction.draft, true),
    });
    expect(failed.json()).toMatchObject({ attempt: 1, passed: false, criticalMissed: true });
    expect(failed.json().reviewSections).toEqual(expect.arrayContaining([2, 3, 4, 7]));
    const sig = { format: 'svg', data: 'M10 10 L20 20' };
    const sign = { typedName: 'Sam Sub', signature: sig, fitForWork: true, agreed: true };
    expect((await s.sub.browser.post(`${url}/sign`, sign)).json().code).toBe(
      'induction.quiz_not_passed',
    );
    const passed = await s.sub.browser.post(`${url}/quiz-attempts`, {
      answers: answersFor(c, induction.draft),
    });
    expect(passed.json()).toMatchObject({ attempt: 2, passed: true, score: 100 });

    expect((await s.sub.browser.post(`${url}/sign`, sign)).json().code).toBe(
      'induction.white_card_required',
    );
    const photo = await uploadFile(
      t,
      s.sub.browser,
      s.org.id,
      s.project.id,
      'card.jpg',
      'workforce',
    );
    const card = await s.sub.browser.post(`${url}/credentials`, {
      kind: 'white_card',
      number: 'CGI 123456',
      issuingState: 'QLD',
      fileIds: [photo],
    });
    expect(card.statusCode).toBe(201);
    expect(card.json()).toMatchObject({ kind: 'white_card', status: 'recorded' });

    const done = await s.sub.browser.post(`${url}/sign`, {
      ...sign,
      clientAt: new Date(Date.now() - 5000).toISOString(),
    });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({ status: 'completed', quiz: { passed: true, attempts: 2 } });
    expect(done.json().expiresOn).toBe(addMonths(localDateOf(new Date(), TZ), 12));
    expect((await s.sub.browser.post(`${url}/sign`, sign)).json().code).toBe('induction.completed');

    // The sealed record holds the evidence (compliance/04 §3).
    const [row] = (
      await t.adminDb.withTenantTx(
        {
          orgId: decodeId('org', s.org.id)!,
          userId: decodeId('user', s.sm.userId)!,
          principalType: 'member',
          orgRole: 'owner',
          entitlements: { plan: 'x', state: 'active', modules: [], limits: {} },
          requestId: 't',
        },
        ({ tx }) =>
          tx.execute(sql`select evidence_hash, ip, typed_name, device_at from workforce.induction_completions
                         where id = ${decodeId('inductionCompletion', c.id)!}`),
      )
    ).rows as Array<{ evidence_hash: string; ip: string; typed_name: string; device_at: Date }>;
    expect(row).toMatchObject({
      typed_name: 'Sam Sub',
      evidence_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(row!.ip).toBeTruthy();
    expect(row!.device_at).toBeTruthy();

    const inNow = await s.sub.browser.post(`${s.base}/attendance/sign-in`, { gateCode: s.code });
    expect(inNow.json()).toMatchObject({
      outcome: 'accepted',
      eligibility: { result: 'eligible', reasons: [] },
    });

    // Another company can't open this worker's induction or cards; the consultant can't either.
    expect((await s.sub2.browser.get(url)).json().code).toBe('induction.completion_not_found');
    const workerId = c.worker.id;
    expect(
      (await s.sub2.browser.get(`${s.base}/workers/${workerId}/credentials`)).json().code,
    ).toBe('worker.not_found');
    expect((await s.eng.browser.get(`${s.base}/workers/${workerId}/credentials`)).statusCode).toBe(
      403,
    );
    // The site manager sights the card.
    const cards = await s.sm.browser.get(`${s.base}/workers/${workerId}/credentials`);
    expect(cards.json().data).toHaveLength(1);
    const sighted = await s.sm.browser.post(
      `${s.base}/workers/${workerId}/credentials/${card.json().id}/sight`,
      undefined,
      { 'if-match': '"1"' },
    );
    expect(sighted.json()).toMatchObject({ status: 'sighted', sightedBy: s.sm.userId });

    const register = await s.sm.browser.get(`${s.base}/induction-register`);
    expect(register.json()).toMatchObject({ requiredVersion: 1 });
    expect(register.json().data).toEqual([
      expect.objectContaining({
        status: 'current',
        completion: expect.objectContaining({ versionNumber: 1, score: 100, method: 'self' }),
        credentials: [{ kind: 'white_card', status: 'sighted', expiresOn: null }],
      }),
    ]);

    // A material change: everyone redoes it before their next sign-in (IND-AC10).
    await s.sub.browser.post(`${s.base}/attendance/sign-out`, { gateCode: s.code });
    const v2 = await s.sm.browser.post(
      `${s.base}/inductions/${induction.id}/publish`,
      { redo: 'all', changeNote: 'New assembly point' },
      { 'if-match': etag },
    );
    expect(v2.json()).toMatchObject({ number: 2, redo: 'all' });
    const again = await s.sub.browser.post(`${s.base}/attendance/sign-in`, { gateCode: s.code });
    expect(again.json().outcome).toBe('blocked');
    expect(again.json().eligibility.reasons).toEqual([
      { code: 'induction.outdated', blocking: true, requiredVersion: 2, completedVersion: 1 },
    ]);
    expect((await s.sm.browser.get(`${s.base}/induction-register`)).json().data[0].status).toBe(
      'needs_reinduction',
    );

    // The site manager takes them through it on the gate tablet.
    expect(
      (await s.sub2.browser.post(`${s.base}/induction-completions`, { workerId })).statusCode,
    ).toBe(403);
    const assisted = await s.sm.browser.post(`${s.base}/induction-completions`, { workerId });
    expect(assisted.json()).toMatchObject({
      method: 'assisted',
      versionNumber: 2,
      worker: { id: workerId },
      credentials: [expect.objectContaining({ status: 'sighted' })],
    });
  });

  it('holds a Nova-drafted induction until a person approves every section', async () => {
    const s = await setup('ind-nova');
    const created = await s.sm.browser.post(`${s.base}/inductions`, { title: 'Nova draft' });
    const ind = created.json();
    const aiSuggestionId = encodeId('aiSuggestion', uuidv7());
    const saved = await s.sm.browser.put(
      `${s.base}/inductions/${ind.id}/draft`,
      { content: await content(s), aiSuggestionId },
      { 'if-match': etagOf(created) },
    );
    expect(saved.json().draftAiSuggestionId).toBe(aiSuggestionId);
    expect(saved.json().problems).toHaveLength(9);
    expect(
      (
        await s.sm.browser.post(
          `${s.base}/inductions/${ind.id}/publish`,
          { redo: 'all' },
          { 'if-match': etagOf(saved) },
        )
      ).json().code,
    ).toBe('induction.not_approved');

    let etag = etagOf(saved);
    let last = saved.json();
    for (let i = 0; i < 9; i++) {
      const r = await s.sm.browser.post(
        `${s.base}/inductions/${ind.id}/draft/approvals`,
        { section: i },
        { 'if-match': etag },
      );
      expect(r.statusCode).toBe(200);
      etag = etagOf(r);
      last = r.json();
    }
    expect(last.problems).toEqual([]);

    // Editing a section after approving it needs a fresh approval for that section only.
    const edited = structuredClone(last.draft);
    edited.sections[1].blocks[0].body = 'Toilets are behind the site shed.';
    const changed = await s.sm.browser.put(
      `${s.base}/inductions/${ind.id}/draft`,
      { content: edited },
      { 'if-match': etag },
    );
    expect(changed.json().problems.map((p: { path: string }) => p.path)).toEqual([
      'sections/1/approval',
    ]);
    const reapproved = await s.sm.browser.post(
      `${s.base}/inductions/${ind.id}/draft/approvals`,
      { section: 1 },
      { 'if-match': etagOf(changed) },
    );
    const published = await s.sm.browser.post(
      `${s.base}/inductions/${ind.id}/publish`,
      { redo: 'all' },
      { 'if-match': etagOf(reapproved) },
    );
    expect(published.statusCode).toBe(201);
    expect(published.json()).toMatchObject({ aiGenerated: true, approvedBy: [s.sm.userId] });
    const full = await s.sm.browser.get(
      `${s.base}/inductions/${ind.id}/versions/${published.json().id}`,
    );
    expect(full.json().content.sections[1].blocks[0].body).toBe(
      'Toilets are behind the site shed.',
    );
  });
});
