import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeId } from '@archova/domain';
import { DEFAULT_FAKE_RESPONDERS } from '@archova/mod-ai';
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

async function pdf(pages: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([595, 842]);
    lines.forEach((text, i) => page.drawText(text, { x: 50, y: 780 - i * 22, size: 11, font }));
  }
  return doc.save();
}

/** A 1 x 1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function setup() {
  const pm = await signUp(t.app, 'rfia-pm');
  const eng = await signUp(t.app, 'rfia-eng');
  const sub = await signUp(t.app, 'rfia-sub');
  const org = await createOrg(pm.browser, 'Answer Builders');
  const project = await createProject(pm.browser, org.id, { name: 'Harbourside', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, eng.email, 'Consultant', 'Fire Eng Co');
  const subCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    sub.email,
    'Subcontractor',
    'Plumbco',
  );

  const folder = (await pm.browser.post(`${base}/folders`, { name: 'Specifications' })).json();
  const fileId = await uploadBytes(
    t,
    pm.browser,
    org.id,
    project.id,
    await pdf([
      [
        '0821.3.2 FIRE RESISTANCE LEVELS',
        'Walls to the Level 3 corridor shall achieve an FRL of 90/90/90.',
        'Riser walls shall achieve an FRL of 120/120/120.',
      ],
    ]),
  );
  const doc = await pm.browser.post(`${base}/documents`, {
    folderId: folder.id,
    title: 'Fire Protection Specification',
    docNumber: 'SPEC-0821',
    revision: { rev: 'C', fileId },
  });
  expect(doc.statusCode).toBe(201);
  expect((await pm.browser.post(`${base}/ai/index`)).statusCode).toBe(200);
  return { pm, eng, sub, subCo, org, project, base, documentId: doc.json().document.id as string };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function raiseRfi(s: Setup, subject: string, question: string, open: boolean) {
  const draft = await s.pm.browser.post(`${s.base}/rfis`, {
    subject,
    question,
    assigneeIds: [s.eng.userId],
  });
  expect(draft.statusCode).toBe(201);
  const rfi = draft.json().rfi;
  if (open) {
    const opened = await s.pm.browser.post(`${s.base}/rfis/${rfi.id}/open`, undefined, {
      'if-match': draft.headers.etag as string,
    });
    expect(opened.statusCode).toBe(200);
  }
  return rfi.id as string;
}

const QUESTION = 'Which FRL governs the riser walls at the Level 3 corridor?';
const answer = (s: Setup, rfiId: string, body: object = {}, who: 'pm' | 'eng' | 'sub' = 'pm') =>
  s[who].browser.post(`${s.base}/ai/rfis/${rfiId}/answer-drafts`, body);
const usage = async (s: Setup) =>
  (await s.pm.browser.get(`/v1/orgs/${s.org.id}/ai/usage`)).json() as {
    byFeature: Array<{ feature: string; credits: number }>;
  };
const credits = (u: Awaited<ReturnType<typeof usage>>) =>
  u.byFeature.find((f) => f.feature === 'rfi_draft')?.credits ?? 0;

describe('Nova drafts a response to an RFI (F3)', () => {
  it('drafts from the question and the spec, with earlier RFIs as precedent but never the RFI itself', async () => {
    const s = await setup();
    const rfi = await raiseRfi(s, 'Riser wall fire rating at Level 3', QUESTION, true);
    const earlier = await raiseRfi(
      s,
      'Riser wall FRL at Level 2',
      'Which FRL do the riser walls take at the Level 2 corridor?',
      true,
    );
    expect((await s.pm.browser.post(`${s.base}/ai/index`)).statusCode).toBe(200);
    const before = credits(await usage(s));

    const res = await answer(s, rfi);
    expect(res.statusCode, res.body).toBe(200);
    const d = res.json();
    expect(d.runId).toMatch(/^air_/);
    expect(d.suggestionId).toMatch(/^ais_/);
    expect(d.rfiId).toBe(rfi);
    expect(d.basis).toBe('documents');
    expect(d.answer).toContain('FRL of 90/90/90');
    // It cites the spec, and the earlier RFI as a precedent; never the RFI it is answering.
    expect(d.references.map((r: { sourceId: string }) => r.sourceId).sort()).toEqual(
      [s.documentId, earlier].sort(),
    );
    expect(d.references).toContainEqual(
      expect.objectContaining({
        sourceType: 'document',
        sourceId: s.documentId,
        reference: 'SPEC-0821',
        page: 1,
      }),
    );
    expect(d.unsupportedNumbers).toEqual([]);
    expect(d.attachments).toEqual([]);

    // The model saw the thread and the passages the PM can open: the spec and the earlier RFI, not this RFI.
    const call = t.ai.calls.at(-1)!;
    expect(call.task).toBe('rfi.answer');
    expect(call.text).toContain('<number>RFI-001</number>');
    expect(call.text).toContain(`<question>${QUESTION}</question>`);
    expect(call.images).toEqual([]);
    expect(call.passages.map((p) => p.text).join('\n')).toContain('FRL of 90/90/90');
    const rfiSources = call.passages.filter((p) => p.source.type === 'rfi').map((p) => p.source.id);
    expect(rfiSources).toContain(decodeId('rfi', earlier));
    expect(rfiSources).not.toContain(decodeId('rfi', rfi));

    // One credit for the draft; the search embedding is free.
    expect(credits(await usage(s)) - before).toBe(1);
  });

  it('follows the direction, and says when nothing in the project supports the answer', async () => {
    const s = await setup();
    const covered = await raiseRfi(s, 'Riser wall fire rating at Level 3', QUESTION, true);
    const direction = 'Build the shared riser wall to FRL 120/120/120.';
    const directed = (await answer(s, covered, { direction })).json();
    expect(directed.answer).toContain(direction);
    expect(t.ai.calls.at(-1)!.text).toContain(`<direction>${direction}</direction>`);
    expect(directed.basis).toBe('documents');
    expect(directed.unsupportedNumbers).toEqual([]);

    // Nothing in the specification touches this one.
    const open = await raiseRfi(
      s,
      'Letterbox colour',
      'What colour should the letterboxes at the street entry be?',
      true,
    );
    const none = (await answer(s, open)).json();
    expect(none).toMatchObject({ basis: 'none', references: [] });
    expect(none.needsDecision).toHaveLength(1);
    // With the person's direction, the draft rests on that and says so.
    const told = (
      await answer(s, open, { direction: 'Powder-coated black, as the architect said.' })
    ).json();
    expect(told).toMatchObject({ basis: 'direction', needsDecision: [] });
    // A number the draft states that is nowhere in the thread or the documents is listed for the person.
    const odd = (
      await answer(s, open, { direction: 'Mount them 1400 mm above the footpath.' })
    ).json();
    expect(odd.unsupportedNumbers).toEqual([]);
    t.ai.on('rfi.answer', () => ({
      output: {
        answer: 'The letterboxes are to be 900 mm wide.',
        references: [],
        needsDecision: [],
      },
    }));
    try {
      const made = (await answer(s, open)).json();
      expect(made.unsupportedNumbers).toEqual(['900']);
    } finally {
      t.ai.on('rfi.answer', DEFAULT_FAKE_RESPONDERS['rfi.answer']!);
    }
  });

  it('reads the photos and PDFs attached to earlier responses, and tells the screen which it used', async () => {
    const s = await setup();
    const rfi = await raiseRfi(s, 'Riser wall fire rating at Level 3', QUESTION, true);
    const photo = await uploadBytes(
      t,
      s.eng.browser,
      s.org.id,
      s.project.id,
      PNG,
      'riser.png',
      'image/png',
    );
    const sketch = await uploadBytes(
      t,
      s.eng.browser,
      s.org.id,
      s.project.id,
      await pdf([
        [
          'SK-12 riser wall detail',
          'Shaft wall to achieve FRL 120/120/120 with 2 layers of 16 mm board',
        ],
      ]),
      'SK-12.pdf',
    );
    // A scan has no text layer, so there is nothing for Nova to read in it.
    const scan = await uploadBytes(
      t,
      s.eng.browser,
      s.org.id,
      s.project.id,
      await pdf([[]]),
      'scan.pdf',
    );
    const replied = await s.eng.browser.post(`${s.base}/rfis/${rfi}/responses`, {
      body: 'See the attached sketch and photo. Riser walls take the higher rating.',
      fileIds: [photo, sketch, scan],
    });
    expect(replied.statusCode, replied.body).toBe(201);

    const d = (await answer(s, rfi, { direction: "Confirm the engineer's reply." })).json();
    expect(d.attachments).toEqual([
      { fileId: scan, name: 'scan.pdf', read: false },
      { fileId: sketch, name: 'SK-12.pdf', read: true },
      { fileId: photo, name: 'riser.png', read: true },
    ]);
    const call = t.ai.calls.at(-1)!;
    expect(call.images).toEqual([{ mime: 'image/png', base64: PNG.toString('base64') }]);
    expect(call.text).toContain('<attachment name="SK-12.pdf">');
    expect(call.text).toContain('FRL 120/120/120 with 2 layers of 16 mm board');
    // The engineer's response is part of the thread, marked as theirs and not the asker's.
    expect(call.text).toContain(
      '<response official="false" yours="false">See the attached sketch and photo.',
    );
    // Numbers from the attached sketch are known to the person, so they are not flagged.
    expect(d.unsupportedNumbers).toEqual([]);

    // The engineer answering their own thread sees their response marked as theirs.
    await answer(s, rfi, {}, 'eng');
    expect(t.ai.calls.at(-1)!.text).toContain('<response official="false" yours="true">');
  });

  it('drafts only for someone who could send the response', async () => {
    const s = await setup();
    const sent = await raiseRfi(s, 'Riser wall fire rating at Level 3', QUESTION, true);
    const unsent = await raiseRfi(s, 'Corridor wall rating', 'Draft only', false);

    // A subcontractor the RFI was never sent to can't see it.
    const hidden = await answer(s, sent, {}, 'sub');
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json().code).toBe('rfi.not_found');
    // A subcontractor it was sent a copy of can read it but not answer it, so Nova doesn't draft for them.
    const copied = await s.pm.browser.post(`${s.base}/rfis`, {
      subject: 'Riser wall fire rating at Level 3',
      question: QUESTION,
      assigneeIds: [s.eng.userId],
      distributionCompanyIds: [s.subCo.companyId],
    });
    expect(copied.statusCode).toBe(201);
    const copiedId = copied.json().rfi.id as string;
    await s.pm.browser.post(`${s.base}/rfis/${copiedId}/open`, undefined, {
      'if-match': copied.headers.etag as string,
    });
    expect((await s.sub.browser.get(`${s.base}/rfis/${copiedId}`)).statusCode).toBe(200);
    const copy = await answer(s, copiedId, {}, 'sub');
    expect(copy.statusCode).toBe(403);
    expect(copy.json().code).toBe('rfi.response_not_allowed');
    // An RFI that is still a draft takes no responses, so there is nothing to answer.
    const draft = await answer(s, unsent);
    expect(draft.statusCode).toBe(409);
    expect(draft.json().code).toBe('rfi.invalid_transition');
    // Not an RFI of this project.
    expect((await answer(s, `rfi_${'0'.repeat(26)}`)).statusCode).toBe(404);
    expect((await answer(s, 'rfi_nope')).statusCode).toBe(404);

    // The assignee can, and the builder's RFIs are not among what they search.
    const asked = await answer(s, sent, {}, 'eng');
    expect(asked.statusCode, asked.body).toBe(200);
    expect(t.ai.calls.at(-1)!.passages.filter((p) => p.source.type === 'rfi')).toEqual([]);
  });

  it('keeps each draft as a private suggestion that the response it leads to is linked to', async () => {
    const s = await setup();
    const rfi = await raiseRfi(s, 'Riser wall fire rating at Level 3', QUESTION, true);
    const mine = (await answer(s, rfi)).json();

    const listed = (await s.pm.browser.get(`${s.base}/ai/suggestions?task=rfi.answer`)).json();
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]).toMatchObject({
      id: mine.suggestionId,
      task: 'rfi.answer',
      targetType: 'rfi',
      targetId: rfi,
      status: 'pending',
      runId: mine.runId,
      payload: {
        rfiId: rfi,
        basis: 'documents',
        needsDecision: [],
        references: [{ sourceType: 'document', sourceId: s.documentId, page: 1 }],
      },
    });
    // Someone else on the project can't see it or decide it, even the assignee who may answer the same RFI.
    for (const who of [s.eng, s.sub])
      expect(
        (await who.browser.get(`${s.base}/ai/suggestions?task=rfi.answer`)).json().data,
      ).toEqual([]);
    const stolen = await s.eng.browser.post(
      `${s.base}/ai/suggestions/${mine.suggestionId}/decision`,
      { decision: 'accepted' },
    );
    expect(stolen.statusCode).toBe(404);

    // Sending the draft as the response records where it came from.
    const sentResponse = await s.pm.browser.post(`${s.base}/rfis/${rfi}/responses`, {
      body: mine.answer,
      aiSuggestionId: mine.suggestionId,
    });
    expect(sentResponse.statusCode, sentResponse.body).toBe(201);
    expect(sentResponse.json().responses.at(-1)).toMatchObject({
      aiSuggestionId: mine.suggestionId,
    });
    const decided = await s.pm.browser.post(
      `${s.base}/ai/suggestions/${mine.suggestionId}/decision`,
      { decision: 'accepted' },
    );
    expect(decided.statusCode).toBe(200);
    expect(decided.json()).toMatchObject({ id: mine.suggestionId, status: 'accepted' });
  });
});
