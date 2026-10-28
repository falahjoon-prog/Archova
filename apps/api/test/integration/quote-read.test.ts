import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { scannedPdf, scriptedOcr } from './scans';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

const COLUMNS = [50, 300, 350, 400, 480];

/** A quote PDF: each row's cells (split at two spaces) are drawn apart, as a table prints them. */
async function quotePdf(pages: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const rows of pages) {
    const page = doc.addPage([595, 842]);
    rows.forEach((row, i) =>
      row
        .split(/\s{2,}/)
        .forEach((cell, c) =>
          page.drawText(cell, { x: COLUMNS[c] ?? 480, y: 780 - i * 22, size: 10, font }),
        ),
    );
  }
  return doc.save();
}

const QUOTE = [
  'Tiles & Surfaces Pty Ltd',
  'Quotation No: TS-2291',
  'Valid until: 30/04/2026',
  'Description  Qty  Unit  Rate  Amount',
  'Floor tiles supply and lay  120  m2  $34.33  $4,119.60',
  'Wall tiles supply and lay  96  m2  $41.00  $3,936.00',
  'Provisional sum - tile trims  1  item  $1,500.00  $1,500.00',
  'Total (ex GST)  $9,555.60',
  'GST  $955.56',
  'Exclusions',
  '- Screed or floor preparation',
  '- Scaffolding above 2 m',
  'Qualifications',
  '- Price valid for 30 days',
];

const etagOf = (res: { headers: Record<string, unknown> }) => res.headers.etag as string;
const SCOPE = [
  { key: 'floor', description: 'Floor tiles', quantity: '120', unit: 'm2', source: 'typed' },
  { key: 'wall', description: 'Wall tiles', quantity: '96', unit: 'm2', source: 'typed' },
];

