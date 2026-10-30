import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
