import { describe, expect, it } from 'vitest';
import { sameContent } from '../lib/content';

describe('sameContent', () => {
  it('ignores key order but not values', () => {
    const a = {
      sections: [{ key: 'ppe', title: 'PPE', blocks: [{ type: 'text', body: 'Hat' }] }],
      quiz: [],
      passMark: 80,
    };
    const reordered = {
      passMark: 80,
      quiz: [],
      sections: [{ blocks: [{ body: 'Hat', type: 'text' }], title: 'PPE', key: 'ppe' }],
    };
    expect(sameContent(a as never, reordered as never)).toBe(true);
    expect(sameContent(a as never, { ...reordered, passMark: 90 } as never)).toBe(false);
  });
});
