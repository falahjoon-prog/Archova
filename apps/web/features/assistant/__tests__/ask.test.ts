import { describe, expect, it } from 'vitest';
import { toNovaAnswer } from '../data/ask';

const source = {
  sourceType: 'drawing' as const,
  sourceId: 'dsh_a201',
  revisionId: 'drv_c',
  revision: 'C',
  title: 'Stair sections',
  reference: 'A-201',
  page: 1,
};

describe('Ask Nova answers from the API', () => {
  it('cites document, revision and page, linking drawings to the sheet revision (F2)', () => {
    const a = toNovaAnswer({
      runId: 'air_1',
      found: true,
      answer: 'Stair walls are FRL 120/120/120.',
      citations: [
        { ...source, quote: 'FRL 120/120/120' },
        {
          ...source,
          sourceType: 'document',
          sourceId: 'doc_spec',
          revisionId: 'rev_b',
          revision: 'B',
          title: 'Fire engineering report',
          reference: null,
          page: 14,
          quote: '120 minutes',
        },
      ],
      closestMatches: [],
    });
    expect(a.kind).toBe('answer');
    expect(a.runId).toBe('air_1');
    expect(a.citations.map((c) => [c.label, c.href])).toEqual([
      ['A-201 Rev C, p. 1', 'drawing:dsh_a201:drv_c'],
      ['Fire engineering report Rev B, p. 14', 'documents:doc_spec'],
    ]);
  });

  it('cites an RFI by its number and status and links to the RFI', () => {
    const a = toNovaAnswer({
      runId: 'air_2',
      found: true,
      answer: 'Lever handles to AS 1428.1.',
      citations: [
        {
          sourceType: 'rfi',
          sourceId: 'rfi_031',
          revisionId: 'rfi_031',
          revision: 'closed',
          title: 'Level 3 corridor door hardware',
          reference: 'RFI-031',
          page: 1,
          quote: 'Provide lever handles',
        },
      ],
      closestMatches: [],
    });
    expect(a.citations.map((c) => [c.label, c.href])).toEqual([
      ['RFI-031 Level 3 corridor door hardware (closed)', 'rfi:rfi_031'],
    ]);
  });

  it('names a defect by its number, title and status and links it to the defect', () => {
    const a = toNovaAnswer({
      runId: 'air_3',
      found: true,
      answer: 'It is assigned to Tilers R Us.',
      citations: [
        {
          sourceType: 'defect',
          sourceId: 'dfx_042',
          revisionId: 'dfx_042',
          revision: 'open',
          title: 'Cracked floor tile in ensuite',
          reference: 'DEF-0042',
          page: 1,
          quote: 'Assigned to: Tilers R Us',
        },
      ],
      closestMatches: [],
    });
    expect(a.citations.map((c) => [c.label, c.href])).toEqual([
      ['DEF-0042 Cracked floor tile in ensuite (open)', 'defect:dfx_042'],
    ]);
  });

  it('names a diary day by its date and status and links it to that day', () => {
    const a = toNovaAnswer({
      runId: 'air_4',
      found: true,
      answer: 'Rain stopped the pour for two hours.',
      citations: [
        {
          sourceType: 'diary',
          sourceId: 'dia_012',
          revisionId: 'dia_012',
          revision: 'signed off',
          title: 'Site diary Monday 12 October 2026',
          reference: '2026-10-12',
          page: 1,
          quote: 'Rain stopped the Level 3 slab pour',
        },
      ],
      closestMatches: [],
    });
    expect(a.citations.map((c) => [c.label, c.href])).toEqual([
      ['Site diary Monday 12 October 2026 (signed off)', 'diary:2026-10-12'],
    ]);
  });

  it('shows the closest matches instead of a guess when nothing answers it', () => {
    const a = toNovaAnswer({
      runId: null,
      found: false,
      answer: '',
      citations: [],
      closestMatches: [source],
    });
    expect(a.kind).toBe('not_found');
    expect(a.text).toMatch(/couldn't find/);
    expect(a.citations).toHaveLength(1);
  });
});
