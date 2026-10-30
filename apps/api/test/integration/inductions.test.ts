import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { decodeId, encodeId, uuidv7 } from '@archova/domain';
import { addMonths } from '@archova/mod-workforce';
import { hexToBase64, quarantineKey } from '@archova/mod-files';
import { localDateOf } from '@archova/time';
import { createHash } from 'node:crypto';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  uploadFile,
  Browser,
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

    // A worker holding only the sign-in permission downloads the induction's own video, and no other file.
    const videoId = c.content.sections[0].blocks.find((b: { type: string }) => b.type === 'video')
      .fileId as string;
    const dl = await s.sub.browser.get(`${url}/files/${videoId}/download`);
    expect(dl.statusCode).toBe(200);
    expect(dl.json().url).toEqual(expect.any(String));
    const unrelated = await uploadFile(t, s.pm.browser, s.org.id, s.project.id, 'plans.pdf');
    expect((await s.sub.browser.get(`${url}/files/${unrelated}/download`)).statusCode).toBe(404);
    // Another worker cannot use this worker's completion to reach the file.
    expect((await s.sub2.browser.get(`${url}/files/${videoId}/download`)).statusCode).toBe(404);

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
  describe('over an access link (X45)', () => {
    const MOBILE = '+61412345678';
    const COOKIE = '__Host-lnk';

    async function openLink(s: Setup, inductionId: string, body: Record<string, unknown> = {}) {
      const res = await s.sm.browser.post(`${s.base}/inductions/${inductionId}/links`, {
        label: 'Formco crew',
        ...body,
      });
      expect(res.statusCode).toBe(201);
      const link = res.json() as { token: string; url: string; link: { id: string } };
      const guest = new Browser(t.app);
      const opened = await guest.post('/v1/induction-access', { token: link.token });
      return { link, guest, opened };
    }

    async function verifyMobile(guest: Browser, s: Setup, name: string, mobile = MOBILE) {
      const sent = await guest.post('/v1/induction-access/codes', { channel: 'sms', to: mobile });
      expect(sent.statusCode).toBe(202);
      const last = t.messages.sent.filter((m) => m.to === mobile).at(-1)!;
      const code = /(\d{6}) is your/.exec(last.text)![1]!;
      const access = (await guest.get('/v1/induction-access')).json();
      const company = access.companies.find((c: { name: string }) => c.name === 'Formco');
      return {
        code,
        verify: (extra: Record<string, unknown> = {}, useCode = code) =>
          guest.post('/v1/induction-access/verify', {
            code: useCode,
            fullName: name,
            companyId: company.id,
            ...extra,
          }),
      };
    }

    it('lets a worker with no account do the induction on their phone, verified by SMS', async () => {
      const s = await setup('ind-link');
      const { induction, version } = await publishInduction(s);

      // Only people who run inductions can make links.
      expect(
        (await s.sub.browser.post(`${s.base}/inductions/${induction.id}/links`, {})).statusCode,
      ).toBe(403);

      const { link, guest, opened } = await openLink(s, induction.id);
      expect(link.url).toMatch(/\/i\/arl_/);
      expect(opened.statusCode).toBe(200);
      expect(opened.headers['referrer-policy']).toBe('no-referrer');
      expect(opened.headers['x-robots-tag']).toContain('noindex');
      expect(guest.cookies.has(COOKIE)).toBe(true);
      expect(opened.json()).toMatchObject({
        inductionTitle: 'Wharf St induction',
        versionNumber: version.number,
        verified: false,
        worker: null,
        completionStatus: 'not_started',
        sectionCount: 9,
      });
      expect(opened.json().companies.map((c: { name: string }) => c.name)).toContain('Formco');

      // A link that doesn't exist, or a session that doesn't, says nothing about the record.
      const unknown = await new Browser(t.app).post('/v1/induction-access', {
        token: `arl_${'A'.repeat(64)}`,
      });
      expect(unknown.statusCode).toBe(410);
      expect(unknown.json().code).toBe('access_link.invalid');
      expect((await new Browser(t.app).get('/v1/induction-access')).json().code).toBe(
        'access_link.session_required',
      );

      // Nothing past the first page until the mobile is verified.
      expect((await guest.get('/v1/induction-access/completion')).json().code).toBe(
        'access_link.not_verified',
      );
      const v = await verifyMobile(guest, s, 'Pat Plasterer');
      expect((await v.verify({}, v.code === '000000' ? '111111' : '000000')).json().code).toBe(
        'access_link.code_invalid',
      );
      const verified = await v.verify();
      expect(verified.statusCode).toBe(200);
      expect(verified.json()).toMatchObject({
        verified: true,
        verifiedTo: '+61•••••678',
        worker: { fullName: 'Pat Plasterer', companyName: 'Formco', returning: false },
        completionStatus: 'in_progress',
      });
      // A code works once.
      expect((await v.verify()).json().code).toBe('access_link.code_expired');

      const c = (await guest.get('/v1/induction-access/completion')).json();
      expect(c).toMatchObject({ status: 'in_progress', method: 'link' });
      expect(c.worker.phone).toBeNull();
      expect(c.content.quiz[0]).not.toHaveProperty('answerIndex');
      for (let i = 0; i < c.content.sections.length; i++)
        await guest.post('/v1/induction-access/progress', { section: i, seconds: 20 });
      const answers = answersFor(c, induction.draft);
      expect(
        (
          await guest.post('/v1/induction-access/quiz-attempts', {
            answers: answersFor(c, induction.draft, true),
          })
        ).json(),
      ).toMatchObject({ passed: false });
      expect(
        (await guest.post('/v1/induction-access/quiz-attempts', { answers })).json(),
      ).toMatchObject({ passed: true, score: 100 });

      // The induction's own video downloads; no other file does.
      const videoId = c.content.sections[0].blocks.find((b: { type: string }) => b.type === 'video')
        .fileId as string;
      expect((await guest.get(`/v1/induction-access/files/${videoId}/download`)).statusCode).toBe(
        200,
      );
      const other = await uploadFile(t, s.pm.browser, s.org.id, s.project.id, 'plans.pdf');
      expect((await guest.get(`/v1/induction-access/files/${other}/download`)).statusCode).toBe(
        404,
      );

      // The white card photo goes through the normal upload checks and scan.
      const bytes = 'card photo bytes';
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const up = await guest.post('/v1/induction-access/uploads', {
        filename: 'card.jpg',
        mime: 'image/jpeg',
        sizeBytes: bytes.length,
        sha256,
      });
      expect(up.statusCode).toBe(201);
      t.store.put(
        quarantineKey(decodeId('upload', up.json().id)!),
        bytes.length,
        hexToBase64(sha256),
      );
      const stored = await guest.post(`/v1/induction-access/uploads/${up.json().id}/complete`);
      expect(stored.json()).toMatchObject({ status: 'ready', module: 'workforce' });
      // Someone else's file, even in this project, can't be put on a card.
      const cardFor = (fileIds: string[]) =>
        guest.post('/v1/induction-access/credentials', {
          kind: 'white_card',
          number: 'CGI 777888',
          issuingState: 'QLD',
          fileIds,
        });
      expect((await cardFor([other])).json().code).toBe('file.not_in_project');
      expect((await cardFor([stored.json().id])).statusCode).toBe(201);

      const signed = await guest.post('/v1/induction-access/sign', {
        typedName: 'Pat Plasterer',
        signature: { format: 'svg', data: 'M1 1 L5 5' },
        fitForWork: true,
        agreed: true,
      });
      expect(signed.statusCode).toBe(200);
      expect(signed.json()).toMatchObject({ status: 'completed', method: 'link' });

      // The verified number is in the sealed evidence.
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
            tx.execute(sql`select method, verified_channel, verified_to, access_link_id, evidence_hash
                           from workforce.induction_completions
                           where id = ${decodeId('inductionCompletion', c.id)!}`),
        )
      ).rows as Array<Record<string, string>>;
      expect(row).toMatchObject({
        method: 'link',
        verified_channel: 'sms',
        verified_to: MOBILE,
        access_link_id: decodeId('accessLink', link.link.id),
      });
      expect(row!.evidence_hash).toMatch(/^[0-9a-f]{64}$/);

      // Ask Nova answers from this induction only; an untranslatable language says so plainly.
      const asked = await guest.post('/v1/induction-access/questions', {
        question: 'Where is the assembly point?',
      });
      expect(asked.statusCode).toBe(200);
      expect(asked.json()).toEqual({
        found: expect.any(Boolean),
        answer: expect.any(String),
        citations: expect.any(Array),
      });
      const tr = await guest.post('/v1/induction-access/translation', { lang: 'zz' });
      expect(tr.json().code).toBe('ai.translation.language_unavailable');

      // The site manager sees the link used; the register shows the worker as inducted by link.
      const links = (await s.sm.browser.get(`${s.base}/inductions/${induction.id}/links`)).json();
      expect(links.data[0]).toMatchObject({ state: 'active', useCount: 1, label: 'Formco crew' });
      expect((await s.sm.browser.get(`${s.base}/induction-register`)).json().data[0]).toMatchObject(
        {
          status: 'current',
          completion: { method: 'link' },
        },
      );

      // The same person on another link is welcomed back and keeps their record.
      const second = await openLink(s, induction.id, { label: 'Second' });
      const again = await verifyMobile(second.guest, s, 'Pat P');
      expect((await again.verify()).json()).toMatchObject({
        worker: { fullName: 'Pat Plasterer', returning: true },
        completionStatus: 'completed',
      });

      // Revoking works at once, for new visitors and for browsers already in.
      const revoked = await s.sm.browser.post(
        `${s.base}/inductions/${induction.id}/links/${link.link.id}/revoke`,
      );
      expect(revoked.json()).toMatchObject({ state: 'revoked' });
      expect((await guest.get('/v1/induction-access')).json().code).toBe('access_link.invalid');
      expect(
        (await new Browser(t.app).post('/v1/induction-access', { token: link.token })).json().code,
      ).toBe('access_link.invalid');
    });

    it('limits one-time codes: five tries, then a new code', async () => {
      const s = await setup('ind-link-codes');
      const { induction } = await publishInduction(s);
      const { guest } = await openLink(s, induction.id, { maxUses: 2 });
      const mobile = '+61498765432';
      const v = await verifyMobile(guest, s, 'Lee Labourer', mobile);
      const wrong = v.code === '123456' ? '654321' : '123456';
      for (let i = 0; i < 4; i++)
        expect((await v.verify({}, wrong)).json().code).toBe('access_link.code_invalid');
      expect((await v.verify({}, wrong)).json().code).toBe('access_link.code_expired');
      // The right code no longer works once attempts are used up; a fresh one does.
      expect((await v.verify()).json().code).toBe('access_link.code_expired');
      const fresh = await verifyMobile(guest, s, 'Lee Labourer', mobile);
      expect((await fresh.verify()).statusCode).toBe(200);
      // A third code in the hour is refused.
      await guest.post('/v1/induction-access/codes', { channel: 'sms', to: mobile });
      const third = await guest.post('/v1/induction-access/codes', { channel: 'sms', to: mobile });
      expect(third.json().code).toBe('access_link.too_many_codes');
    });

    it('maxUses counts openings and never ends a session already open', async () => {
      const s = await setup('ind-link-uses');
      const { induction } = await publishInduction(s);
      const first = await openLink(s, induction.id, { maxUses: 2 });
      const second = new Browser(t.app);
      expect(
        (await second.post('/v1/induction-access', { token: first.link.token })).statusCode,
      ).toBe(200);
      // Both people are in, and the link is now used up for anyone new.
      expect((await first.guest.get('/v1/induction-access')).statusCode).toBe(200);
      expect((await second.get('/v1/induction-access')).statusCode).toBe(200);
      const third = await new Browser(t.app).post('/v1/induction-access', {
        token: first.link.token,
      });
      expect(third.json().code).toBe('access_link.invalid');
      expect((await first.guest.get('/v1/induction-access')).statusCode).toBe(200);
    });

    it('sends codes only to Australian mobiles, and to the named recipient when there is one', async () => {
      const s = await setup('ind-link-dest');
      const { induction } = await publishInduction(s);
      const open = await openLink(s, induction.id);
      const abroad = await open.guest.post('/v1/induction-access/codes', {
        channel: 'sms',
        to: '+14155550123',
      });
      expect(abroad.json().code).toBe('validation_failed');
      expect(t.messages.sent.some((m) => m.to === '+14155550123')).toBe(false);

      const named = await openLink(s, induction.id, { recipientPhone: '+61412000111' });
      const other = await named.guest.post('/v1/induction-access/codes', {
        channel: 'sms',
        to: '+61412000222',
      });
      expect(other.json().code).toBe('validation_failed');
      const ok = await named.guest.post('/v1/induction-access/codes', {
        channel: 'sms',
        to: '+61412000111',
      });
      expect(ok.statusCode).toBe(202);
    });

    it('stops working when its creator loses access', async () => {
      const s = await setup('ind-link-creator');
      const { induction } = await publishInduction(s);
      const { guest } = await openLink(s, induction.id);
      expect((await guest.get('/v1/induction-access')).statusCode).toBe(200);
      // There is no remove-member route yet, so end the creator's membership directly.
      await t.adminDb.withTenantTx(
        {
          orgId: decodeId('org', s.org.id)!,
          userId: decodeId('user', s.pm.userId)!,
          principalType: 'member',
          orgRole: 'owner',
          entitlements: { plan: 'x', state: 'active', modules: [], limits: {} },
          requestId: 't',
        },
        ({ tx }) =>
          tx.execute(sql`update platform.project_members set status = 'removed', removed_at = now(), removal_kind = 'ordinary'
                         where user_id = ${decodeId('user', s.sm.userId)!}`),
      );
      expect((await guest.get('/v1/induction-access')).json().code).toBe('access_link.invalid');
    });
  });
});