async function setup() {
  const pm = await signUp(t.app, 'qread-pm');
  const mgr = await signUp(t.app, 'qread-mgr');
  const site = await signUp(t.app, 'qread-site');
  const tiler = await signUp(t.app, 'qread-tiler');
  const org = await createOrg(pm.browser, 'Quote Builders');
  const project = await createProject(pm.browser, org.id, { name: 'Tower T', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, mgr.email, 'Project Admin', 'Main Co');
  await addMember(pm.browser, org.id, project.id, site.email, 'Site Manager', 'Site Co');
  const co = await addMember(
    pm.browser,
    org.id,
    project.id,
    tiler.email,
    'Subcontractor',
    'Tiles A',
  );

  const draft = await pm.browser.post(`${base}/tender-packages`, {
    name: 'Tiling',
    trade: 'Tiling',
    dueAt: '2031-01-15T05:00:00Z',
    scope: SCOPE,
  });
  const pkg = draft.json();
  await pm.browser.post(`${base}/tender-packages/${pkg.id}/invites`, {
    companyIds: [co.companyId],
  });
  const sent = await pm.browser.post(
    `${base}/tender-packages/${pkg.id}/transition`,
    { action: 'send' },
    { 'if-match': etagOf(draft) },
  );
  expect(sent.json().status).toBe('out_to_tender');
  const file = await uploadBytes(
    t,
    pm.browser,
    org.id,
    project.id,
    await quotePdf([QUOTE]),
    'tiles.pdf',
  );
  return { pm, mgr, site, tiler, org, project, base, pkg, draft, co, file };
}

describe('Nova quote reading (F22)', () => {
  it('reads a PDF quote into lines, notes and a checked total, each linked to its page', async () => {
    const s = await setup();
    const before = t.ai.calls.length;
    const res = await s.pm.browser.post(`${s.base}/ai/quote-readings`, {
      packageId: s.pkg.id,
      fileId: s.file,
    });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.runId).toMatch(/^air_/);
    expect(d.suggestionId).toMatch(/^ais_/);
    expect(d).toMatchObject({
      packageId: s.pkg.id,
      fileId: s.file,
      pageCount: 1,
      scannedPages: [],
      skippedPages: [],
      truncated: false,
      reference: 'TS-2291',
      validUntil: '2026-04-30',
      prices: 'exclude_gst',
      statedTotalExGst: '9555.60',
      linesTotalExGst: '9555.60',
      discountsExGst: '0.00',
      totalCheck: 'matches',
      difference: '0.00',
      dropped: 0,
      warnings: [],
    });
    expect(d.lines).toEqual([
      {
        description: 'Floor tiles supply and lay',
        scopeKey: 'floor',
        quantity: '120',
        unit: 'm2',
        rate: '34.33',
        amount: '4119.60',
        isProvisional: false,
        source: { page: 1, snippet: expect.stringContaining('4,119.60') },
        warning: null,
      },
      expect.objectContaining({ scopeKey: 'wall', amount: '3936.00', isProvisional: false }),
      expect.objectContaining({ scopeKey: null, amount: '1500.00', isProvisional: true }),
    ]);
    expect(d.exclusions.map((e: { text: string }) => e.text)).toEqual([
      'Screed or floor preparation',
      'Scaffolding above 2 m',
    ]);
    expect(d.exclusions[0].source).toMatchObject({ page: 1 });
    expect(d.qualifications.map((e: { text: string }) => e.text)).toEqual([
      'Price valid for 30 days',
    ]);

    // The model got the package's scope and the page text, not ids.
    const call = t.ai.calls.slice(before).find((c) => c.task === 'quote.read')!;
    expect(call.text).toContain('<line key="floor" quantity="120" unit="m2">Floor tiles</line>');
    expect(call.text).toContain('<trade>Tiling</trade>');
    expect(call.text).toContain('Wall tiles supply and lay');
  });

  it('keeps the reading for the estimator who asked, and nobody else can list or decide it', async () => {
    const s = await setup();
    const made = (
      await s.pm.browser.post(`${s.base}/ai/quote-readings`, {
        packageId: s.pkg.id,
        fileId: s.file,
      })
    ).json();

    const listed = (await s.pm.browser.get(`${s.base}/ai/suggestions?task=quote.read`)).json();
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]).toMatchObject({
      id: made.suggestionId,
      task: 'quote.read',
      targetType: 'tender_package',
      targetId: s.pkg.id,
      status: 'pending',
      runId: made.runId,
      payload: {
        packageId: s.pkg.id,
        fileId: s.file,
        totalCheck: 'matches',
        lines: [{ amount: '4119.60' }, { amount: '3936.00' }, { amount: '1500.00' }],
      },
    });

    // Another project member never sees the reading, and can't decide it.
    const theirs = (await s.mgr.browser.get(`${s.base}/ai/suggestions?task=quote.read`)).json();
    expect(theirs.data).toEqual([]);
    expect(
      (
        await s.mgr.browser.post(`${s.base}/ai/suggestions/${made.suggestionId}/decision`, {
          decision: 'accepted',
        })
      ).statusCode,
    ).toBe(404);

    const decided = await s.pm.browser.post(
      `${s.base}/ai/suggestions/${made.suggestionId}/decision`,
      { decision: 'edited' },
    );
    expect(decided.statusCode).toBe(200);
    expect(decided.json()).toMatchObject({ id: made.suggestionId, status: 'edited' });
  });

  it('saves the quote from the reading: marked ai_extracted, the suggestion on the event, Nova’s amount kept when corrected', async () => {
    const s = await setup();
    const made = (
      await s.pm.browser.post(`${s.base}/ai/quote-readings`, {
        packageId: s.pkg.id,
        fileId: s.file,
      })
    ).json();

    const body = {
      companyId: s.co.companyId,
      reference: made.reference,
      validUntil: made.validUntil,
      fileIds: [s.file],
      aiSuggestionId: made.suggestionId,
      lines: made.lines.map(
        (l: {
          description: string;
          scopeKey: string | null;
          quantity: string | null;
          unit: string;
          rate: string | null;
          amount: string;
          isProvisional: boolean;
          source: unknown;
        }) => ({
          description: l.description,
          scopeKey: l.scopeKey,
          quantity: l.quantity,
          unit: l.unit,
          rate: l.rate,
          amount: l.amount,
          isProvisional: l.isProvisional,
          source: l.source,
        }),
      ),
      exclusions: made.exclusions.map(
        (e: { text: string; scopeKey: string | null; source: unknown }) => ({
          text: e.text,
          scopeKey: e.scopeKey,
          source: e.source,
        }),
      ),
      qualifications: made.qualifications.map((e: { text: string; source: unknown }) => ({
        text: e.text,
        source: e.source,
      })),
    };
    const created = await s.pm.browser.post(`${s.base}/tender-packages/${s.pkg.id}/quotes`, body);
    expect(created.statusCode).toBe(201);
    const quote = created.json();
    expect(quote).toMatchObject({
      source: 'ai_extracted',
      status: 'ready_to_review',
      totalExGst: '9555.60',
      reference: 'TS-2291',
    });
    expect(quote.lines[0]).toMatchObject({ amount: '4119.60', originalAmount: null });
    expect(quote.lines[0].source).toMatchObject({ page: 1 });

    const events = await outboxData<{ aiSuggestionId: string | null; quoteId: string }>(
      t,
      s.org.id,
      s.pm.userId,
      'estimating.quote.received.v1',
    );
    expect(events).toHaveLength(1);
    expect(events.at(-1)!.aiSuggestionId).toBeTruthy();

    // The estimator corrects a misread amount: the quote keeps what Nova read.
    const edited = await s.pm.browser.patch(
      `${s.base}/tender-packages/${s.pkg.id}/quotes/${quote.id}`,
      {
        lines: quote.lines.map(
          (l: { id: string; description: string; amount: string }, i: number) => ({
            id: l.id,
            description: l.description,
            amount: i === 0 ? '4219.60' : l.amount,
          }),
        ),
      },
      { 'if-match': etagOf(created) },
    );
    expect(edited.statusCode).toBe(200);
    expect(edited.json().lines[0]).toMatchObject({ amount: '4219.60', originalAmount: '4119.60' });
    expect(edited.json().lines[1].originalAmount).toBeNull();

    // A manual quote has no suggestion and stays manual.
    const manual = await s.pm.browser.post(`${s.base}/tender-packages/${s.pkg.id}/quotes`, {
      companyId: s.co.companyId,
      lines: [{ description: 'Floor tiling', amount: '4000.00' }],
    });
    expect(manual.json()).toMatchObject({ source: 'manual' });
  });

  it('lets only builder staff save a quote from a reading', async () => {
    const s = await setup();
    const made = (
      await s.pm.browser.post(`${s.base}/ai/quote-readings`, {
        packageId: s.pkg.id,
        fileId: s.file,
      })
    ).json();
    const res = await s.tiler.browser.post(`${s.base}/tender-packages/${s.pkg.id}/quotes`, {
      aiSuggestionId: made.suggestionId,
      lines: [{ description: 'Floor tiling', amount: '4000.00' }],
    });
    expect(res.statusCode).toBe(403);
  });

  it('is for estimators: a subcontractor or site manager can’t ask, and the package must be taking quotes', async () => {
    const s = await setup();
    const ask = (who: typeof s.pm, packageId = s.pkg.id) =>
      who.browser.post(`${s.base}/ai/quote-readings`, { packageId, fileId: s.file });
    expect((await ask(s.tiler)).statusCode).toBe(403);
    expect((await ask(s.site)).statusCode).toBe(403);

    const other = await s.pm.browser.post(`${s.base}/tender-packages`, {
      name: 'Draft package',
      trade: 'Tiling',
      scope: SCOPE,
    });
    const notOut = await ask(s.pm, other.json().id);
    expect(notOut.statusCode).toBe(409);
    expect(notOut.json().code).toBe('tender.invalid_state');

    const nobody = await s.pm.browser.post(`${s.base}/ai/quote-readings`, {
      packageId: 'tpk_00000000000000000000000000',
      fileId: s.file,
    });
    expect(nobody.statusCode).toBe(404);
  });

  it('refuses a file that is not a PDF with text, and one from another project', async () => {
    const s = await setup();
    const post = (fileId: string) =>
      s.pm.browser.post(`${s.base}/ai/quote-readings`, { packageId: s.pkg.id, fileId });

    const photo = await uploadBytes(
      t,
      s.pm.browser,
      s.org.id,
      s.project.id,
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
      'quote.png',
      'image/png',
    );
    expect((await post(photo)).statusCode).toBe(422);

    const blank = await uploadBytes(
      t,
      s.pm.browser,
      s.org.id,
      s.project.id,
      await quotePdf([[]]),
      'blank.pdf',
    );
    t.ai.onOcr(() => ({ lines: [] }));
    const none = await post(blank);
    expect(none.statusCode).toBe(422);
    expect(none.json().detail).toContain('any text');

    const elsewhere = await createProject(s.pm.browser, s.org.id, { name: 'Other', state: 'NSW' });
    const foreign = await uploadBytes(
      t,
      s.pm.browser,
      s.org.id,
      elsewhere.id,
      await quotePdf([QUOTE]),
      'other.pdf',
    );
    expect((await post(foreign)).statusCode).toBe(422);
  });

  it('reads scanned pages through OCR and says which', async () => {
    const s = await setup();
    const a4: [number, number] = [595, 842];
    const file = await uploadBytes(
      t,
      s.pm.browser,
      s.org.id,
      s.project.id,
      await scannedPdf([
        {
          text: [
            'Floor tiles supply and lay                                     $4,119.60',
            'Total (ex GST)  $4,119.60',
          ],
          size: a4,
        },
        { scan: { width: 1240, height: 1754 }, size: a4 },
      ]),
      'scanned.pdf',
    );
    t.ai.onOcr(
      scriptedOcr({
        1240: [
          { text: 'Exclusions', left: 0.08, top: 0.06 },
          { text: 'Removal of existing tiles', left: 0.08, top: 0.09 },
        ],
      }),
    );
    const res = await s.pm.browser.post(`${s.base}/ai/quote-readings`, {
      packageId: s.pkg.id,
      fileId: file,
    });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d).toMatchObject({ pageCount: 2, scannedPages: [2], skippedPages: [] });
    expect(d.exclusions).toEqual([
      expect.objectContaining({
        text: 'Removal of existing tiles',
        source: { page: 2, snippet: expect.any(String) },
      }),
    ]);
  });

  it('flags what the PDF does not back: an amount that is not printed, words that are not there', async () => {
    const s = await setup();
    t.ai.on('quote.read', () => ({
      output: {
        reference: 'TS-2291',
        validUntil: null,
        prices: 'exclude_gst',
        statedTotal: '$9,555.60',
        lines: [
          {
            page: 1,
            snippet: 'Floor tiles supply and lay  120  m2  $34.33  $4,119.60',
            description: 'Floor tiles',
            scopeKey: 'floor',
            quantity: '120',
            unit: 'm2',
            rate: '$34.33',
            amount: '$4,000.00',
            provisional: false,
          },
          {
            page: 1,
            snippet: 'Bathroom tiling lump sum price on request',
            description: 'Bathroom tiling',
            scopeKey: 'ghost',
            quantity: null,
            unit: null,
            rate: null,
            amount: '$99,999.00',
            provisional: false,
          },
        ],
        exclusions: [],
        qualifications: [],
      },
    }));
    try {
      const res = await s.pm.browser.post(`${s.base}/ai/quote-readings`, {
        packageId: s.pkg.id,
        fileId: s.file,
      });
      expect(res.statusCode).toBe(200);
      const d = res.json();
      expect(d.lines[0]).toMatchObject({ amount: '4000.00', warning: 'amount_not_on_page' });
      expect(d.lines[0].source).toMatchObject({ page: 1 });
      expect(d.lines[1]).toMatchObject({
        scopeKey: null,
        source: null,
        warning: 'source_not_found',
      });
      expect(d).toMatchObject({ totalCheck: 'differs', linesTotalExGst: '103999.00' });
      expect(d.warnings).toContain('total_differs');
    } finally {
      t.ai.on('quote.read', undefined as never);
    }
  });
});
