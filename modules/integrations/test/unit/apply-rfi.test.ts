import { describe, expect, it } from 'vitest';
import { toRfiImport } from '../../src/domain/apply-rfi';

const TZ = 'Australia/Sydney';
const row = (over: Record<string, string | number | null> = {}) => ({
  number: 87,
  subject: 'Slab edge detail',
  question: 'Confirm the edge detail at gridline C',
  status: 'answered',
  dueDate: '2027-03-10',
  openedAt: '2027-03-01',
  answeredAt: '2027-03-08',
  closedAt: null,
  authorName: 'Jo Builder',
  authorEmail: 'jo@example.com',
  officialResponse: 'Use detail S-12.',
  responseBy: 'Sam Engineer',
  ...over,
});

describe('toRfiImport', () => {
  it('keeps the number, status and dates, with local dates read in the project zone', () => {
    const r = toRfiImport(row(), TZ, 'job1');
    if (!r.ok) throw new Error(r.reason);
    expect(r.input).toMatchObject({
      sourceRef: '87',
      number: 87,
      status: 'answered',
      dueDate: '2027-03-10',
      importJobId: 'job1',
    });
    // 1 March 2027 00:00 in Sydney (UTC+11) is the evening before in UTC.
    expect(r.input.openedAt.toISOString()).toBe('2027-02-28T13:00:00.000Z');
    expect(r.input.externalAuthor).toEqual({ name: 'Jo Builder', email: 'jo@example.com' });
  });

  it('turns the official response into one response dated when it was answered', () => {
    const r = toRfiImport(row(), TZ, 'j');
    if (!r.ok) throw new Error(r.reason);
    expect(r.input.responses).toEqual([
      expect.objectContaining({
        body: 'Use detail S-12.',
        authorName: 'Sam Engineer',
        isOfficial: true,
      }),
    ]);
    expect(r.input.responses[0]!.createdAt).toEqual(r.input.answeredAt);
  });

  it('falls back to the subject when there is no question, and has no response without a reply', () => {
    const r = toRfiImport(row({ question: null, officialResponse: null }), TZ, 'j');
    if (!r.ok) throw new Error(r.reason);
    expect(r.input.question).toBe('Slab edge detail');
    expect(r.input.responses).toEqual([]);
  });

  it('refuses a row without a number, subject, status or date raised', () => {
    for (const bad of [
      { number: null },
      { subject: null },
      { status: null },
      { openedAt: null },
    ] as Array<Record<string, null>>)
      expect(toRfiImport(row(bad), TZ, 'j').ok).toBe(false);
  });
});
