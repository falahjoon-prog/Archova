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

/** One A4 sheet with the lines drawn from the top left, 22 points apart. */
async function sheet(lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  lines.forEach((text, i) => page.drawText(text, { x: 50, y: 780 - i * 22, size: 11, font }));
  return doc.save();
}

async function setup() {
  const pm = await signUp(t.app, 'cmp-pm');
  const eng = await signUp(t.app, 'cmp-eng');
  const org = await createOrg(pm.browser, 'Compare Builders');
  const project = await createProject(pm.browser, org.id, { name: 'Harbourside', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, eng.email, 'Consultant', 'Smith Architects');
  return { pm, eng, org, project, base };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function issue(s: Setup, name: string, rev: string, lines: string[]) {
  const set = (await s.pm.browser.post(`${s.base}/drawing-sets`, { name })).json();
  const fileId = await uploadBytes(t, s.pm.browser, s.org.id, s.project.id, await sheet(lines));
  const r = await s.pm.browser.post(`${s.base}/drawing-sets/${set.id}/revisions`, {
    sheetNumber: 'A-301',
    title: 'Level 3 Floor Plan',
    rev,
    fileId,
  });
  expect(r.statusCode).toBe(201);
  const published = await s.pm.browser.post(`${s.base}/drawing-sets/${set.id}/publish`, {
    confirmNewSheets: true,
  });
  expect(published.statusCode).toBe(200);
  return r.json().id as string;
}

async function pinnedRfi(s: Setup, revisionId: string, subject: string, x: number, y: number) {
  const draft = await s.pm.browser.post(`${s.base}/rfis`, {
    subject,
    question: 'Please confirm.',
    assigneeIds: [s.eng.userId],
    pin: { drawingRevisionId: revisionId, x, y },
  });
  expect(draft.statusCode).toBe(201);
  const id = draft.json().rfi.id as string;
  const opened = await s.pm.browser.post(`${s.base}/rfis/${id}/open`, undefined, {
    'if-match': draft.headers.etag as string,
  });
  expect(opened.statusCode).toBe(200);
  return id;
}

const compare = (s: Setup, revisionId: string) =>
  s.pm.browser.post(`${s.base}/ai/drawing-revisions/${revisionId}/changes`);

describe('Nova drawing revision compare (F21)', () => {
  it('lists the text changes in words, with the open RFIs near them, once per revision pair', async () => {
    const s = await setup();
    const revA = await issue(s, 'IFC 1', 'A', [
      'CEILING HEIGHT 2400 AFFL',
      'GRID A TO GRID D',
      'BALUSTRADE HEIGHT TBC',
    ]);
    // Pinned next to the ceiling note (top left), and one far from any change.
    const near = await pinnedRfi(s, revA, 'Ceiling height in units', 0.1, 0.08);
    const far = await pinnedRfi(s, revA, 'Hob detail at riser', 0.9, 0.6);

    // The first issue has nothing to compare with.
    expect((await compare(s, revA)).json().code).toBe('ai.drawing_compare.no_previous_revision');

    const revB = await issue(s, 'IFC 2', 'B', [
      'CEILING HEIGHT 2700 AFFL',
      'GRID A TO GRID D',
      'PENETRATION P4 300 DIA',
    ]);
    const res = await compare(s, revB);
    expect(res.statusCode).toBe(200);
    const c = res.json();
    expect(c).toMatchObject({
      revisionId: revB,
      againstRevisionId: revA,
      sheetNumber: 'A-301',
      fromRev: 'A',
      toRev: 'B',
      truncated: false,
      scanned: false,
      unexplainedChangeIds: [],
    });
    expect(c.runId).toMatch(/^air_/);
    expect(
      c.changes.map((x: { kind: string; before: string; after: string }) => [
        x.kind,
        x.before,
        x.after,
      ]),
    ).toEqual([
      ['changed', 'CEILING HEIGHT 2400 AFFL', 'CEILING HEIGHT 2700 AFFL'],
      ['removed', 'BALUSTRADE HEIGHT TBC', null],
      ['added', null, 'PENETRATION P4 300 DIA'],
    ]);
    expect(c.items[0].text).toContain('2700');
    expect(c.affectedRfis).toEqual([
      {
        id: near,
        number: 'RFI-001',
        subject: 'Ceiling height in units',
        status: 'open',
        nearChange: true,
      },
      {
        id: far,
        number: 'RFI-002',
        subject: 'Hob detail at riser',
        status: 'open',
        nearChange: false,
      },
    ]);

    // Opening it again reuses the wording: no model call, no extra credit.
    const calls = t.ai.calls.length;
    const again = (await compare(s, revB)).json();
    expect(again.items).toEqual(c.items);
    expect(t.ai.calls.length).toBe(calls);
    const usage = (await s.pm.browser.get(`/v1/orgs/${s.org.id}/ai/usage`)).json();
    expect(usage.byFeature).toContainEqual({ feature: 'drawing_compare', credits: 0.5, runs: 1 });
  });

  it('drops wording that adds numbers and makes no model call when no text changed', async () => {
    const s = await setup();
    await issue(s, 'IFC 1', 'A', ['WALL TYPE W3', 'DOOR D07 SOLID CORE']);
    const revB = await issue(s, 'IFC 2', 'B', ['WALL TYPE W5', 'DOOR D07 SOLID CORE']);
    t.ai.on('drawing.compare', () => ({
      output: {
        headline: 'Wall type changed.',
        items: [
          { text: 'Wall type changed from W3 to W5.', changeIds: ['c1'] },
          { text: 'Wall now rated 90 minutes.', changeIds: ['c1'] },
        ],
      },
    }));
    try {
      const c = (await compare(s, revB)).json();
      expect(c.items).toEqual([{ text: 'Wall type changed from W3 to W5.', changeIds: ['c1'] }]);
    } finally {
      t.ai.on('drawing.compare', DEFAULT_FAKE_RESPONDERS['drawing.compare']!);
    }

    const same = await setup();
    await issue(same, 'IFC 1', 'A', ['WALL TYPE W3']);
    const unchanged = await issue(same, 'IFC 2', 'B', ['WALL TYPE W3']);
    const calls = t.ai.calls.length;
    const c = (await compare(same, unchanged)).json();
    expect(c).toMatchObject({ runId: null, changes: [], items: [] });
    expect(c.headline).toContain('No text changed');
    expect(t.ai.calls.length).toBe(calls);
  });
});
