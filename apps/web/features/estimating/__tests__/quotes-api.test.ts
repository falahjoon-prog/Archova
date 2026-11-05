import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
const { fakeProblem } = await import('@/test/fake-api');
vi.mock('@/shared/lib/api', () => fake.module);
const uploadFile = vi.hoisted(() => vi.fn());
vi.mock('@/shared/lib/uploads', () => ({ uploadFile, fileDownloadUrl: vi.fn() }));

const { createQuotesApi, fromCents, toCents } = await import('../data/quotes-api');
const { resetProjectPeople } = await import('@/shared/lib/people');

const P = '/v1/orgs/{orgId}/projects/{projectId}/tender-packages';
const PKG = `${P}/{packageId}`;
const QUOTES = `${PKG}/quotes`;
const QUOTE = `${QUOTES}/{quoteId}`;
const source = createQuotesApi('org_1');

const apiPackage = (over: Record<string, unknown> = {}) => ({
  id: 'tpk_1',
  projectId: 'prj_1',
  number: 3,
  numberLabel: 'TP-003',
  name: 'Tiling',
  trade: 'Tiling',
  status: 'out_to_tender',
  dueAt: '2026-11-10T05:00:00Z',
  scope: [
    { key: 'floor', description: 'Floor tiles', quantity: '48', unit: 'm²', source: 'typed' },
  ],
  documents: [{ kind: 'drawing_revision', id: 'drv_1' }],
  invites: [
    {
      companyId: 'cmp_t',
      status: 'invited',
      invitedAt: '2026-10-30T00:00:00Z',
      viewedAt: null,
      respondedAt: null,
    },
  ],
  allowances: { 'quo_1:floor': '3000.50' },
  award: null,
  createdAt: '2026-10-30T00:00:00Z',
  updatedAt: '2026-10-30T00:00:00Z',
  version: 4,
  ...over,
});

const apiQuote = (over: Record<string, unknown> = {}) => ({
  id: 'quo_1',
  packageId: 'tpk_1',
  companyId: 'cmp_t',
  revision: 2,
  status: 'ready_to_review',
  reference: 'Q-77',
  fileIds: ['fil_1'],
  receivedAt: '2026-10-30T00:00:00Z',
  validUntil: '2026-12-01',
  totalExGst: '4000.00',
  gst: '400.00',
  currency: 'AUD',
  lines: [
    {
      id: 'qln_1',
      scopeKey: 'floor',
      description: 'Floor tiles',
      quantity: '48',
      unit: 'm²',
      rate: '83.33',
      amount: '4000.00',
      isProvisional: false,
      originalAmount: null,
      source: { page: 2, snippet: 'Floor tiles 4,000.00' },
    },
  ],
  exclusions: [{ id: 'qnt_1', text: 'No waterproofing', scopeKey: null, source: null }],
  qualifications: [],
  source: 'ai_extracted',
  confirmedBy: null,
  confirmedAt: null,
  version: 7,
  ...over,
});

beforeEach(() => {
  fake.reset();
  resetProjectPeople();
  uploadFile.mockReset();
  fake.on('GET', '/v1/orgs/{orgId}/projects/{projectId}/members', () => ({
    data: [{ userId: 'usr_dana', name: 'Dana Okafor', companyId: 'cmp_b', status: 'active' }],
    nextCursor: null,
  }));
  fake.on('GET', '/v1/orgs/{orgId}/files/{fileId}', () => ({
    id: 'fil_1',
    filename: 'tiling-quote.pdf',
  }));
});

describe('money', () => {
  it('moves between decimal strings and cents without a float', () => {
    expect(toCents('1234.50')).toBe(123450);
    expect(toCents('12')).toBe(1200);
    expect(toCents('0.5')).toBe(50);
    expect(fromCents(123450)).toBe('1234.50');
    expect(fromCents(5)).toBe('0.05');
  });
});

