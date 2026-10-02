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

/** A PDF with one page per entry, each page's lines drawn top to bottom. */
async function pdf(pages: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([595, 842]);
    lines.forEach((text, i) => page.drawText(text, { x: 50, y: 780 - i * 22, size: 11, font }));
  }
  return doc.save();
}

async function setup(label: string) {
  const owner = await signUp(t.app, label);
  const org = await createOrg(owner.browser, `${label} Builders`);
  const project = await createProject(owner.browser, org.id, { name: 'Harbourside', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  return { owner, org, project, base };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function addDocument(
  s: Setup,
  folderId: string,
  title: string,
  docNumber: string,
  pages: string[][],
  rev = 'A',
) {
  const fileId = await uploadBytes(t, s.owner.browser, s.org.id, s.project.id, await pdf(pages));
  const res = await s.owner.browser.post(`${s.base}/documents`, {
    folderId,
    title,
    docNumber,
    revision: { rev, fileId },
  });
  expect(res.statusCode).toBe(201);
  return res.json().document as { id: string };
}

async function addRevision(s: Setup, documentId: string, rev: string, pages: string[][]) {
  const fileId = await uploadBytes(t, s.owner.browser, s.org.id, s.project.id, await pdf(pages));
  const res = await s.owner.browser.post(`${s.base}/documents/${documentId}/revisions`, {
    rev,
    fileId,
  });
  expect(res.statusCode).toBe(201);
}

const ask = (b: Browser, s: Setup, question: string) => b.post(`${s.base}/ai/ask`, { question });

/** Every passage any model call has seen, to prove restricted text never reached the model. */
const seenByModel = () => t.ai.calls.flatMap((c) => c.passages.map((p) => p.text)).join('\n');

describe('Ask Nova (F2)', () => {
  it('indexes documents and drawings, answers with citations and says when it cannot find something', async () => {
    const s = await setup('ask');
    const specs = (
      await s.owner.browser.post(`${s.base}/folders`, { name: 'Specifications' })
    ).json();
    const fire = await addDocument(s, specs.id, 'Fire Protection Specification', 'SPEC-0821', [
      ['SECTION 0821 FIRE PROTECTION', '0821.1 GENERAL', 'Comply with the BCA.'],
      [
        '0821.3.2 FIRE RESISTANCE LEVELS',
        'Walls to the Level 3 corridor shall achieve an FRL of 90/90/90.',
        'Walls between sole-occupancy units shall achieve an FRL of 60/60/60.',
      ],
    ]);
    await addDocument(s, specs.id, 'Waterproofing Specification', 'SPEC-0612', [
      ['0612.1 STANDARDS', 'Wet areas shall be waterproofed in accordance with AS 3740-2021.'],
    ]);

    // A published drawing: its own page of the set's PDF.
    const set = (await s.owner.browser.post(`${s.base}/drawing-sets`, { name: 'IFC 1' })).json();
    const setFile = await uploadBytes(
      t,
      s.owner.browser,
      s.org.id,
      s.project.id,
      await pdf([
        ['S-001 STRUCTURAL GENERAL NOTES', 'Concrete for suspended slabs shall be grade N40.'],
      ]),
    );
    const sheet = await s.owner.browser.post(`${s.base}/drawing-sets/${set.id}/revisions`, {
      sheetNumber: 'S-001',
      title: 'Structural General Notes',
      rev: '4',
      fileId: setFile,
    });
    expect(sheet.statusCode).toBe(201);
    const published = await s.owner.browser.post(`${s.base}/drawing-sets/${set.id}/publish`, {
      confirmNewSheets: true,
    });
    expect(published.statusCode).toBe(200);

    const index = await s.owner.browser.post(`${s.base}/ai/index`);
    expect(index.statusCode).toBe(200);
    expect(index.json()).toMatchObject({ indexed: 3, unchanged: 0, noText: 0, unsupported: 0 });
    // Running it again does nothing new.
    expect((await s.owner.browser.post(`${s.base}/ai/index`)).json()).toMatchObject({
      indexed: 0,
      unchanged: 3,
    });

    const slab = (
      await ask(s.owner.browser, s, 'What concrete grade is specified for suspended slabs?')
    ).json();
    expect(slab.found).toBe(true);
    expect(slab.citations[0]).toMatchObject({
      sourceType: 'drawing',
      sourceId: expect.stringMatching(/^dsh_/),
      revisionId: expect.stringMatching(/^drv_/),
      revision: '4',
      reference: 'S-001',
      page: 1,
    });

    const res = await ask(
      s.owner.browser,
      s,
      'What FRL is required for the Level 3 corridor walls?',
    );
    expect(res.statusCode).toBe(200);
    const a = res.json();
    expect(a.found).toBe(true);
    expect(a.answer).toContain('90/90/90');
    expect(a.runId).toMatch(/^air_/);
    expect(a.citations).toEqual([
      expect.objectContaining({
        sourceType: 'document',
        sourceId: fire.id,
        revisionId: expect.stringMatching(/^rev_/),
        revision: 'A',
        title: 'Fire Protection Specification',
        reference: 'SPEC-0821',
        page: 2,
        quote: expect.stringContaining('90/90/90'),
      }),
    ]);

    // Not in the documents: "not found", never a guess, with the closest passages to check.
    const none = (
      await ask(s.owner.browser, s, 'What carpet is specified for the bedrooms?')
    ).json();
    expect(none).toMatchObject({ found: false, citations: [] });
    expect(none.answer).toMatch(/couldn't find/);

    // One credit per answered or attempted question; indexing and embeddings are free.
    const usage = (await s.owner.browser.get(`/v1/orgs/${s.org.id}/ai/usage`)).json();
    expect(usage.byFeature).toEqual([expect.objectContaining({ feature: 'ask', credits: 3 })]);

    // A new revision supersedes the old one's passages.
    await addRevision(s, fire.id, 'B', [
      [
        '0821.3.2 FIRE RESISTANCE LEVELS',
        'Walls to the Level 3 corridor shall achieve an FRL of 120/120/120.',
      ],
    ]);
    expect((await s.owner.browser.post(`${s.base}/ai/index`)).json()).toMatchObject({
      indexed: 1,
      unchanged: 3,
    });
    const b = (
      await ask(s.owner.browser, s, 'What FRL is required for the Level 3 corridor walls?')
    ).json();
    expect(b.found).toBe(true);
    expect(b.answer).toContain('120/120/120');
    expect(b.citations.map((c: { revision: string }) => c.revision)).toEqual(['B']);
  });

  it("never retrieves private folders for people outside them, or another org's documents", async () => {
    const s = await setup('ask-scope');
    const sub = await signUp(t.app, 'ask-sub');
    await addMember(s.owner.browser, s.org.id, s.project.id, sub.email, 'Subcontractor');
    const open = (await s.owner.browser.post(`${s.base}/folders`, { name: 'Site' })).json();
    const legal = (
      await s.owner.browser.post(`${s.base}/folders`, { name: 'Contracts', isPrivate: true })
    ).json();
    await addDocument(s, open.id, 'Site Rules', 'SR-01', [
      ['SITE RULES', 'Work on site is permitted from 7:00 am to 6:00 pm Monday to Friday.'],
    ]);
    await addDocument(s, legal.id, 'Head Contract', 'HC-01', [
      [
        'LIQUIDATED DAMAGES',
        'Liquidated damages are CANARY-PRIVATE-4417 dollars per day of delay.',
      ],
    ]);
    // Another org, same words, its own canary.
    const other = await setup('ask-other');
    const otherFolder = (
      await other.owner.browser.post(`${other.base}/folders`, { name: 'Contracts' })
    ).json();
    await addDocument(other, otherFolder.id, 'Head Contract', 'HC-01', [
      ['LIQUIDATED DAMAGES', 'Liquidated damages are CANARY-ORG-B-7731 dollars per day of delay.'],
    ]);
    expect((await s.owner.browser.post(`${s.base}/ai/index`)).json().indexed).toBe(2);
    expect((await other.owner.browser.post(`${other.base}/ai/index`)).json().indexed).toBe(1);

    const question = 'What are the liquidated damages per day of delay?';
    const callsBefore = t.ai.calls.length;
    const subAnswer = await ask(sub.browser, s, question);
    expect(subAnswer.statusCode).toBe(200);
    expect(subAnswer.json().found).toBe(false);
    expect(JSON.stringify(subAnswer.json())).not.toMatch(/CANARY|Head Contract/);

    // The owner can open the private folder, so Nova answers them, and never from the other org.
    const ownerAnswer = (await ask(s.owner.browser, s, question)).json();
    expect(ownerAnswer.found).toBe(true);
    expect(ownerAnswer.answer).toContain('CANARY-PRIVATE-4417');
    expect(JSON.stringify(ownerAnswer)).not.toContain('CANARY-ORG-B-7731');

    // Neither canary reached the model on the subcontractor's question, and org B's never did.
    const seen = t.ai.calls
      .slice(callsBefore)
      .flatMap((c) => c.passages.map((p) => p.text))
      .join('\n');
    expect(seen).toContain('CANARY-PRIVATE-4417'); // the owner's question
    expect(seenByModel()).not.toContain('CANARY-ORG-B-7731');
    const subCalls = t.ai.calls
      .slice(callsBefore)
      .filter((c) => !c.passages.some((p) => p.text.includes('CANARY-PRIVATE-4417')));
    expect(subCalls.every((c) => c.passages.every((p) => !p.text.includes('CANARY')))).toBe(true);

    // Only document admins can index; a project id from another org is a 404.
    expect((await sub.browser.post(`${s.base}/ai/index`)).statusCode).toBe(403);
    const cross = await other.owner.browser.post(
      `/v1/orgs/${other.org.id}/projects/${s.project.id}/ai/ask`,
      { question },
    );
    expect(cross.statusCode).toBe(404);
  });
});
