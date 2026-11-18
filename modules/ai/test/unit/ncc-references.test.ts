import { describe, expect, it } from 'vitest';
import {
  MAX_NCC_REFERENCES,
  matchNccReferences,
  signedProvisions,
  type NccProvision,
} from '../../src/domain/ncc-references';

const p = (over: Partial<NccProvision> = {}): NccProvision => ({
  provisionKey: 'fire_resistance',
  version: 1,
  edition: '2022',
  volume: '1',
  clause: 'C2D2',
  title: 'Type of construction required',
  summary: 'Which fire resistance level a building type must achieve.',
  url: 'https://ncc.abcb.gov.au/editions/ncc-2022/adopted/volume-one/c-fire-resistance',
  keywords: ['fire resistance', 'frl'],
  status: 'signed',
  signedBy: 'Grace',
  signedOn: '2026-11-05',
  ...over,
});
const ask = {
  question: 'Which FRL applies to the corridor wall?',
  answer: 'The spec says 90/90/90.',
};

describe('NCC references (compliance/08 §1.2)', () => {
  it('offers nothing when the table is empty or nothing matches', () => {
    expect(matchNccReferences([], ask)).toEqual([]);
    expect(
      matchNccReferences([p()], { question: 'Where is the hoist?', answer: 'Level 1.' }),
    ).toEqual([]);
  });

  it('shows a signed provision whose keyword is in the question or the answer, exactly as signed', () => {
    const [ref] = matchNccReferences([p()], ask);
    expect(ref).toMatchObject({
      provisionKey: 'fire_resistance',
      edition: '2022',
      volume: '1',
      clause: 'C2D2',
      signedBy: 'Grace',
      signedOn: '2026-11-05',
    });
  });

  it('never shows a draft, a retired or an unsigned provision', () => {
    for (const status of ['draft', 'retired'] as const)
      expect(matchNccReferences([p({ status })], ask)).toEqual([]);
    expect(matchNccReferences([p({ signedBy: null })], ask)).toEqual([]);
    expect(matchNccReferences([p({ signedOn: null })], ask)).toEqual([]);
  });

  it('uses only the latest signed version of a provision', () => {
    const rows = [p({ version: 1, clause: 'OLD' }), p({ version: 2, clause: 'NEW' })];
    expect(signedProvisions(rows).map((r) => r.clause)).toEqual(['NEW']);
    expect(matchNccReferences(rows, ask).map((r) => r.clause)).toEqual(['NEW']);
  });

  it('matches whole words only', () => {
    expect(
      matchNccReferences([p({ keywords: ['fire'] })], {
        question: 'Is there a fireplace in the lounge?',
        answer: 'Yes.',
      }),
    ).toEqual([]);
  });

  it('ranks by matches and caps the list', () => {
    const rows = [
      p({ provisionKey: 'a', clause: 'A1', keywords: ['frl'] }),
      p({ provisionKey: 'b', clause: 'B1', keywords: ['frl', 'corridor'] }),
      p({ provisionKey: 'c', clause: 'C1', keywords: ['frl'] }),
      p({ provisionKey: 'd', clause: 'D1', keywords: ['frl'] }),
    ];
    const out = matchNccReferences(rows, ask);
    expect(out).toHaveLength(MAX_NCC_REFERENCES);
    expect(out[0]!.clause).toBe('B1');
  });
});
