import { describe, expect, it } from 'vitest';
import { budgetFindings, type ReviewLine } from '../../src/domain/budget-review';

const line = (over: Partial<ReviewLine> = {}): ReviewLine => ({
  id: 'bln_1',
  code: '03-100',
  codeDescription: 'Concrete',
  original: '100000.00',
  approvedChanges: '0.00',
  committed: '0.00',
  actual: '0.00',
  isMargin: false,
  ...over,
});

describe('budgetFindings', () => {
  it('finds nothing on a line within budget', () => {
    expect(budgetFindings([line({ committed: '60000.00', actual: '30000.00' })])).toEqual([]);
  });

  it('flags a line committed past its revised budget, using the revised figure', () => {
    const all = budgetFindings([line({ approvedChanges: '20000.00', committed: '130000.00' })]);
    // The +20% change since locking is also worth a look, after the high-severity finding.
    expect(all.map((x) => x.kind)).toEqual(['over_committed', 'large_change']);
    const f = all[0];
    expect(f).toMatchObject({
      id: 'over_committed:03-100',
      severity: 'high',
      figures: { revised: '120000.00', committed: '130000.00', over: '10000.00' },
    });
    expect(f?.summary).toContain('$10,000.00 over');
  });

  it('flags spend past the budget, and a warning from 90% up to the limit', () => {
    expect(budgetFindings([line({ actual: '100000.01' })]).map((f) => f.kind)).toEqual([
      'over_spent',
    ]);
    expect(budgetFindings([line({ actual: '90000.00' })]).map((f) => f.kind)).toEqual([
      'near_limit',
    ]);
    expect(budgetFindings([line({ actual: '89999.99' })])).toEqual([]);
  });

  it('flags work on a line with no budget once, as unbudgeted', () => {
    const f = budgetFindings([line({ original: '0.00', committed: '8000.00', actual: '2000.00' })]);
    expect(f.map((x) => x.kind)).toEqual(['unbudgeted']);
  });

  it('flags a large change after locking, up or down, but not a small one', () => {
    expect(budgetFindings([line({ approvedChanges: '-15000.00' })]).map((f) => f.kind)).toEqual([
      'large_change',
    ]);
    expect(budgetFindings([line({ approvedChanges: '4000.00' })])).toEqual([]);
    // 10% of a small line, but under the dollar floor.
    expect(budgetFindings([line({ original: '20000.00', approvedChanges: '3000.00' })])).toEqual(
      [],
    );
  });

  it('never looks at margin lines, and puts high severity first', () => {
    const f = budgetFindings([
      line({ id: 'bln_m', code: '99-000', isMargin: true, actual: '999999.00' }),
      line({ id: 'bln_a', code: '01-000', actual: '95000.00' }),
      line({ id: 'bln_b', code: '02-000', committed: '120000.00' }),
    ]);
    expect(f.map((x) => x.id)).toEqual(['over_committed:02-000', 'near_limit:01-000']);
  });
});
