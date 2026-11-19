import { describe, expect, it } from 'vitest';
import type { DeclarationReadOutput } from '@archova/ai-prompts';
import { datesIn, reviewDeclarationRead } from '../../src/domain/declaration-read';

const PAGE = {
  page: 1,
  text: 'CERTIFICATE OF CURRENCY\nEmployer: Sparky Electrical Pty Ltd\nPolicy number: WC-558812\nPolicy period: 1 July 2026 to 30 June 2027\nSigned: A. Nguyen',
};
const empty: DeclarationReadOutput = {
  kind: 'workers_comp',
  companyName: null,
  declarantName: null,
  declarantPosition: null,
  declaredOn: null,
  validFrom: null,
  validTo: null,
  issuer: null,
  referenceNumber: null,
  signed: true,
};
const f = (value: string, snippet: string, page = 1) => ({ value, page, snippet });

describe('datesIn', () => {
  it('reads day/month/year in the ways Australian documents print it', () => {
    expect([...datesIn('from 1/07/2026 to 30-06-2027, signed 3.9.26')].sort()).toEqual([
      '2026-07-01',
      '2026-09-03',
      '2027-06-30',
    ]);
    expect([...datesIn('1 July 2026 and 30th Jun 2027 and 2026-08-09')].sort()).toEqual([
      '2026-07-01',
      '2026-08-09',
      '2027-06-30',
    ]);
  });
  it('reads day before month, and ignores impossible dates', () => {
    expect([...datesIn('04/05/2026')]).toEqual(['2026-05-04']);
    expect([...datesIn('31/02/2026 and 45 July 2026')]).toEqual([]);
  });
});

describe('reviewDeclarationRead', () => {
  it('keeps a value whose words are on the page and whose date is printed there', () => {
    const r = reviewDeclarationRead(
      {
        ...empty,
        companyName: f('Sparky Electrical Pty Ltd', 'Employer: Sparky Electrical Pty Ltd'),
        referenceNumber: f('WC-558812', 'Policy number: WC-558812'),
        validFrom: f('2026-07-01', 'Policy period: 1 July 2026 to 30 June 2027'),
        validTo: f('2027-06-30', 'Policy period: 1 July 2026 to 30 June 2027'),
      },
      [PAGE],
    );
    expect(r.validTo).toEqual({
      value: '2027-06-30',
      source: { page: 1, snippet: 'Policy period: 1 July 2026 to 30 June 2027' },
    });
    expect(r.companyName.value).toBe('Sparky Electrical Pty Ltd');
    expect(r.referenceNumber.value).toBe('WC-558812');
    expect(r.warnings).toEqual([]);
  });

  it('drops a date that is not printed in the words it cites, and says so', () => {
    const r = reviewDeclarationRead(
      { ...empty, validTo: f('2028-06-30', 'Policy period: 1 July 2026 to 30 June 2027') },
      [PAGE],
    );
    expect(r.validTo).toEqual({ value: null, source: null });
    expect(r.warnings.join(' ')).toContain('not printed');
    expect(r.warnings.join(' ')).toContain('No end date');
  });

  it('drops words that are not on the page', () => {
    const r = reviewDeclarationRead(
      { ...empty, validTo: f('2027-06-30', 'Valid until 30 June 2027') },
      [PAGE],
    );
    expect(r.validTo.value).toBeNull();
    expect(r.warnings.join(' ')).toContain('not on the page');
  });

  it('finds the words on another page when the page number is wrong', () => {
    const r = reviewDeclarationRead(
      { ...empty, referenceNumber: f('WC-558812', 'Policy number: WC-558812', 3) },
      [
        { page: 1, text: 'cover' },
        { page: 2, text: PAGE.text },
      ],
    );
    expect(r.referenceNumber.source?.page).toBe(2);
  });

  it('drops a text value that is not in its snippet', () => {
    const r = reviewDeclarationRead(
      { ...empty, referenceNumber: f('WC-999999', 'Policy number: WC-558812') },
      [PAGE],
    );
    expect(r.referenceNumber).toEqual({ value: null, source: null });
  });

  it('warns about an unknown kind, reversed dates and a blank or unclear signature', () => {
    const r = reviewDeclarationRead(
      {
        ...empty,
        kind: null,
        signed: false,
        validFrom: f('2027-06-30', 'Policy period: 1 July 2026 to 30 June 2027'),
        validTo: f('2026-07-01', 'Policy period: 1 July 2026 to 30 June 2027'),
      },
      [PAGE],
    );
    const w = r.warnings.join(' | ');
    expect(w).toContain('which declaration');
    expect(w).toContain('after the "covers to"');
    expect(w).toContain('signature line looks blank');
    expect(reviewDeclarationRead({ ...empty, signed: null }, [PAGE]).warnings.join(' ')).toContain(
      'whether the document is signed',
    );
  });
});
