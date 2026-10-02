import { describe, expect, it } from 'vitest';
import {
  CHUNK_MAX_CHARS,
  CHUNK_TARGET_CHARS,
  chunkPages,
  keywordQuery,
  reciprocalRankFusion,
} from '../../src/domain/retrieval';

describe('chunkPages', () => {
  it('keeps short pages whole and never joins pages', () => {
    const out = chunkPages([
      { page: 1, text: '0612.1 STANDARDS\nComply with AS 3740.' },
      { page: 2, text: '   ' },
      { page: 3, text: '0612.2 MEMBRANE\nClass III.' },
    ]);
    expect(out).toEqual([
      { page: 1, chunkIndex: 0, text: '0612.1 STANDARDS\nComply with AS 3740.' },
      { page: 3, chunkIndex: 0, text: '0612.2 MEMBRANE\nClass III.' },
    ]);
  });

  it('splits long pages on paragraph boundaries near the target size', () => {
    const para = (n: number) => `CLAUSE ${n}\n${'word '.repeat(150).trim()}`;
    const text = Array.from({ length: 12 }, (_, i) => para(i)).join('\n\n');
    const out = chunkPages([{ page: 4, text }]);
    expect(out.length).toBeGreaterThan(1);
    expect(out.map((c) => c.chunkIndex)).toEqual(out.map((_, i) => i));
    for (const c of out) {
      expect(c.page).toBe(4);
      expect(c.text.length).toBeLessThanOrEqual(CHUNK_TARGET_CHARS);
      expect(c.text.startsWith('CLAUSE')).toBe(true);
    }
  });

  it('breaks a single huge line by words and caps every chunk', () => {
    const out = chunkPages([{ page: 1, text: 'x'.repeat(20_000) + ' ' + 'y '.repeat(5000) }]);
    expect(out.every((c) => c.text.length <= CHUNK_MAX_CHARS)).toBe(true);
    expect(out.length).toBeGreaterThan(2);
  });
});

describe('reciprocalRankFusion', () => {
  it('ranks ids found by both searches first', () => {
    expect(
      reciprocalRankFusion([
        ['a', 'b', 'c'],
        ['c', 'd', 'a'],
      ]),
    ).toEqual(['a', 'c', 'b', 'd']);
  });

  it('handles one empty list', () => {
    expect(reciprocalRankFusion([[], ['x', 'y']])).toEqual(['x', 'y']);
  });
});

describe('keywordQuery', () => {
  it('drops stop words, keeps document and clause numbers whole, ORs the terms', () => {
    expect(keywordQuery('What FRL is required by clause 0821.3.2 on drawing A-301?')).toBe(
      'frl OR required OR clause OR 0821.3.2 OR drawing OR a-301',
    );
  });

  it('is empty when nothing searchable is left', () => {
    expect(keywordQuery('what is the?')).toBe('');
  });
});
