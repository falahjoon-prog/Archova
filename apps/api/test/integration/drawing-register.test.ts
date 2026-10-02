import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeId } from '@archova/domain';
import { hexToBase64, quarantineKey } from '@archova/mod-files';
import {
  createOrg,
  createProject,
  createTestContext,
  signUp,
  type Browser,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

interface Sheet {
  number: string;
  rev: string;
  title: string;
  date: string;
}

/** An A1 drawing set; each sheet's title block sits in the bottom-right corner, like a CAD export. */
async function drawingSet(sheets: Sheet[], blankPages = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const s of sheets) {
    const page = doc.addPage([2384, 1684]);
    page.drawText('GENERAL NOTES: ALL DIMENSIONS IN MILLIMETRES', {
      x: 60,
      y: 1600,
      size: 14,
      font,
    });
    const lines = [
      'Smith & Co Architects Pty Ltd',
      'PROJECT No.  2417',
      'DRAWING TITLE',
      s.title.toUpperCase(),
      'SCALE  1:100 @ A1',
      `DATE  ${s.date}`,
      `DRAWING No.  ${s.number}    REV  ${s.rev}`,
    ];
    lines.forEach((text, i) => page.drawText(text, { x: 1900, y: 260 - i * 30, size: 14, font }));
  }
  for (let i = 0; i < blankPages; i++) doc.addPage([2384, 1684]);
  return doc.save();
}

async function uploadPdf(browser: Browser, orgId: string, projectId: string, bytes: Uint8Array) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const u = (
    await browser.post(`/v1/orgs/${orgId}/uploads`, {
      filename: 'Architectural issue.pdf',
      mime: 'application/pdf',
      sizeBytes: bytes.length,
      sha256,
      module: 'documents',
      projectId,
    })
  ).json();
  t.store.put(quarantineKey(decodeId('upload', u.id)!), bytes.length, hexToBase64(sha256), bytes);
  const done = await browser.post(`/v1/orgs/${orgId}/uploads/${u.id}/complete`);
  expect(done.statusCode).toBe(200);
  return done.json() as { id: string };
}

