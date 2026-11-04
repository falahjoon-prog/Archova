import { describe, expect, it } from 'vitest';
import type { ContractCompareOutput } from '@archova/ai-prompts';
import { reviewComparison } from '../../src/domain/contract-compare';

const BASE = [
  { page: 1, text: '14.1 Retention of 5% is held.\n22.4 The Contractor keeps site records.' },
];
const OTHER = [
  { page: 1, text: '14.1 Retention of 10% is held.\n25.2 A security of 2% of the sum is paid.' },
];
type Change = ContractCompareOutput['changes'][number];
const changed: Change = {
  kind: 'changed',
  topic: 'Retention',
  summary: 'Retention rises from 5% to 10%.',
  base: { page: 1, clause: '14.1', quote: 'Retention of 5% is held.' },
  other: { page: 1, clause: '14.1', quote: 'Retention of 10% is held.' },
};
const run = (...changes: Change[]) => reviewComparison({ changes }, BASE, OTHER);

describe('compare contracts rules', () => {
  it('shows a change whose quotes are in the right contracts', () => {
    const r = run(changed);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({ kind: 'changed', base: { page: 1, clause: '14.1' } });
  });

  it('checks each quote against its own contract, not the other one', () => {
    // The 10% words are only in the other contract, so naming them on the base side fails.
    const swapped: Change = { ...changed, base: changed.other, other: changed.base };
    const r = run(swapped);
    expect(r.changes).toHaveLength(0);
    expect(r.dropped.notOnPage).toBe(1);
  });

  it('keeps added and removed changes with only the side they have', () => {
    const added: Change = {
      kind: 'added',
      topic: 'Security',
      summary: 'A security of 2% is added.',
      // A base the model should not have given for an added clause is ignored.
      base: changed.base,
      other: { page: 1, clause: '25.2', quote: 'A security of 2% of the sum is paid.' },
    };
    const removed: Change = {
      kind: 'removed',
      topic: 'Site records',
      summary: 'The site records clause is gone.',
      base: { page: 1, clause: '22.4', quote: 'The Contractor keeps site records.' },
      other: null,
    };
    const r = run(added, removed);
    expect(r.changes.map((c) => [c.kind, c.base?.clause ?? null, c.other?.clause ?? null])).toEqual(
      [
        ['added', null, '25.2'],
        ['removed', '22.4', null],
      ],
    );
  });

  it('drops a change whose quote is invented, too short or missing', () => {
    const r = run(
      { ...changed, other: { page: 1, clause: '14.1', quote: 'Retention is always 20%.' } },
      { ...changed, base: { page: 1, clause: null, quote: '14.1' } },
      { ...changed, other: null },
    );
    expect(r.changes).toHaveLength(0);
    expect(r.dropped.notOnPage).toBe(3);
  });

  it('drops a "change" whose two quotes are the same words', () => {
    const same = { page: 1, clause: '14.1', quote: 'Retention of 10% is held.' };
    const r = reviewComparison(
      { changes: [{ ...changed, base: same, other: same }] },
      [{ page: 1, text: same.quote }],
      [{ page: 1, text: same.quote }],
    );
    expect(r.changes).toHaveLength(0);
    expect(r.dropped.notAChange).toBe(1);
  });

  it('drops a change that gives a view on fairness, validity or signing', () => {
    for (const summary of [
      'The new retention is unfair.',
      'This version is safe to sign.',
      'The change is enforceable.',
    ]) {
      const r = run({ ...changed, summary });
      expect(r.changes).toHaveLength(0);
      expect(r.dropped.bannedWords).toBe(1);
    }
    expect(run({ ...changed, topic: 'Fair retention' }).dropped.bannedWords).toBe(1);
  });
});
