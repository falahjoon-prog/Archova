import { describe, expect, it } from 'vitest';
import { startersFor } from '../data/starters';

describe('starters', () => {
  it('builds RFI starters from the open and overdue counts', () => {
    const s = startersFor(
      {
        projectId: 'prj_1',
        record: { type: 'rfis', id: 'register' },
        counts: { open: 4, overdue: 2 },
      },
      'acme',
    );
    expect(s.questions[0]).toContain('2 RFIs are overdue');
    expect(s.actions.map((a) => a.label)).toEqual(['New RFI']);
  });
  it('skips chips about things that are not there', () => {
    const s = startersFor(
      {
        projectId: 'prj_1',
        record: { type: 'defects', id: 'register' },
        counts: { open: 0, overdue: 0, review: 0 },
      },
      'acme',
    );
    expect(s.questions).toEqual([]);
  });
  it('offers nothing without a project', () => {
    expect(startersFor({ record: { type: 'rfis', id: 'register' } }, 'acme')).toEqual({
      questions: [],
      actions: [],
    });
  });
});
