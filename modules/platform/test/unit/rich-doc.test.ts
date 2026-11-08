import { describe, expect, it } from 'vitest';
import { checkStatusTile, richDocLength } from '../../src/application/rich-doc';

const doc = (text: string) => ({
  blocks: [{ type: 'paragraph' as const, lines: [[{ text, bold: true }]] }],
});

describe('status tile limits', () => {
  it('counts text across blocks, lines and runs', () => {
    expect(
      richDocLength({
        blocks: [
          { type: 'bullet_list', lines: [[{ text: 'ab' }, { text: 'c' }], [{ text: 'de' }]] },
          { type: 'paragraph', lines: [[{ text: 'f' }]] },
        ],
      }),
    ).toBe(6);
  });
  it('accepts a tile at the limit and refuses one over it', () => {
    expect(() => checkStatusTile({ title: null, doc: doc('x'.repeat(8000)) })).not.toThrow();
    expect(() => checkStatusTile({ title: null, doc: doc('x'.repeat(8001)) })).toThrow(/too long/);
  });
});
