import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeId } from '@archova/domain';
import { DEFAULT_FAKE_RESPONDERS } from '@archova/mod-ai';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  outboxData,
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

async function setup() {
  const pm = await signUp(t.app, 'rfid-pm');
  const eng = await signUp(t.app, 'rfid-eng');
  const sub = await signUp(t.app, 'rfid-sub');
  const org = await createOrg(pm.browser, 'Draft Builders');
  const project = await createProject(pm.browser, org.id, { name: 'Harbourside', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, eng.email, 'Consultant', 'Fire Eng Co');
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Plumbco');

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
  return { pm, eng, sub, org, project, base, documentId: doc.json().document.id as string };
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

describe('Nova RFI drafts (F3)', () => {
  it('drafts from a note with references, similar RFIs and suggested assignees', async () => {
    const s = await setup();
    const asked = await raiseRfi(
      s,
      'Level 3 corridor wall fire rating at riser',
      'Which FRL governs the riser wall?',
      true,
    );
    // A draft nobody has sent isn't "already asked".
    await raiseRfi(s, 'Corridor wall fire rating', 'Draft only', false);
    await raiseRfi(s, 'Driveway pit location', 'Where does pit SW4 go?', true);

    const res = await s.pm.browser.post(`${s.base}/ai/rfi-drafts`, {
      note: 'Level 3 corridor wall at the riser: FRL 90/90/90 or 120/120/120? Which governs the fire rating',
    });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.runId).toMatch(/^air_/);
    expect(d.subject).toContain('Level 3 corridor wall');
    expect(d.discipline).toBe('fire');
    expect(d.references).toHaveLength(1);
    expect(d.references[0]).toMatchObject({
      sourceType: 'document',
      sourceId: s.documentId,
      reference: 'SPEC-0821',
      page: 1,
    });
    expect(d.unsupportedNumbers).toEqual([]);
    expect(d.similarRfis).toEqual([
      {
        id: asked,
        number: 'RFI-001',
        subject: 'Level 3 corridor wall fire rating at riser',
        status: 'open',
      },
    ]);
    expect(d.suggestedAssigneeIds).toEqual([s.eng.userId]);
    // The model saw the spec passage the PM can open.
    const call = t.ai.calls.at(-1)!;
    expect(call.task).toBe('rfi.draft');
    expect(call.passages.map((p) => p.text).join('\n')).toContain('FRL of 90/90/90');
    const usage = (await s.pm.browser.get(`/v1/orgs/${s.org.id}/ai/usage`)).json();
    // The note's embedding (free) and the draft (one credit).
    expect(usage.byFeature).toContainEqual({ feature: 'rfi_draft', credits: 1, runs: 2 });

    // A subcontractor only hears about RFIs they could open themselves.
    const fromSub = await s.sub.browser.post(`${s.base}/ai/rfi-drafts`, {
      note: 'Level 3 corridor wall at the riser: which fire rating governs',
    });
    expect(fromSub.statusCode).toBe(200);
    expect(fromSub.json()).toMatchObject({ similarRfis: [], suggestedAssigneeIds: [] });
  });

  it('lists numbers it cannot trace, drops invalid citations and needs RFI create access', async () => {
    const s = await setup();
    t.ai.on('rfi.draft', (req) => ({
      output: {
        subject: 'L3 corridor wall FRL',
        question: 'Please confirm the corridor wall achieves FRL 90/90/90 with a 13 mm board.',
        discipline: 'fire',
        references: [
          { passageId: req.passages[0]!.id, quote: 'achieve an FRL of 90/90/90' },
          { passageId: 'p99', quote: 'made up' },
        ],
        keywords: ['corridor wall'],
        gaps: ['impact'],
      },
    }));
    try {
      const d = (
        await s.pm.browser.post(`${s.base}/ai/rfi-drafts`, { note: 'L3 corridor wall rating?' })
      ).json();
      expect(d.unsupportedNumbers).toEqual(['13']);
      expect(d.references).toHaveLength(1);
      expect(d.references[0].quote).toBe('achieve an FRL of 90/90/90');
      expect(d.gaps).toEqual(['impact']);
      expect(d.similarRfis).toEqual([]);
      expect(d.suggestedAssigneeIds).toEqual([]);
    } finally {
      t.ai.on('rfi.draft', DEFAULT_FAKE_RESPONDERS['rfi.draft']!);
    }

    // Someone outside the project can't draft on it.
    const stranger = await signUp(t.app, 'rfid-stranger');
    const denied = await stranger.browser.post(`${s.base}/ai/rfi-drafts`, { note: 'Anything' });
    expect([403, 404]).toContain(denied.statusCode);
  });
});

describe('Nova RFI drafts from a drawing markup (F3)', () => {
  /** A4 sheet with one line of text every 22 points from the top left (about 0.026 of the sheet apart). */
  const SHEET = [
    'GENERAL NOTES',
    'CORRIDOR WALL FRL 90/90/90',
    'RISER CUPBOARD R3.2 WALLS FRL 120/120/120',
    'GRID C',
    '',
    '',
    '',
    '',
    'STORMWATER PIT SW4 FAR FROM THE MARKUP',
  ];

  async function markedSheet() {
    const s = await setup();
    const set = (await s.pm.browser.post(`${s.base}/drawing-sets`, { name: 'IFC 1' })).json();
    const fileId = await uploadBytes(t, s.pm.browser, s.org.id, s.project.id, await pdf([SHEET]));
    const rev = await s.pm.browser.post(`${s.base}/drawing-sets/${set.id}/revisions`, {
      sheetNumber: 'A-301',
      title: 'Level 3 Floor Plan',
      rev: 'D',
      fileId,
    });
    expect(rev.statusCode).toBe(201);
    expect(
      (
        await s.pm.browser.post(`${s.base}/drawing-sets/${set.id}/publish`, {
          confirmNewSheets: true,
        })
      ).statusCode,
    ).toBe(200);
    const revisionId = rev.json().id as string;
    const mark = async (shapes: unknown[], visibility = 'private') => {
      const m = await s.pm.browser.post(`${s.base}/drawing-revisions/${revisionId}/markups`, {
        visibility,
        shapes,
      });
      expect(m.statusCode).toBe(201);
      return m.json().id as string;
    };
    return { ...s, revisionId, mark };
  }

  it('drafts from the words on the markup and the sheet text around it, and says where to pin', async () => {
    const s = await markedSheet();
    // Lines 2 and 3 of the sheet sit near y 0.10 to 0.13; the markup is drawn around them.
    const markupId = await s.mark([
      { id: 'r', kind: 'rect', from: { x: 0.05, y: 0.08 }, to: { x: 0.5, y: 0.15 } },
      { id: 't', kind: 'text', at: { x: 0.1, y: 0.2 }, text: 'Which FRL governs this riser wall?' },
    ]);
    const res = await s.pm.browser.post(`${s.base}/ai/rfi-drafts`, {
      note: '',
      markup: { drawingRevisionId: s.revisionId, markupId },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.question).toContain('A-301');
    expect(d.question).toContain('Which FRL governs this riser wall?');
    expect(d.unsupportedNumbers).toEqual([]);
    expect(d.drawing).toMatchObject({
      drawingRevisionId: s.revisionId,
      sheetNumber: 'A-301',
      title: 'Level 3 Floor Plan',
      rev: 'D',
      scanned: false,
    });
    expect(d.drawing.pin.x).toBeCloseTo(0.275, 2);
    expect(d.drawing.pin.y).toBeCloseTo(0.14, 2);
    // The model saw the words on the markup and the lines beside it, not the pit across the sheet.
    const call = t.ai.calls.at(-1)!;
    expect(call.task).toBe('rfi.draft');
    expect(call.text).toContain('<label>Which FRL governs this riser wall?</label>');
    expect(call.text).toContain('<nearby>RISER CUPBOARD R3.2 WALLS FRL 120/120/120</nearby>');
    expect(call.text).not.toContain('STORMWATER PIT');

    // A note alone still works and has no drawing to pin to.
    const plain = await s.pm.browser.post(`${s.base}/ai/rfi-drafts`, {
      note: 'Level 3 corridor wall at the riser: which fire rating governs',
    });
    expect(plain.json().drawing).toBeNull();
  });

  it('keeps private markups private and asks for something to draft from', async () => {
    const s = await markedSheet();
    const markupId = await s.mark([
      { id: 'r', kind: 'rect', from: { x: 0.05, y: 0.08 }, to: { x: 0.5, y: 0.15 } },
    ]);
    const body = { drawingRevisionId: s.revisionId, markupId };

    // A rectangle with no words and no note gives Nova nothing to ask.
    const empty = await s.pm.browser.post(`${s.base}/ai/rfi-drafts`, { note: '', markup: body });
    expect(empty.statusCode).toBe(422);
    expect(empty.json().code).toBe('validation_failed');
    // A note on top of the unlabelled markup is enough.
    const withNote = await s.pm.browser.post(`${s.base}/ai/rfi-drafts`, {
      note: 'Riser wall FRL here?',
      markup: body,
    });
    expect(withNote.statusCode).toBe(200);
    expect(withNote.json().drawing.sheetNumber).toBe('A-301');

    // Another project member can't draft from someone's private markup.
    const other = await s.eng.browser.post(`${s.base}/ai/rfi-drafts`, {
      note: 'Riser wall FRL here?',
      markup: body,
    });
    expect(other.statusCode).toBe(404);
    expect(other.json().code).toBe('markup.not_found');
    // Published to the project, they can.
    const shared = await s.mark(
      [{ id: 'r', kind: 'rect', from: { x: 0.05, y: 0.08 }, to: { x: 0.5, y: 0.15 } }],
      'project',
    );
    const ok = await s.eng.browser.post(`${s.base}/ai/rfi-drafts`, {
      note: 'Riser wall FRL here?',
      markup: { drawingRevisionId: s.revisionId, markupId: shared },
    });
    expect(ok.statusCode).toBe(200);
  });
});

describe('Nova RFI drafts from a site photo (F3)', () => {
  /** A 1 x 1 PNG. */
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );
  const photoOf = (s: Setup, bytes: Uint8Array = PNG, name = 'photo.png', mime = 'image/png') =>
    uploadBytes(t, s.pm.browser, s.org.id, s.project.id, bytes, name, mime);

  it('sends the photo to the model and drafts from it, with the note or without one', async () => {
    const s = await setup();
    const fileId = await photoOf(s);

    // Photo and note: the model sees both, and the note still finds the spec.
    const withNote = await s.pm.browser.post(`${s.base}/ai/rfi-drafts`, {
      note: 'Level 3 corridor wall at the riser: which fire rating governs',
      photo: { fileId },
    });
    expect(withNote.statusCode).toBe(200);
    const call = t.ai.calls.at(-1)!;
    expect(call.task).toBe('rfi.draft');
    expect(call.images).toEqual([{ mime: 'image/png', base64: PNG.toString('base64') }]);
    expect(call.text).toContain('<photo>');
    expect(call.passages.map((p) => p.text).join('\n')).toContain('FRL of 90/90/90');
    expect(withNote.json().drawing).toBeNull();

    // A photo alone is enough to draft from: nothing to search with, so the draft says where it is thin.
    const before = (await s.pm.browser.get(`/v1/orgs/${s.org.id}/ai/usage`)).json();
    const alone = await s.pm.browser.post(`${s.base}/ai/rfi-drafts`, {
      note: '',
      photo: { fileId },
    });
    expect(alone.statusCode).toBe(200);
    const aloneCall = t.ai.calls.at(-1)!;
    expect(aloneCall.images).toHaveLength(1);
    expect(aloneCall.passages).toEqual([]);
    expect(alone.json().gaps).toContain('location');
    const after = (await s.pm.browser.get(`/v1/orgs/${s.org.id}/ai/usage`)).json();
    const credits = (u: typeof before) =>
      u.byFeature.find((f: { feature: string }) => f.feature === 'rfi_draft')?.credits ?? 0;
    // One credit for the draft; no embedding run because there was no text to search.
    expect(credits(after) - credits(before)).toBe(1);

    // No photo: no images go to the model.
    await s.pm.browser.post(`${s.base}/ai/rfi-drafts`, {
      note: 'Which FRL governs the riser wall',
    });
    expect(t.ai.calls.at(-1)!.images).toEqual([]);
  });

  it('only takes a photo of this project, as an image, within the size limit', async () => {
    const s = await setup();
    const draft = (photoFileId: string) =>
      s.pm.browser.post(`${s.base}/ai/rfi-drafts`, { note: '', photo: { fileId: photoFileId } });

    // A PDF is not a photo.
    const notImage = await draft(
      await photoOf(s, await pdf([['SPEC']]), 'spec.pdf', 'application/pdf'),
    );
    expect(notImage.statusCode).toBe(422);
    expect(notImage.json().code).toBe('validation_failed');

    // Too big for the model: the apps shrink phone photos first.
    const big = new Uint8Array(3_000_001);
    big.set(PNG);
    const tooBig = await draft(await photoOf(s, big, 'big.png'));
    expect(tooBig.statusCode).toBe(422);
    expect(tooBig.json().code).toBe('validation_failed');

    // A photo uploaded to another project is not sent from this one.
    const other = await createProject(s.pm.browser, s.org.id, { name: 'Elsewhere', state: 'VIC' });
    const elsewhere = await uploadBytes(
      t,
      s.pm.browser,
      s.org.id,
      other.id,
      PNG,
      'x.png',
      'image/png',
    );
    const crossProject = await draft(elsewhere);
    expect(crossProject.statusCode).toBe(422);

    // Not an id of a file, and a well-formed id of no file.
    expect((await draft('fil_notanid')).statusCode).toBe(422);
    const missing = await draft(`fil_${'0'.repeat(26)}`);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe('file.not_found');
  });
});

describe('Nova RFI drafts kept as suggestions (F3)', () => {
  it('keeps each draft as a private suggestion that the RFI it leads to is linked to', async () => {
    const s = await setup();
    const asked = await raiseRfi(
      s,
      'Level 3 corridor wall fire rating at riser',
      'Which FRL governs the riser wall?',
      true,
    );
    const note = 'Level 3 corridor wall at the riser: which fire rating governs';
    const mine = (await s.pm.browser.post(`${s.base}/ai/rfi-drafts`, { note })).json();
    expect(mine.suggestionId).toMatch(/^ais_/);

    const listed = (await s.pm.browser.get(`${s.base}/ai/suggestions?task=rfi.draft`)).json();
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]).toMatchObject({
      id: mine.suggestionId,
      task: 'rfi.draft',
      targetType: 'project',
      targetId: s.project.id,
      status: 'pending',
      runId: mine.runId,
      payload: {
        subject: mine.subject,
        discipline: 'fire',
        references: [{ sourceType: 'document', sourceId: s.documentId, page: 1 }],
        similarRfiIds: [asked],
        suggestedAssigneeIds: [s.eng.userId],
        pin: null,
      },
    });

    // Someone else on the project doesn't see it, and can't decide it.
    expect(
      (await s.sub.browser.get(`${s.base}/ai/suggestions?task=rfi.draft`)).json().data,
    ).toEqual([]);
    const stolen = await s.sub.browser.post(
      `${s.base}/ai/suggestions/${mine.suggestionId}/decision`,
      { decision: 'accepted' },
    );
    expect(stolen.statusCode).toBe(404);

    // Sending the draft as an RFI records where it came from; an RFI written by hand carries nothing.
    const created = await s.pm.browser.post(`${s.base}/rfis`, {
      subject: mine.subject,
      question: mine.question,
      assigneeIds: mine.suggestedAssigneeIds,
      aiSuggestionId: mine.suggestionId,
    });
    expect(created.statusCode).toBe(201);
    expect((await s.pm.browser.post(`${s.base}/rfis`, { subject: 'By hand' })).statusCode).toBe(
      201,
    );
    const bad = await s.pm.browser.post(`${s.base}/rfis`, {
      subject: 'Bad link',
      aiSuggestionId: 'ais_nope',
    });
    expect(bad.statusCode).toBe(422);
    const events = await outboxData<{ rfiId: string; aiSuggestionId: string | null }>(
      t,
      s.org.id,
      s.pm.userId,
      'rfis.rfi.created.v1',
    );
    // The earlier RFI raised for the test, then the one from the draft, then the hand-written one.
    expect(events.map((e) => e.aiSuggestionId)).toEqual([
      null,
      decodeId('aiSuggestion', mine.suggestionId),
      null,
    ]);

    // The person says whether they sent it as drafted.
    const decided = await s.pm.browser.post(
      `${s.base}/ai/suggestions/${mine.suggestionId}/decision`,
      { decision: 'edited' },
    );
    expect(decided.statusCode).toBe(200);
    expect(decided.json()).toMatchObject({ id: mine.suggestionId, status: 'edited' });
    expect(
      (
        await s.pm.browser.post(`${s.base}/ai/suggestions/${mine.suggestionId}/decision`, {
          decision: 'rejected',
        })
      ).statusCode,
    ).toBe(409);
  });
});
