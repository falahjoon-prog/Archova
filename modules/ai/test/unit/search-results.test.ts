import { describe, expect, it } from 'vitest';
import { queryTerms } from '../../src/domain/retrieval';
import { SNIPPET_CHARS, onePerPage, snippet } from '../../src/domain/search-results';

describe('queryTerms', () => {
  it('lists the distinct search words in the order asked, without filler words', () => {
    expect(queryTerms('What is the basement leak at grid C4? Leak!')).toEqual([
      'basement',
      'leak',
      'grid',
      'c4',
    ]);
    expect(queryTerms('clause 0821.3.2 on drawing A-301')).toEqual([
      'clause',
      '0821.3.2',
      'drawing',
      'a-301',
    ]);
    expect(queryTerms('the of?')).toEqual([]);
  });
});

describe('snippet', () => {
  const filler = (n: number) => 'Lorem ipsum dolor sit amet consectetur. '.repeat(n);

  it('returns a short passage whole, with its white space tidied', () => {
    expect(snippet('Slab edge\n  setback is\t150 mm.', ['slab'])).toBe(
      'Slab edge setback is 150 mm.',
    );
  });

  it('shows the stretch around the first query word of a long passage, cut on word boundaries', () => {
    const text = `${filler(20)}The basement walls are tanked. ${filler(20)}`;
    const s = snippet(text, ['basement']);
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s).toContain('The basement walls are tanked.');
    // Nothing but whole words between the ellipses.
    const body = s.slice(1, -1);
    expect(body.length).toBeLessThanOrEqual(SNIPPET_CHARS);
    expect(body.startsWith(' ')).toBe(false);
    expect(text).toContain(body);
    expect(/^[A-Za-z]/.test(body) && /[.A-Za-z]$/.test(body)).toBe(true);
  });

  it('starts at the beginning when the word is near it, or when there is no word to find', () => {
    const near = snippet(`Basement waterproofing. ${filler(20)}`, ['basement']);
    expect(near.startsWith('Basement waterproofing.')).toBe(true);
    expect(near.startsWith('…')).toBe(false);
    expect(near.endsWith('…')).toBe(true);
    const none = snippet(filler(20), ['basement']);
    expect(none.startsWith('Lorem ipsum')).toBe(true);
    expect(snippet(filler(20), []).startsWith('Lorem ipsum')).toBe(true);
  });

  it('matches whole words only: "no" is not found inside "concrete", and clause numbers match as written', () => {
    const text = `${filler(20)}Concrete is grade N40. Clause 6.3.2 applies here. ${filler(20)}`;
    expect(snippet(text, ['no'])).toMatch(/^Lorem/);
    expect(snippet(text, ['6.3.2'])).toContain('Clause 6.3.2 applies');
    expect(snippet(`${filler(20)}See A-301 for detail. ${filler(20)}`, ['a-301'])).toContain(
      'See A-301 for detail',
    );
  });

  it('treats a regular-expression character in a term as plain text', () => {
    expect(() => snippet(filler(20), ['(a', '[b', 'c.*'])).not.toThrow();
    expect(snippet(`${filler(20)}Cost is $5 (est). ${filler(20)}`, ['(est)'])).toContain('(est)');
    // "a.c" would match "abc" as a pattern; as text it does not.
    expect(snippet(`${filler(20)}Plan abc is here. ${filler(20)}`, ['a.c'])).toMatch(/^Lorem/);
  });

  it('copes with one very long word', () => {
    const s = snippet(`${'x'.repeat(1000)} basement`, ['basement']);
    expect(s.length).toBeLessThanOrEqual(SNIPPET_CHARS + 2);
  });
});

describe('onePerPage', () => {
  const hit = (sourceId: string, revisionId: string, page: number, text: string) => ({
    sourceType: 'document',
    sourceId,
    revisionId,
    page,
    text,
  });
  it('keeps the best-ranked passage of each page of each revision, in rank order', () => {
    const ranked = [
      hit('d1', 'r1', 2, 'best'),
      hit('d2', 'r1', 1, 'second'),
      hit('d1', 'r1', 2, 'same page, lower'),
      hit('d1', 'r2', 2, 'same page of a later revision'),
      hit('d1', 'r1', 3, 'another page'),
    ];
    expect(onePerPage(ranked).map((r) => r.text)).toEqual([
      'best',
      'second',
      'same page of a later revision',
      'another page',
    ]);
  });
  it('tells a drawing from a document with the same ids', () => {
    expect(
      onePerPage([
        { ...hit('x', 'r', 1, 'a'), sourceType: 'drawing' },
        { ...hit('x', 'r', 1, 'b'), sourceType: 'document' },
      ]),
    ).toHaveLength(2);
  });
});