describe('tender packages', () => {
  it('maps a package, its allowances and its award', async () => {
    fake.on('GET', PKG, () =>
      apiPackage({
        award: {
          quoteId: 'quo_1',
          by: 'usr_dana',
          at: '2026-10-31T00:00:00Z',
          reason: 'Best fit',
          notLowest: true,
        },
      }),
    );
    const pkg = await source.getPackage('prj_1', 'tpk_1');
    expect(pkg).toMatchObject({
      id: 'tpk_1',
      number: 3,
      status: 'out_to_tender',
      allowances: { 'quo_1:floor': 300050 },
      award: { quoteId: 'quo_1', by: 'Dana Okafor', reason: 'Best fit', notLowest: true },
    });
    expect(pkg.scope[0]).toMatchObject({ key: 'floor', quantity: 48, unit: 'm²' });
  });

  it('adds scope lines to the current ones with the version it read', async () => {
    fake.on('GET', PKG, () => apiPackage());
    fake.on('PATCH', PKG, () => apiPackage());
    await source.addScopeLines('prj_1', 'tpk_1', [
      { key: 'skirting', description: 'Skirting', quantity: 80, unit: 'm', source: 'csv' },
    ]);
    const [call] = fake.callsTo('PATCH', PKG);
    expect(call!.init.params!.header).toEqual({ 'If-Match': '"4"' });
    expect(call!.init.body).toEqual({
      scope: [
        { key: 'floor', description: 'Floor tiles', quantity: '48', unit: 'm²', source: 'typed' },
        { key: 'skirting', description: 'Skirting', quantity: '80', unit: 'm', source: 'csv' },
      ],
    });
  });

  it('sends a draft out to tender with its version', async () => {
    fake.on('GET', PKG, () => apiPackage({ status: 'draft' }));
    fake.on('POST', `${PKG}/transition`, () => apiPackage());
    await source.transition('prj_1', 'tpk_1', 'send');
    const [call] = fake.callsTo('POST', `${PKG}/transition`);
    expect(call!.init.body).toEqual({ action: 'send' });
    expect(call!.init.params!.header).toEqual({ 'If-Match': '"4"' });
  });

  it('replaces the allowances, dropping one that was cleared', async () => {
    fake.on('GET', PKG, () => apiPackage());
    fake.on('PUT', `${PKG}/allowances`, () => apiPackage());
    await source.setAllowance('prj_1', 'tpk_1', 'quo_1', 'floor', null);
    await source.setAllowance('prj_1', 'tpk_1', 'quo_2', 'floor', 120000);
    const [clear, set] = fake.callsTo('PUT', `${PKG}/allowances`);
    expect(clear!.init.body).toEqual({ allowances: {} });
    expect(set!.init.body).toEqual({
      allowances: { 'quo_1:floor': '3000.50', 'quo_2:floor': '1200.00' },
    });
  });

  it('records the award with the reason only when there is one', async () => {
    fake.on('GET', PKG, () => apiPackage());
    fake.on('POST', `${PKG}/award`, () => apiPackage({ status: 'awarded' }));
    await source.award('prj_1', 'tpk_1', 'quo_1', '  ', { name: 'x' }, '2026-10-30');
    await source.award('prj_1', 'tpk_1', 'quo_2', ' Best fit ', { name: 'x' }, '2026-10-30');
    const [plain, reasoned] = fake.callsTo('POST', `${PKG}/award`);
    expect(plain!.init.body).toEqual({ quoteId: 'quo_1' });
    expect(reasoned!.init.body).toEqual({ quoteId: 'quo_2', reason: 'Best fit' });
  });
});

