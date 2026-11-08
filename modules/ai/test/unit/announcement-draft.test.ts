import { describe, expect, it } from 'vitest';
import { reviewAnnouncementDraft } from '../../src/domain/announcement-draft';

const NOTES = 'Slab pour moved from Thursday 12 Nov to Monday 16 Nov. Formwork crew stays on.';

describe('announcement draft review', () => {
  it('keeps a draft the notes support', () => {
    const r = reviewAnnouncementDraft(
      {
        title: 'Slab pour moved to Monday 16 Nov',
        body: 'The slab pour is now Monday 16 Nov, not Thursday 12 Nov.\nFormwork crew stays on.',
        priority: 'normal',
      },
      NOTES,
    );
    expect(r.notes).toEqual([]);
    expect(r.body).toContain('Monday 16 Nov');
  });

  it('removes a sentence with a number or day the notes do not hold, and says so', () => {
    const r = reviewAnnouncementDraft(
      {
        title: 'Slab pour moved',
        body: 'The pour is now Monday 16 Nov. Concrete arrives at 6am. Trucks come Tuesday.',
        priority: 'normal',
      },
      NOTES,
    );
    expect(r.body).toBe('The pour is now Monday 16 Nov.');
    expect(r.notes[0]).toContain('Removed 2 sentences');
  });

  it('replaces a title that invents a date', () => {
    const r = reviewAnnouncementDraft(
      { title: 'Pour moved to 20 Nov', body: 'Formwork crew stays on.', priority: 'normal' },
      NOTES,
    );
    expect(r.title).toBe('Project update');
    expect(r.notes).toHaveLength(1);
  });
});
