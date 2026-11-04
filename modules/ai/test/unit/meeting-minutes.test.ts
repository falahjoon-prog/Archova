import { describe, expect, it } from 'vitest';
import type { MeetingMinutesOutput } from '@archova/ai-prompts';
import {
  minutesFingerprint,
  reviewMinutes,
  type MinutesContext,
} from '../../src/domain/meeting-minutes';

const context: MinutesContext = {
  title: 'Site coordination 14',
  date: '2026-10-07', // a Wednesday
  sections: [
    { id: 's1', title: 'Safety' },
    { id: 's2', title: 'Programme' },
  ],
  attendees: [
    { id: 'a1', name: 'Dana Whitfield', company: 'Harbour Builders' },
    { id: 'a2', name: 'Sam Okafor', company: 'Coastal Steel Fixing' },
  ],
};
const notes = [
  'Action: Sam Okafor to deliver 12 t of N16 reo by Friday.',
  'Decision: slab pour moved to 15 October.',
  'Info: crane certificate is current.',
].join('\n');

const item = (over: Partial<MeetingMinutesOutput['items'][number]> = {}) => ({
  kind: 'action' as const,
  sectionId: 's2',
  text: 'Deliver the N16 reo',
  quote: 'Sam Okafor to deliver 12 t of N16 reo by Friday',
  ownerId: 'a2',
  dueDate: '2026-10-09',
  ...over,
});
const review = (items: MeetingMinutesOutput['items']) => reviewMinutes({ items }, notes, context);

describe('reviewMinutes', () => {
  it('keeps an item whose quote, owner and due date the notes support', () => {
    const r = review([item()]);
    expect(r.dropped).toBe(0);
    expect(r.items).toEqual([
      expect.objectContaining({ sectionId: 's2', ownerId: 'a2', dueDate: '2026-10-09' }),
    ]);
  });

  it('drops an item whose quote is not in the notes, and a repeat', () => {
    const r = review([
      item({ quote: 'Sam to pay the invoice by Friday' }),
      item(),
      item({ quote: 'Sam Okafor to deliver 12 t of N16 reo' }),
    ]);
    expect(r.items).toHaveLength(1);
    expect(r.dropped).toBe(2);
  });

  it('drops an item that states a number its quote does not contain', () => {
    const r = review([item({ text: 'Deliver 14 t of N16 reo' })]);
    expect(r.items).toHaveLength(0);
    expect(r.dropped).toBe(1);
  });

  it('keeps a number that is in the quote', () => {
    expect(review([item({ text: 'Deliver 12 t of N16 reo' })]).items).toHaveLength(1);
  });

  it('removes an owner the quote does not name, and an owner on a non-action', () => {
    const noName = reviewMinutes(
      { items: [item({ quote: 'deliver 12 t of N16 reo by Friday', ownerId: 'a1' })] },
      notes.replace('Sam Okafor to ', ''),
      context,
    );
    expect(noName.items[0]!.ownerId).toBeNull();
    const decision = review([
      item({
        kind: 'decision',
        quote: 'slab pour moved to 15 October',
        text: 'Slab pour moved',
        ownerId: 'a2',
      }),
    ]);
    expect(decision.items[0]!.ownerId).toBeNull();
  });

  it('matches an owner by their company name too', () => {
    const r = reviewMinutes(
      { items: [item({ quote: 'Coastal to deliver 12 t of N16 reo by Friday', ownerId: 'a2' })] },
      'Coastal to deliver 12 t of N16 reo by Friday',
      context,
    );
    expect(r.items[0]!.ownerId).toBe('a2');
  });

  it('keeps a due date only when the quote gives a day and the weekday agrees', () => {
    expect(review([item({ dueDate: '2026-10-09' })]).items[0]!.dueDate).toBe('2026-10-09');
    // "by Friday" cannot be a Thursday.
    expect(review([item({ dueDate: '2026-10-08' })]).items[0]!.dueDate).toBeNull();
    // Before the meeting.
    expect(review([item({ dueDate: '2026-10-02' })]).items[0]!.dueDate).toBeNull();
    // No date in the quote at all.
    const noCue = reviewMinutes(
      {
        items: [
          item({
            quote: 'Sam Okafor to deliver the reo',
            text: 'Deliver the reo',
            dueDate: '2026-10-09',
          }),
        ],
      },
      'Sam Okafor to deliver the reo',
      context,
    );
    expect(noCue.items[0]!.dueDate).toBeNull();
    // Only actions carry a due date.
    expect(
      review([
        item({
          kind: 'decision',
          quote: 'slab pour moved to 15 October',
          text: 'Slab pour moved',
          dueDate: '2026-10-15',
        }),
      ]).items[0]!.dueDate,
    ).toBeNull();
  });

  it('sends an unknown section to none', () => {
    expect(review([item({ sectionId: 's9' })]).items[0]!.sectionId).toBeNull();
  });
});

describe('minutesFingerprint', () => {
  it('changes with the notes and the meeting, not with surrounding whitespace', () => {
    const a = minutesFingerprint(notes, context);
    expect(minutesFingerprint(`  ${notes}\n`, context)).toBe(a);
    expect(minutesFingerprint(`${notes}\nInfo: more`, context)).not.toBe(a);
    expect(
      minutesFingerprint(notes, { ...context, attendees: context.attendees.slice(1) }),
    ).not.toBe(a);
  });
});
