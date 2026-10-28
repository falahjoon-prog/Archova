import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

/** A 1 x 1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** A4 sheet with one line of text every 22 points from the top left (about 0.026 of the sheet apart). */
async function sheet(lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  lines.forEach((text, i) => page.drawText(text, { x: 50, y: 780 - i * 22, size: 11, font }));
  return doc.save();
}

async function setup() {
  const pm = await signUp(t.app, 'dtag-pm');
  const painter = await signUp(t.app, 'dtag-painter');
  const painter2 = await signUp(t.app, 'dtag-painter2');
  const sparky = await signUp(t.app, 'dtag-sparky');
  const org = await createOrg(pm.browser, 'Tag Builders');
  const project = await createProject(pm.browser, org.id, { name: 'Harbourside', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  const brush = await addMember(
    pm.browser,
    org.id,
    project.id,
    painter.email,
    'Subcontractor',
    'Brush Co',
    ['Painting & decorating'],
  );
  const coat = await addMember(
    pm.browser,
    org.id,
    project.id,
    painter2.email,
    'Subcontractor',
    'Coat Pty',
    ['Painting'],
  );
  await addMember(pm.browser, org.id, project.id, sparky.email, 'Subcontractor', 'Sparks', [
    'Electrical',
  ]);

  const set = (await pm.browser.post(`${base}/drawing-sets`, { name: 'IFC 1' })).json();
  const fileId = await uploadBytes(
    t,
    pm.browser,
    org.id,
    project.id,
    await sheet([
      'BATHROOM 1',
      'UNIT 304 LEVEL 3',
      '',
      '',
      '',
      '',
      '',
      '',
      'STORMWATER PIT SW4 FAR AWAY',
    ]),
  );
  const rev = await pm.browser.post(`${base}/drawing-sets/${set.id}/revisions`, {
    sheetNumber: 'A-301',
    title: 'Level 3 Floor Plan',
    rev: 'D',
    fileId,
  });
  expect(rev.statusCode).toBe(201);
  expect(
    (await pm.browser.post(`${base}/drawing-sets/${set.id}/publish`, { confirmNewSheets: true }))
      .statusCode,
  ).toBe(200);
  const revisionId = rev.json().id as string;
  const photo = () =>
    uploadBytes(t, pm.browser, org.id, project.id, PNG, 'defect.png', 'image/png');
  return { pm, painter, org, project, base, revisionId, brush, coat, photo };
}

describe('Nova defect photo tagging (F5)', () => {
  it('suggests the trade, who on the project could fix it and the place from the sheet text', async () => {
    const s = await setup();
    const fileId = await s.photo();
    const pin = { drawingRevisionId: s.revisionId, x: 0.1, y: 0.09 };

    const res = await s.pm.browser.post(`${s.base}/ai/defect-tags`, {
      photo: { fileId },
      note: 'Paint runs down the wall',
      pin,
    });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.runId).toMatch(/^air_/);
    expect(d).toMatchObject({
      trade: 'Painting',
      category: 'Paint finish',
      priority: 'medium',
      unsupportedNumbers: [],
      duplicates: [],
    });
    // The painting companies on this project, not the electrician, and Nova doesn't pick between them.
    expect(d.suggestedCompanies).toEqual([
      { id: s.brush.companyId, name: 'Brush Co', trade: 'Painting' },
      { id: s.coat.companyId, name: 'Coat Pty', trade: 'Painting' },
    ]);
    expect(d.drawing).toMatchObject({
      drawingRevisionId: s.revisionId,
      sheetNumber: 'A-301',
      rev: 'D',
      pin: { x: 0.1, y: 0.09 },
      scanned: false,
    });
    expect(d.drawing.nearby).toEqual(expect.arrayContaining(['BATHROOM 1', 'UNIT 304 LEVEL 3']));
    expect(d.drawing.nearby).not.toContain('STORMWATER PIT SW4 FAR AWAY');
    // The place in the title is one the sheet printed.
    expect(d.title).toContain(d.drawing.nearby[0]);
    expect(d.gaps).toEqual([]);

    // The model got the photo and the sheet text beside the pin, not the pit across the sheet.
    const call = t.ai.calls.at(-1)!;
    expect(call.task).toBe('defect.tag');
    expect(call.images).toEqual([{ mime: 'image/png', base64: PNG.toString('base64') }]);
    expect(call.text).toContain('<nearby>BATHROOM 1</nearby>');
    expect(call.text).not.toContain('STORMWATER PIT');
    const usage = (await s.pm.browser.get(`/v1/orgs/${s.org.id}/ai/usage`)).json();
    const row = usage.byFeature.find((f: { feature: string }) => f.feature === 'defect_tagging');
    expect(row.runs).toBe(1);
    expect(row.credits).toBeCloseTo(0.1, 5);
  });

  it('points out open defects already pinned beside the same spot', async () => {
    const s = await setup();
    const make = async (title: string, x: number, y: number, trade: string) => {
      const res = await s.pm.browser.post(`${s.base}/defects`, {
        title,
        trade,
        pin: { drawingRevisionId: s.revisionId, x, y },
      });
      expect(res.statusCode).toBe(201);
      return res.json().defect.id as string;
    };
    const near = await make('Paint runs, bathroom 1', 0.11, 0.1, 'Painting');
    const nearOther = await make('Switch plate loose', 0.12, 0.09, 'Electrical');
    await make('Paint runs, lobby', 0.8, 0.8, 'Painting');
    const voided = await make('Logged twice by mistake', 0.1, 0.09, 'Painting');
    expect(
      (
        await s.pm.browser.post(
          `${s.base}/defects/${voided}/transition`,
          { action: 'void', reason: 'Duplicate' },
          {
            'if-match': (await s.pm.browser.get(`${s.base}/defects/${voided}`)).headers
              .etag as string,
          },
        )
      ).statusCode,
    ).toBe(200);

    const res = await s.pm.browser.post(`${s.base}/ai/defect-tags`, {
      photo: { fileId: await s.photo() },
      note: 'Paint runs down the wall',
      pin: { drawingRevisionId: s.revisionId, x: 0.1, y: 0.09 },
    });
    expect(res.statusCode).toBe(200);
    const dup = res.json().duplicates;
    // Nearest first; the far one and the voided one aren't there; the same trade is marked.
    expect(dup.map((x: { id: string }) => x.id)).toEqual([near, nearOther]);
    expect(dup[0]).toMatchObject({
      numberLabel: 'DEF-0001',
      title: 'Paint runs, bathroom 1',
      status: 'draft',
      trade: 'Painting',
      sameTrade: true,
    });
    expect(dup[1]).toMatchObject({ trade: 'Electrical', sameTrade: false });
  });

  it('drafts from a photo alone, says what is missing and lists numbers it cannot trace', async () => {
    const s = await setup();
    const fileId = await s.photo();
    const alone = await s.pm.browser.post(`${s.base}/ai/defect-tags`, {
      photo: { fileId },
    });
    expect(alone.statusCode).toBe(200);
    expect(alone.json()).toMatchObject({
      trade: null,
      category: null,
      suggestedCompanies: [],
      duplicates: [],
      drawing: null,
    });
    expect(alone.json().gaps.sort()).toEqual(['location', 'trade']);

    t.ai.on('defect.tag', () => ({
      output: {
        title: 'Cracked tile 600 x 600 in bathroom',
        description: 'The photo shows a 3 mm gap.',
        trade: 'tiling',
        alternativeTrades: ['tiling', 'waterproofing'],
        defectType: 'tiling',
        priority: 'medium',
        gaps: [],
      },
    }));
    try {
      const d = (
        await s.pm.browser.post(`${s.base}/ai/defect-tags`, {
          photo: { fileId },
          note: 'cracked tile in the bathroom',
        })
      ).json();
      expect(d.unsupportedNumbers.sort()).toEqual(['3', '600']);
      expect(d.alternativeTrades).toEqual(['Waterproofing']);
      expect(d.suggestedCompanies).toEqual([]);
    } finally {
      t.ai.on('defect.tag', DEFAULT_FAKE_RESPONDERS['defect.tag']!);
    }
  });

  it('only takes a photo of this project, and only for someone on it', async () => {
    const s = await setup();
    const draft = (body: object, who: { browser: typeof s.pm.browser } = s.pm) =>
      who.browser.post(`${s.base}/ai/defect-tags`, body);

    const notImage = await uploadBytes(
      t,
      s.pm.browser,
      s.org.id,
      s.project.id,
      await sheet(['SPEC']),
      'spec.pdf',
      'application/pdf',
    );
    const pdf = await draft({ photo: { fileId: notImage } });
    expect(pdf.statusCode).toBe(422);
    expect(pdf.json().code).toBe('validation_failed');

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
    expect((await draft({ photo: { fileId: elsewhere } })).statusCode).toBe(422);

    const missing = await draft({ photo: { fileId: `fil_${'0'.repeat(26)}` } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe('file.not_found');
    // No photo is no request.
    expect((await draft({ note: 'Paint runs' })).statusCode).toBe(422);

    // Someone outside the project can't tag on it.
    const stranger = await signUp(t.app, 'dtag-stranger');
    const denied = await draft({ photo: { fileId: await s.photo() } }, stranger);
    expect([403, 404]).toContain(denied.statusCode);
  });

  it('keeps each tag as a private suggestion that the defect it leads to is linked to', async () => {
    const s = await setup();
    const manager = await signUp(t.app, 'dtag-manager');
    await addMember(s.pm.browser, s.org.id, s.project.id, manager.email, 'Site Manager', 'Main Co');
    const pin = { drawingRevisionId: s.revisionId, x: 0.1, y: 0.09 };
    const tag = async (who: { browser: typeof s.pm.browser }) =>
      (
        await who.browser.post(`${s.base}/ai/defect-tags`, {
          photo: { fileId: await s.photo() },
          note: 'Paint runs down the wall',
          pin,
        })
      ).json();

    const mine = await tag(s.pm);
    expect(mine.suggestionId).toMatch(/^ais_/);
    const listed = (await s.pm.browser.get(`${s.base}/ai/suggestions?task=defect.tag`)).json();
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]).toMatchObject({
      id: mine.suggestionId,
      task: 'defect.tag',
      targetType: 'file_page',
      status: 'pending',
      runId: mine.runId,
      payload: {
        title: mine.title,
        trade: 'Painting',
        category: 'Paint finish',
        suggestedCompanyIds: [s.brush.companyId, s.coat.companyId],
        duplicateDefectIds: [],
        pin: { drawingRevisionId: s.revisionId, x: 0.1, y: 0.09 },
      },
    });

    // Someone else on the project doesn't see it, and can't decide it.
    expect(
      (await manager.browser.get(`${s.base}/ai/suggestions?task=defect.tag`)).json().data,
    ).toEqual([]);
    const theirs = await tag(manager);
    const stolen = await manager.browser.post(
      `${s.base}/ai/suggestions/${mine.suggestionId}/decision`,
      { decision: 'accepted' },
    );
    expect(stolen.statusCode).toBe(404);
    expect(
      (await s.pm.browser.get(`${s.base}/ai/suggestions?task=defect.tag`))
        .json()
        .data.map((x: { id: string }) => x.id),
    ).toEqual([mine.suggestionId]);
    expect(theirs.suggestionId).not.toBe(mine.suggestionId);

    // Raising the defect from the tag marks where it came from; a defect raised by hand stays manual.
    const raised = await s.pm.browser.post(`${s.base}/defects`, {
      title: mine.title,
      trade: mine.trade,
      category: mine.category,
      assigneeCompanyId: s.brush.companyId,
      pin,
      aiSuggestionId: mine.suggestionId,
    });
    expect(raised.statusCode).toBe(201);
    expect(raised.json().defect.source).toBe('ai_suggested');
    const byHand = await s.pm.browser.post(`${s.base}/defects`, { title: 'By hand', pin });
    expect(byHand.json().defect.source).toBe('manual');
    const malformed = await s.pm.browser.post(`${s.base}/defects`, {
      title: 'Bad link',
      pin,
      aiSuggestionId: 'ais_nope',
    });
    expect(malformed.statusCode).toBe(422);

    // The person says whether they used the tags as given; Nova's tags changed, so `edited`, with nothing to send.
    const decided = await s.pm.browser.post(
      `${s.base}/ai/suggestions/${mine.suggestionId}/decision`,
      { decision: 'edited' },
    );
    expect(decided.statusCode).toBe(200);
    expect(decided.json()).toMatchObject({ id: mine.suggestionId, status: 'edited' });
    expect(decided.json().decidedAt).toEqual(expect.any(String));
    const again = await s.pm.browser.post(
      `${s.base}/ai/suggestions/${mine.suggestionId}/decision`,
      { decision: 'rejected' },
    );
    expect(again.statusCode).toBe(409);
    const rejected = await manager.browser.post(
      `${s.base}/ai/suggestions/${theirs.suggestionId}/decision`,
      { decision: 'rejected' },
    );
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().status).toBe('rejected');
  });
});
