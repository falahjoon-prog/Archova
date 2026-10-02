import { beforeEach, describe, expect, it } from 'vitest';
import { quotesSource, resetQuotesPreview } from '../data/quotes-source';
import { comparableQuotes, levelQuotes, lowestQuoteId, parseScopeCsv } from '../lib/levelling';

const P = 'prj_q';
const est = { name: 'Dana Okafor' };
const TODAY = '2026-10-02';

beforeEach(() => resetQuotesPreview());

async function level() {
  const pkg = await quotesSource.getPackage(P, 'pkg_1');
  const quotes = comparableQuotes(await quotesSource.listQuotes(P, 'pkg_1'));
  return { pkg, quotes, ...levelQuotes(pkg, quotes, TODAY) };
}

describe('quote levelling (EST-AC6)', () => {
  it('compares only the current confirmed version of each quote, ex GST', async () => {
    const { quotes, totals } = await level();
    expect(quotes.map((q) => q.id)).toEqual(['quo_ib2', 'quo_hb1']);
    expect(totals.map((t) => t.quotedCents)).toEqual([2936000, 3195000]);
    expect(totals[0]!.gstCents).toBe(293600);
  });

  it('flags exclusions, provisional sums, expired validity and lines outside the scope', async () => {
    const { rows, totals } = await level();
    const waterproof = rows.find((r) => r.scope.key === 'waterproof')!;
    expect(waterproof.cells[1]).toMatchObject({ amountCents: null, flags: ['excluded'] });
    const skirting = rows.find((r) => r.scope.key === 'skirting')!;
    expect(skirting.cells[1]!.flags).toContain('provisional');
    expect(totals[1]).toMatchObject({ expired: true, gaps: 1 });
    expect(totals[1]!.otherLines.map((l) => l.description)).toEqual(['Site establishment']);
  });

  it('adds allowances for gaps to the normalised total only', async () => {
    await quotesSource.setAllowance(P, 'pkg_1', 'quo_hb1', 'waterproof', 300000);
    const { totals } = await level();
    expect(totals[1]).toMatchObject({ quotedCents: 3195000, normalisedCents: 3495000 });
    expect(lowestQuoteId(totals, true)).toBe('quo_ib2');
  });

  it('flags prices far from the row median once there are three', async () => {
    await quotesSource.confirmQuote(P, 'quo_gg1', est);
    const { rows } = await level();
    const lobby = rows.find((r) => r.scope.key === 'lobby_floor')!;
    expect(lobby.cells.map((c) => c.flags.includes('outlier'))).toEqual([false, true, false]);
    const skirting = rows.find((r) => r.scope.key === 'skirting')!;
    expect(skirting.cells[2]!.flags).toEqual(['missing']);
  });

  it('parses scope lines from CSV with or without a header', () => {
    let i = 0;
    const lines = parseScopeCsv(
      'Description,Qty,Unit\nFloor tiles,48,m²\nSealant,,',
      () => `k${++i}`,
    );
    expect(lines).toEqual([
      { key: 'k1', description: 'Floor tiles', quantity: 48, unit: 'm²', source: 'csv' },
      { key: 'k2', description: 'Sealant', quantity: null, unit: 'item', source: 'csv' },
    ]);
  });
});

describe('quotes and award', () => {
  it('supersedes a company’s earlier quote and keeps both (EST-AC4)', async () => {
    const q = await quotesSource.uploadQuote(P, 'pkg_1', {
      companyId: 'cmp_tile2',
      fileName: 'harbour-rev2.pdf',
    });
    expect(q).toMatchObject({ version: 2, status: 'reading' });
    const all = await quotesSource.listQuotes(P, 'pkg_1');
    expect(all.find((x) => x.id === 'quo_hb1')!.status).toBe('superseded');
    expect(all.find((x) => x.id === q.id)!.status).toBe('ready_to_review');
    expect(all.find((x) => x.id === q.id)!.lines.every((l) => l.source !== null)).toBe(true);
  });

  it('keeps Nova’s value when an amount is corrected', async () => {
    const before = (await quotesSource.listQuotes(P, 'pkg_1')).find((q) => q.id === 'quo_gg1')!;
    const lineId = before.lines[0]!.id;
    const after = await quotesSource.correctLine(P, 'quo_gg1', lineId, 400000);
    expect(after.lines[0]).toMatchObject({ amountCents: 400000, originalAmountCents: 395000 });
  });

  it('needs a reason to select a quote that is not the lowest like for like (EST-AC7)', async () => {
    await expect(quotesSource.award(P, 'pkg_1', 'quo_hb1', '', est, TODAY)).rejects.toMatchObject({
      status: 422,
    });
    await expect(quotesSource.award(P, 'pkg_1', 'quo_gg1', '', est, TODAY)).rejects.toMatchObject({
      status: 422,
    });
    const pkg = await quotesSource.award(
      P,
      'pkg_1',
      'quo_hb1',
      'Can start a week earlier',
      est,
      TODAY,
    );
    expect(pkg).toMatchObject({
      status: 'awarded',
      award: { quoteId: 'quo_hb1', notLowest: true, by: 'Dana Okafor' },
    });
  });

  it('turns sent takeoff totals into scope lines (EST-US8)', async () => {
    const pkg = await quotesSource.addTakeoffLines(P, 'pkg_2', [
      { tag: 'Wall paint', quantity: 312.456, unit: 'm2' },
    ]);
    expect(pkg.scope).toEqual([
      expect.objectContaining({
        description: 'Wall paint',
        quantity: 312.46,
        unit: 'm²',
        source: 'takeoff',
      }),
    ]);
  });
});