describe('drawing register auto-fill (F1)', () => {
  it('reads each sheet, flags what needs checking, and matches revisions after a person accepts', async () => {
    const { browser } = await signUp(t.app, 'dr');
    const org = await createOrg(browser, 'Register Builders');
    const project = await createProject(browser, org.id);
    const base = `/v1/orgs/${org.id}/projects/${project.id}/ai`;

    const file = await uploadPdf(
      browser,
      org.id,
      project.id,
      await drawingSet(
        [
          { number: 'A-101', rev: 'B', title: 'Ground Floor Plan', date: '03/04/2026' },
          { number: 'A-102', rev: 'A', title: 'Level 1 Floor Plan', date: '03/04/2026' },
        ],
        1,
      ),
    );
    const res = await browser.post(`${base}/drawing-register/extractions`, { fileId: file.id });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ pageCount: 3, skippedPages: [3], refusedPages: [] });
    expect(body.suggestions).toHaveLength(2);
    const [s1, s2] = body.suggestions;
    expect(s1).toMatchObject({
      task: 'drawing.titleblock',
      status: 'pending',
      targetType: 'file_page',
      targetId: file.id,
      payload: {
        fileId: file.id,
        page: 1,
        isDrawing: true,
        match: { action: 'new_drawing' },
        fields: {
          number: { value: 'A-101', flagged: false },
          revision: { value: 'B', flagged: false },
          revisionDate: { value: '2026-04-03' },
          discipline: { value: 'architectural' },
          scale: { value: '1:100 @ A1' },
        },
      },
    });
    expect(s2.payload.fields.number.value).toBe('A-102');

    // Edit one, accept the other: only decided sheets form the register.
    const edited = await browser.post(`${base}/suggestions/${s1.id}/decision`, {
      decision: 'edited',
      fields: { title: 'Ground Floor Plan - Retail' },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({
      status: 'edited',
      payload: { decided: { number: 'A-101', revision: 'B', title: 'Ground Floor Plan - Retail' } },
    });
    const again = await browser.post(`${base}/suggestions/${s1.id}/decision`, {
      decision: 'rejected',
    });
    expect(again.statusCode).toBe(409);
    await browser.post(`${base}/suggestions/${s2.id}/decision`, { decision: 'accepted' });

    // The next issue brings A-101 rev C: a new revision that supersedes B, after confirmation.
    const next = await uploadPdf(
      browser,
      org.id,
      project.id,
      await drawingSet([
        { number: 'A-101', rev: 'C', title: 'Ground Floor Plan', date: '20/05/2026' },
        { number: 'A-102', rev: 'A', title: 'Level 1 Floor Plan', date: '03/04/2026' },
        { number: 'A-103', rev: 'A', title: 'Level 2 Floor Plan', date: '20/05/2026' },
      ]),
    );
    const r2 = (
      await browser.post(`${base}/drawing-register/extractions`, { fileId: next.id })
    ).json();
    expect(r2.suggestions.map((s: { payload: { match: unknown } }) => s.payload.match)).toEqual([
      { action: 'new_revision', supersedes: 'B' },
      { action: 'same_revision' },
      { action: 'new_drawing' },
    ]);

    const pending = await browser.get(
      `${base}/suggestions?task=drawing.titleblock&status=pending&limit=2`,
    );
    expect(pending.statusCode).toBe(200);
    const page1 = pending.json();
    expect(page1.data).toHaveLength(2);
    expect(page1.nextCursor).toEqual(expect.any(String));
    const page2 = (
      await browser.get(
        `${base}/suggestions?task=drawing.titleblock&status=pending&limit=2&cursor=${page1.nextCursor}`,
      )
    ).json();
    expect(page2.data).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();

    // Each sheet ran through the gateway as background work: logged, no credits.
    const usage = (await browser.get(`/v1/orgs/${org.id}/ai/usage`)).json();
    expect(usage.byFeature).toEqual([{ feature: 'drawing_register', credits: 0, runs: 5 }]);
  });

  it('lets a subcontractor see suggestions but not run or decide them, and hides other orgs', async () => {
    const owner = await signUp(t.app, 'dr-owner');
    const subbie = await signUp(t.app, 'dr-subbie');
    const org = await createOrg(owner.browser, 'Gate Builders');
    const project = await createProject(owner.browser, org.id);
    const company = (
      await owner.browser.post(`/v1/orgs/${org.id}/companies`, {
        name: 'Sparky Electrical',
        type: 'subcontractor',
        trades: ['electrical'],
      })
    ).json();
    const templates = (await owner.browser.get(`/v1/orgs/${org.id}/permission-templates`)).json()
      .data as Array<{ id: string; name: string }>;
    await owner.browser.post(`/v1/orgs/${org.id}/projects/${project.id}/members`, {
      email: subbie.email,
      companyId: company.id,
      permissionTemplateId: templates.find((x) => x.name === 'Subcontractor')!.id,
    });
    const file = await uploadPdf(
      owner.browser,
      org.id,
      project.id,
      await drawingSet([
        { number: 'E-201', rev: '1', title: 'Lighting Layout', date: '01/06/2026' },
      ]),
    );
    const base = `/v1/orgs/${org.id}/projects/${project.id}/ai`;
    const run = (
      await owner.browser.post(`${base}/drawing-register/extractions`, { fileId: file.id })
    ).json();
    const id = run.suggestions[0].id;

    const denied = await subbie.browser.post(`${base}/drawing-register/extractions`, {
      fileId: file.id,
    });
    expect(denied.statusCode).toBe(403);
    expect((await subbie.browser.get(`${base}/suggestions`)).statusCode).toBe(200);
    const decide = await subbie.browser.post(`${base}/suggestions/${id}/decision`, {
      decision: 'accepted',
    });
    expect(decide.statusCode).toBe(403);

    // Another org can't reach the file or the suggestion even with its own project.
    const other = await signUp(t.app, 'dr-other');
    const otherOrg = await createOrg(other.browser, 'Other Builders');
    const otherProject = await createProject(other.browser, otherOrg.id);
    const otherBase = `/v1/orgs/${otherOrg.id}/projects/${otherProject.id}/ai`;
    const steal = await other.browser.post(`${otherBase}/drawing-register/extractions`, {
      fileId: file.id,
    });
    expect(steal.statusCode).toBe(404);
    const foreign = await other.browser.post(`${otherBase}/suggestions/${id}/decision`, {
      decision: 'accepted',
    });
    expect(foreign.statusCode).toBe(404);
  });
});
