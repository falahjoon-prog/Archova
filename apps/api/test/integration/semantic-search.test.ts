import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  uploadBytes,
  type Browser,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

/** A PDF with one page per entry, each page's lines drawn top to bottom in small type so a page can hold a lot. */
async function pdf(pages: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([595, 842]);
    lines.forEach((text, i) => page.drawText(text, { x: 40, y: 810 - i * 8, size: 6, font }));
  }
  return doc.save();
}

async function setup(label: string) {
  const pm = await signUp(t.app, `${label}-pm`);
  const org = await createOrg(pm.browser, `${label} Builders`);
  const project = await createProject(pm.browser, org.id, { name: 'Harbourside', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  return { pm, org, project, base };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function addDocument(
  s: Setup,
  folderId: string,
  title: string,
  docNumber: string,
  pages: string[][],
) {
  const fileId = await uploadBytes(t, s.pm.browser, s.org.id, s.project.id, await pdf(pages));
  const res = await s.pm.browser.post(`${s.base}/documents`, {
    folderId,
    title,
    docNumber,
    revision: { rev: 'A', fileId },
  });
  expect(res.statusCode).toBe(201);
  return res.json().document as { id: string };
}

const index = async (s: Setup) => {
  const res = await s.pm.browser.post(`${s.base}/ai/index`);
  expect(res.statusCode).toBe(200);
  return res.json();
};
const search = (b: Browser, s: Setup, body: { query: string; limit?: number }) =>
  b.post(`${s.base}/ai/search`, body);
const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => `Item ${i + 1}: general site notes, see the schedule.`);

describe('Semantic search (F6)', () => {
  it('finds documents, drawings and RFIs together, one result per page, with a snippet and no credits', async () => {
    const s = await setup('srch');
    const eng = await signUp(t.app, 'srch-eng');
    await addMember(s.pm.browser, s.org.id, s.project.id, eng.email, 'Consultant', 'Smith Eng');
    const specs = (await s.pm.browser.post(`${s.base}/folders`, { name: 'Specifications' })).json();
    // Two pages; the first is long enough to be cut into two passages that both mention the basement.
    const waterproofing = await addDocument(
      s,
      specs.id,
      'Waterproofing Specification',
      'SPEC-0612',
      [
        [
          '0612.1 BASEMENT WATERPROOFING',
          'The basement slab and walls shall be waterproofed with a cementitious membrane.',
          ...filler(60),
          'Inspect the basement for leaks before backfilling.',
          ...filler(20),
        ],
        ['0612.2 WET AREAS', 'Wet areas shall be waterproofed in accordance with AS 3740-2021.'],
      ],
    );
    await addDocument(s, specs.id, 'Fire Protection Specification', 'SPEC-0821', [
      ['0821.3.2 FIRE RESISTANCE LEVELS', 'Corridor walls shall achieve an FRL of 90/90/90.'],
    ]);
    const set = (await s.pm.browser.post(`${s.base}/drawing-sets`, { name: 'IFC 1' })).json();
    const setFile = await uploadBytes(
      t,
      s.pm.browser,
      s.org.id,
      s.project.id,
      await pdf([
        ['S-001 STRUCTURAL NOTES', 'Provide a drainage cell behind the basement retaining walls.'],
      ]),
    );
    expect(
      (
        await s.pm.browser.post(`${s.base}/drawing-sets/${set.id}/revisions`, {
          sheetNumber: 'S-001',
          title: 'Structural General Notes',
          rev: '4',
          fileId: setFile,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await s.pm.browser.post(`${s.base}/drawing-sets/${set.id}/publish`, {
          confirmNewSheets: true,
        })
      ).statusCode,
    ).toBe(200);
    const draft = await s.pm.browser.post(`${s.base}/rfis`, {
      subject: 'Basement leak at grid C4',
      question: 'Water is entering the basement at grid C4 after rain. What is the repair detail?',
      assigneeIds: [eng.userId],
    });
    const rfi = draft.json().rfi.id as string;
    const opened = await s.pm.browser.post(`${s.base}/rfis/${rfi}/open`, undefined, {
      'if-match': draft.headers.etag as string,
    });
    expect(opened.statusCode).toBe(200);
    const reply = await eng.browser.post(`${s.base}/rfis/${rfi}/responses`, {
      body: 'Inject the joint with polyurethane grout, then re-test.',
    });
    expect(reply.statusCode).toBe(201);
    const closed = await s.pm.browser.post(
      `${s.base}/rfis/${rfi}/close`,
      { officialResponseId: reply.json().responses.at(-1).id },
      { 'if-match': reply.headers.etag as string },
    );
    expect(closed.statusCode).toBe(200);
    const idx = await index(s);
    expect(idx).toMatchObject({ indexed: 3, rfisIndexed: 1 });
    // The long page really was cut into two passages (2 + 1 + 1 + 1; the RFI is counted apart), so the single result
    // for it below is a dedupe.
    expect(idx.chunks).toBe(5);

    const callsBefore = t.ai.calls.length;
    const res = await search(s.pm.browser, s, { query: 'basement leak' });
    expect(res.statusCode, res.body).toBe(200);
    const { results } = res.json() as {
      results: Array<{
        sourceType: string;
        sourceId: string;
        revisionId: string;
        revision: string;
        title: string;
        reference: string | null;
        page: number;
        snippet: string;
      }>;
    };

    // The three kinds of source that mention the basement are all there, once per page.
    const basement = results.filter((r) => /basement/i.test(r.snippet));
    expect(basement.map((r) => r.sourceType).sort()).toEqual(['document', 'drawing', 'rfi']);
    const spec = results.filter((r) => r.sourceId === waterproofing.id);
    expect(spec.map((r) => r.page)).toContain(1);
    expect(new Set(spec.map((r) => r.page)).size).toBe(spec.length);
    expect(results.find((r) => r.sourceId === waterproofing.id && r.page === 1)).toMatchObject({
      sourceType: 'document',
      revisionId: expect.stringMatching(/^rev_/),
      revision: 'A',
      title: 'Waterproofing Specification',
      reference: 'SPEC-0612',
    });
    expect(results.find((r) => r.sourceType === 'drawing')).toMatchObject({
      sourceId: expect.stringMatching(/^dsh_/),
      revisionId: expect.stringMatching(/^drv_/),
      reference: 'S-001',
      revision: '4',
      page: 1,
    });
    expect(results.find((r) => r.sourceType === 'rfi')).toMatchObject({
      sourceId: rfi,
      revisionId: rfi,
      reference: 'RFI-001',
      title: 'Basement leak at grid C4',
    });
    // Ranked: what mentions the basement comes before the fire specification, which has nothing to do with it.
    const fire = results.findIndex((r) => r.reference === 'SPEC-0821');
    expect(fire === -1 || fire > Math.max(...basement.map((r) => results.indexOf(r)))).toBe(true);
    // Every snippet is short, and the long page's shows the sentence the words are in.
    for (const r of results) expect(r.snippet.length).toBeLessThanOrEqual(242);
    expect(spec.find((r) => r.page === 1)!.snippet).toMatch(/basement/i);

    // No answer was written: no text-model call, and no credits.
    expect(t.ai.calls.length).toBe(callsBefore);
    const usage = (await s.pm.browser.get(`/v1/orgs/${s.org.id}/ai/usage`)).json();
    expect(usage.byFeature.every((f: { credits: number }) => f.credits === 0)).toBe(true);

    // `limit` cuts the list; the default is not more than 10.
    const two = (await search(s.pm.browser, s, { query: 'basement leak', limit: 2 })).json();
    expect(two.results).toHaveLength(2);
    expect(two.results.map((r: { sourceId: string }) => r.sourceId)).toEqual(
      results.slice(0, 2).map((r) => r.sourceId),
    );
  });

  it('shows the stretch around the words, not the top of a long passage', async () => {
    const s = await setup('srch-snip');
    const folder = (await s.pm.browser.post(`${s.base}/folders`, { name: 'Specs' })).json();
    await addDocument(s, folder.id, 'Services Specification', 'SPEC-0900', [
      [
        ...filler(20),
        'The sprinkler isolation valve is located above the lift lobby ceiling.',
        ...filler(20),
      ],
    ]);
    await index(s);
    const { results } = (
      await search(s.pm.browser, s, { query: 'sprinkler isolation valve' })
    ).json();
    expect(results).toHaveLength(1);
    expect(results[0].snippet).toContain('sprinkler isolation valve');
    expect(results[0].snippet.startsWith('…')).toBe(true);
  });

  it('finds nothing, and calls no model, for an empty index or a blank query', async () => {
    const s = await setup('srch-empty');
    const calls = t.ai.calls.length;
    const none = await search(s.pm.browser, s, { query: 'basement' });
    expect(none.statusCode).toBe(200);
    expect(none.json()).toEqual({ results: [] });
    const blank = await search(s.pm.browser, s, { query: '   ' });
    expect(blank.statusCode).toBe(200);
    expect(blank.json()).toEqual({ results: [] });
    expect(t.ai.calls.length).toBe(calls);
    // Bad input is refused.
    for (const body of [
      { query: 'x' },
      { query: 'x'.repeat(301) },
      { query: 'basement', limit: 21 },
      { query: 'basement', limit: 0 },
    ])
      expect((await search(s.pm.browser, s, body)).statusCode, JSON.stringify(body)).toBe(422);
  });

  it("never returns private folders to people outside them, RFIs to consultants, or another org's passages", async () => {
    const s = await setup('srch-scope');
    const sub = await signUp(t.app, 'srch-sub');
    const eng = await signUp(t.app, 'srch-eng2');
    await addMember(s.pm.browser, s.org.id, s.project.id, sub.email, 'Subcontractor');
    await addMember(s.pm.browser, s.org.id, s.project.id, eng.email, 'Consultant', 'Smith Eng');
    const open = (await s.pm.browser.post(`${s.base}/folders`, { name: 'Site' })).json();
    const legal = (
      await s.pm.browser.post(`${s.base}/folders`, { name: 'Contracts', isPrivate: true })
    ).json();
    await addDocument(s, open.id, 'Site Rules', 'SR-01', [
      ['SITE RULES', 'Liquidated delay notices are posted at the site office.'],
    ]);
    await addDocument(s, legal.id, 'Head Contract', 'HC-01', [
      [
        'LIQUIDATED DAMAGES',
        'Liquidated damages are CANARY-PRIVATE-4417 dollars per day of delay.',
      ],
    ]);
    const draft = await s.pm.browser.post(`${s.base}/rfis`, {
      subject: 'Liquidated damages clause',
      question: 'Does the liquidated damages clause apply to the delay? CANARY-RFI-6104',
      assigneeIds: [eng.userId],
    });
    const rfi = draft.json().rfi.id as string;
    expect(
      (
        await s.pm.browser.post(`${s.base}/rfis/${rfi}/open`, undefined, {
          'if-match': draft.headers.etag as string,
        })
      ).statusCode,
    ).toBe(200);
    const other = await setup('srch-other');
    const otherFolder = (
      await other.pm.browser.post(`${other.base}/folders`, { name: 'C' })
    ).json();
    await addDocument(other, otherFolder.id, 'Head Contract', 'HC-01', [
      ['LIQUIDATED DAMAGES', 'Liquidated damages are CANARY-ORG-B-7731 dollars per day of delay.'],
    ]);
    await index(s);
    await index(other);

    const query = 'liquidated damages per day of delay';
    const mine = (await search(s.pm.browser, s, { query })).json();
    const text = JSON.stringify(mine);
    expect(text).toContain('CANARY-PRIVATE-4417');
    expect(text).toContain('Liquidated damages clause'); // the RFI
    expect(text).not.toContain('CANARY-ORG-B-7731');

    // A subcontractor can open the site folder only, and no RFIs: they get one result.
    const subs = await search(sub.browser, s, { query });
    expect(subs.statusCode).toBe(200);
    expect(subs.json().results.map((r: { title: string }) => r.title)).toEqual(['Site Rules']);
    expect(subs.body).not.toMatch(/CANARY|Head Contract|Liquidated damages clause/);

    // A consultant who was asked on the RFI can open it in the register, but search is for builder staff.
    expect((await eng.browser.get(`${s.base}/rfis/${rfi}`)).statusCode).toBe(200);
    const theirs = await search(eng.browser, s, { query });
    expect(theirs.statusCode).toBe(200);
    expect(theirs.body).not.toMatch(/CANARY|Liquidated damages clause|Head Contract/);

    // Someone who isn't in the project, and a project id from another org, get nothing.
    const stranger = await signUp(t.app, 'srch-stranger');
    expect((await search(stranger.browser, s, { query })).statusCode).toBeGreaterThanOrEqual(400);
    const cross = await search(
      other.pm.browser,
      { ...other, base: `/v1/orgs/${other.org.id}/projects/${s.project.id}` },
      { query },
    );
    expect(cross.statusCode).toBe(404);
  });
});
