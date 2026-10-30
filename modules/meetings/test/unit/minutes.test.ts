import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  AGENDA_TEMPLATES,
  carryForward,
  defaultStatus,
  forAudience,
  isParty,
  isStale,
  itemNumber,
  sectionsFromAgenda,
  type MinutesView,
} from '../../src/domain/minutes';
import { minutesLines, renderMinutesPdf } from '../../src/domain/pdf';

describe('agenda and numbering (MTG-AC1)', () => {
  it('starts a site coordination series with the standard sections', () => {
    expect(AGENDA_TEMPLATES.site_coordination.map((s) => s.title)).toEqual([
      'Safety',
      'Programme',
      'Design',
      'RFIs',
      'Submittals',
      'Variations',
      'Quality',
      'General',
    ]);
  });
  it('keeps the builder-only commercial section of a PCG internal', () => {
    expect(AGENDA_TEMPLATES.pcg.filter((s) => s.internalOnly).map((s) => s.title)).toEqual([
      'Builder only: commercial',
    ]);
  });
  it('numbers items section.item', () => {
    expect(itemNumber(3, 2)).toBe('3.2');
    expect(sectionsFromAgenda(AGENDA_TEMPLATES.custom)).toEqual([
      { position: 1, title: 'General', internalOnly: false, nextItem: 1 },
    ]);
  });
  it('opens actions and records everything else', () => {
    expect(defaultStatus('action')).toBe('open');
    expect(defaultStatus('decision')).toBe('closed');
    expect(defaultStatus('information')).toBe('closed');
  });
});

describe('carryForward (MTG-AC2)', () => {
  const prev = {
    sections: [
      { position: 1, title: 'Safety', internalOnly: false, nextItem: 3 },
      { position: 2, title: 'Programme', internalOnly: false, nextItem: 2 },
    ],
    items: [
      { id: 'a', sectionPosition: 1, threadId: 't1', carriedCount: 0, status: 'open' as const },
      { id: 'b', sectionPosition: 1, threadId: 't2', carriedCount: 2, status: 'closed' as const },
      { id: 'c', sectionPosition: 2, threadId: 't3', carriedCount: 2, status: 'open' as const },
    ],
  };
  it('brings only open items, one carry older, in the same section', () => {
    const next = carryForward(prev);
    expect(next.items).toEqual([
      { fromId: 'a', sectionPosition: 1, threadId: 't1', carriedCount: 1 },
      { fromId: 'c', sectionPosition: 2, threadId: 't3', carriedCount: 3 },
    ]);
  });
  it('keeps section positions and counters so numbers are never reused', () => {
    expect(carryForward(prev).sections).toEqual(prev.sections);
  });
  it('flags an open action carried three times', () => {
    expect(isStale({ kind: 'action', status: 'open', carriedCount: 3 })).toBe(true);
    expect(isStale({ kind: 'action', status: 'open', carriedCount: 2 })).toBe(false);
    expect(isStale({ kind: 'decision', status: 'open', carriedCount: 5 })).toBe(false);
    expect(isStale({ kind: 'action', status: 'closed', carriedCount: 5 })).toBe(false);
  });
});

describe('who sees minutes (MTG-AC7)', () => {
  const sub = { userId: 'u2', companyId: 'c2', isInternal: false };
  it('matches an attendee by person or by company', () => {
    expect(isParty(sub, [{ userId: 'u2' }])).toBe(true);
    expect(isParty(sub, [{ companyId: 'c2' }])).toBe(true);
    expect(isParty(sub, [{ userId: 'u9', companyId: 'c9' }])).toBe(false);
    expect(isParty({ ...sub, companyId: null }, [{ companyId: null, userId: null }])).toBe(false);
  });
});

const minutes: MinutesView = {
  title: 'Weekly site meeting 4',
  number: 4,
  seriesName: 'Weekly site meeting',
  heldAt: '2026-11-03T22:00:00.000Z',
  location: 'Site office',
  version: 2,
  issuedAt: '2026-11-04T01:00:00.000Z',
  correctionsBy: '2026-11-06',
  attendees: [{ name: 'Dana', companyName: 'Builder', role: 'PM', attendance: 'present' }],
  sections: [
    {
      position: 1,
      title: 'Safety',
      internalOnly: false,
      items: [
        {
          itemNo: '1.1',
          kind: 'action',
          body: 'Fix the edge protection on level 3',
          status: 'open',
          ownerName: 'Sparky',
          dueDate: '2026-11-10',
          carriedCount: 2,
        },
      ],
    },
    {
      position: 2,
      title: 'Builder only: commercial',
      internalOnly: true,
      items: [
        {
          itemNo: '2.1',
          kind: 'information',
          body: 'Margin is thin',
          status: 'closed',
          ownerName: null,
          dueDate: null,
          carriedCount: 0,
        },
      ],
    },
  ],
};

describe('minutes PDF (MTG-AC4, AC7)', () => {
  it('leaves internal-only sections out for outsiders', () => {
    const external = minutesLines(forAudience(minutes, 'external'))
      .map((l) => l.text)
      .join('\n');
    expect(external).toContain('1.1');
    expect(external).not.toContain('Margin is thin');
    expect(external).not.toContain('commercial');
    expect(
      minutesLines(forAudience(minutes, 'internal'))
        .map((l) => l.text)
        .join('\n'),
    ).toContain('Margin is thin');
  });
  it('prints the owner, due date and carries', () => {
    const lines = minutesLines(minutes).map((l) => l.text);
    expect(lines).toContain('Owner: Sparky   Due: 2026-11-10   Carried forward 2 times');
    expect(lines.some((l) => l.includes('minutes version 2'))).toBe(true);
    expect(lines.some((l) => l.includes('Corrections by 2026-11-06'))).toBe(true);
  });
  it('renders a readable PDF, paging long minutes and surviving odd characters', async () => {
    const long: MinutesView = {
      ...minutes,
      sections: [
        {
          position: 1,
          title: 'General',
          internalOnly: false,
          items: Array.from({ length: 120 }, (_, i) => ({
            itemNo: `1.${i + 1}`,
            kind: 'information' as const,
            body: `Note ${i} with a symbol ✓ and a long run of words to wrap across the line`,
            status: 'closed' as const,
            ownerName: null,
            dueDate: null,
            carriedCount: 0,
          })),
        },
      ],
    };
    const bytes = await renderMinutesPdf(long);
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });
});
