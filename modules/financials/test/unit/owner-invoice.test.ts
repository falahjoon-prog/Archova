import { describe, expect, it } from 'vitest';
import {
  backupItemsFor,
  checkSubClaims,
  ownerInvoiceTotals,
  type SubClaimFacts,
} from '../../src/domain/owner-invoice';

const claim = (over: Partial<SubClaimFacts> = {}): SubClaimFacts => ({
  claimId: 'pcl_1',
  contractId: 'cnt_1',
  payeeCompanyId: 'co_1',
  number: 1,
  periodEnd: '2026-09-30',
  completedToDateCents: 3_000_000,
  thisPeriodCents: 3_000_000,
  revisedSumCents: 10_000_000,
  isValid: true,
  statementExpected: false,
  hasStatement: false,
  ...over,
});
const codes = (c: SubClaimFacts, all: SubClaimFacts[]) =>
  checkSubClaims([c], all)
    .get(c.claimId)!
    .map((f) => f.code);

describe('checkSubClaims', () => {
  it('passes a plain claim', () => {
    const c = claim();
    expect(codes(c, [c])).toEqual([]);
  });

  it('flags the same period and amount on the same contract, even if the twin is already billed', () => {
    const a = claim();
    const b = claim({ claimId: 'pcl_2', number: 2 });
    expect(codes(a, [a, b])).toEqual(['duplicate']);
    expect(codes(b, [a, b])).toEqual(['duplicate']);
  });

  it('flags the same payee, period and amount across contracts', () => {
    const a = claim();
    const b = claim({ claimId: 'pcl_2', contractId: 'cnt_2' });
    expect(codes(a, [a, b])).toEqual(['duplicate']);
    const other = claim({ claimId: 'pcl_3', contractId: 'cnt_2', payeeCompanyId: 'co_2' });
    expect(codes(a, [a, other])).toEqual([]);
  });

  it('does not call a zero-value pair a duplicate', () => {
    const a = claim({ thisPeriodCents: 0 });
    const b = claim({ claimId: 'pcl_2', thisPeriodCents: 0 });
    expect(codes(a, [a, b])).toEqual([]);
  });

  it('flags a claim over three times the contract median, but needs two others to compare', () => {
    const peers = [1, 2].map((n) =>
      claim({ claimId: `p${n}`, periodEnd: `2026-0${n}-28`, thisPeriodCents: 1_000_000 }),
    );
    const big = claim({ claimId: 'big', periodEnd: '2026-08-31', thisPeriodCents: 3_500_000 });
    expect(codes(big, [...peers, big])).toEqual(['outlier']);
    const fine = claim({ claimId: 'fine', periodEnd: '2026-08-31', thisPeriodCents: 3_000_000 });
    expect(codes(fine, [...peers, fine])).toEqual([]);
    expect(codes(big, [peers[0]!, big])).toEqual([]);
  });

  it('flags completed to date over the contract sum, a missing statement and an invalid claim', () => {
    const c = claim({
      completedToDateCents: 10_000_001,
      statementExpected: true,
      isValid: false,
    });
    expect(codes(c, [c])).toEqual(['overclaim', 'statement_missing', 'invalid_claim']);
    const ok = claim({ statementExpected: true, hasStatement: true });
    expect(codes(ok, [ok])).toEqual([]);
  });
});

describe('ownerInvoiceTotals', () => {
  it('adds markup to the sub total to the cent', () => {
    expect(ownerInvoiceTotals(['19000.00', '19000.00'], '10.00')).toEqual({
      subTotal: '38000.00',
      markupAmount: '3800.00',
      total: '41800.00',
    });
    expect(ownerInvoiceTotals(['100.05'], '12.50')).toEqual({
      subTotal: '100.05',
      markupAmount: '12.51',
      total: '112.56',
    });
    expect(ownerInvoiceTotals([], '10')).toEqual({
      subTotal: '0.00',
      markupAmount: '0.00',
      total: '0.00',
    });
  });
});

describe('backupItemsFor', () => {
  it('lists what is attached, missing or not needed', () => {
    const items = backupItemsFor({
      hasClaimPdf: true,
      hasSchedulePdf: false,
      statementExpected: true,
      hasStatement: false,
      statementSignedOn: null,
    });
    expect(items.map((i) => [i.kind, i.status])).toEqual([
      ['claim_pdf', 'attached'],
      ['payment_schedule_pdf', 'missing'],
      ['subcontractor_statement', 'missing'],
    ]);
    const qld = backupItemsFor({
      hasClaimPdf: true,
      hasSchedulePdf: true,
      statementExpected: false,
      hasStatement: false,
      statementSignedOn: null,
    });
    expect(qld[2]!.status).toBe('not_required');
  });
});