describe('quotes', () => {
  it('maps a quote with its file name, lines and sources', async () => {
    fake.on('GET', QUOTES, () => ({ data: [apiQuote()] }));
    const [q] = await source.listQuotes('prj_1', 'tpk_1');
    expect(q).toMatchObject({
      version: 2,
      status: 'ready_to_review',
      fileName: 'tiling-quote.pdf',
      reference: 'Q-77',
      source: 'ai_extracted',
    });
    expect(q!.lines[0]).toMatchObject({ amountCents: 400000, originalAmountCents: null });
    expect(q!.lines[0]!.source).toEqual({ page: 2, snippet: 'Floor tiles 4,000.00' });
  });

  it('corrects one amount and sends every line back with its id', async () => {
    fake.on('GET', QUOTE, () => apiQuote());
    fake.on('PATCH', QUOTE, () =>
      apiQuote({
        lines: [{ ...apiQuote().lines[0], amount: '4100.00', originalAmount: '4000.00' }],
      }),
    );
    const q = await source.correctLine('prj_1', 'tpk_1', 'quo_1', 'qln_1', 410000);
    const [call] = fake.callsTo('PATCH', QUOTE);
    expect(call!.init.params!.header).toEqual({ 'If-Match': '"7"' });
    const body = call!.init.body as { lines: Array<{ id: string; amount: string }> };
    expect(body.lines[0]).toMatchObject({ id: 'qln_1', amount: '4100.00' });
    expect(q.lines[0]).toMatchObject({ amountCents: 410000, originalAmountCents: 400000 });
  });

  it('confirms and declines with the version it read', async () => {
    fake.on('GET', QUOTE, () => apiQuote());
    fake.on('POST', `${QUOTE}/confirm`, () =>
      apiQuote({ status: 'confirmed', confirmedBy: 'usr_dana' }),
    );
    fake.on('POST', `${QUOTE}/decline`, () => apiQuote({ status: 'declined' }));
    const confirmed = await source.confirmQuote('prj_1', 'tpk_1', 'quo_1', { name: 'x' });
    const declined = await source.declineQuote('prj_1', 'tpk_1', 'quo_1');
    expect(confirmed).toMatchObject({ status: 'confirmed', confirmedBy: 'Dana Okafor' });
    expect(declined.status).toBe('declined');
    expect(fake.callsTo('POST', `${QUOTE}/confirm`)[0]!.init.params!.header).toEqual({
      'If-Match': '"7"',
    });
  });

  describe('uploading a PDF', () => {
    const READINGS = '/v1/orgs/{orgId}/projects/{projectId}/ai/quote-readings';
    const reading = (over: Record<string, unknown> = {}) => ({
      runId: 'air_1',
      suggestionId: 'ais_1',
      packageId: 'tpk_1',
      fileId: 'fil_1',
      pageCount: 2,
      scannedPages: [],
      skippedPages: [],
      truncated: false,
      reference: 'Q-77',
      validUntil: '2026-12-01',
      prices: 'exclude_gst',
      lines: [
        {
          description: 'Floor tiles',
          scopeKey: 'floor',
          quantity: '48',
          unit: 'm²',
          rate: '83.33',
          amount: '4000.00',
          isProvisional: false,
          source: { page: 2, snippet: 'Floor tiles 4,000.00' },
          warning: null,
        },
      ],
      exclusions: [{ text: 'No waterproofing', scopeKey: null, source: null, warning: null }],
      qualifications: [],
      statedTotalExGst: '4000.00',
      linesTotalExGst: '4000.00',
      discountsExGst: '0.00',
      totalCheck: 'matches',
      difference: null,
      dropped: 0,
      warnings: [],
      ...over,
    });

    beforeEach(() => {
      uploadFile.mockResolvedValue({ id: 'fil_1', filename: 'tiling-quote.pdf', status: 'ready' });
      fake.on('POST', QUOTES, () => apiQuote());
    });

    it('stores the file, has Nova read it and saves the reading as the quote’s first draft', async () => {
      fake.on('POST', READINGS, () => reading());
      const file = new File(['x'], 'tiling-quote.pdf', { type: 'application/pdf' });
      const q = await source.uploadQuote('prj_1', 'tpk_1', { companyId: 'cmp_t', file });
      expect(uploadFile).toHaveBeenCalledWith('org_1', {
        file,
        projectId: 'prj_1',
        module: 'estimating',
      });
      expect(fake.callsTo('POST', READINGS)[0]!.init.body).toEqual({
        packageId: 'tpk_1',
        fileId: 'fil_1',
      });
      const body = fake.callsTo('POST', QUOTES)[0]!.init.body as Record<string, unknown>;
      expect(body).toMatchObject({
        companyId: 'cmp_t',
        reference: 'Q-77',
        fileIds: ['fil_1'],
        validUntil: '2026-12-01',
        aiSuggestionId: 'ais_1',
        qualifications: [],
      });
      expect(q.fileName).toBe('tiling-quote.pdf');
    });

    it('leaves a note for the estimator when the reading needs checking', async () => {
      fake.on('POST', READINGS, () =>
        reading({
          prices: 'include_gst',
          totalCheck: 'differs',
          difference: '120.00',
          skippedPages: [3],
          lines: [{ ...reading().lines[0], warning: 'amount_not_on_page' }],
        }),
      );
      await source.uploadQuote('prj_1', 'tpk_1', {
        companyId: 'cmp_t',
        file: new File(['x'], 'q.pdf', { type: 'application/pdf' }),
      });
      const body = fake.callsTo('POST', QUOTES)[0]!.init.body as {
        qualifications: Array<{ text: string }>;
      };
      expect(body.qualifications.map((n) => n.text)).toEqual([
        expect.stringContaining('include GST'),
        expect.stringContaining('do not add up'),
        expect.stringContaining('not printed on the page'),
        expect.stringContaining('did not read every page'),
      ]);
    });

    it('saves nothing when Nova can’t read the PDF', async () => {
      fake.on('POST', READINGS, () => fakeProblem(422, 'ai.unreadable'));
      await expect(
        source.uploadQuote('prj_1', 'tpk_1', {
          companyId: 'cmp_t',
          file: new File(['x'], 'q.pdf', { type: 'application/pdf' }),
        }),
      ).rejects.toBeTruthy();
      expect(fake.callsTo('POST', QUOTES)).toHaveLength(0);
    });
  });
});
