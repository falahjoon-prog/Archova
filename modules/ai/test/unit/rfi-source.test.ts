import { describe, expect, it } from 'vitest';
import { rfiRevisionId, rfiText, type RfiSource } from '../../src/domain/rfi-source';

const RFI: RfiSource = {
  id: 'r1',
  number: 'RFI-031',
  subject: 'Level 3 corridor door hardware',
  status: 'closed',
  question: 'Lever handles or knobs?',
  responses: [
    { id: 'x1', official: true, text: 'Lever handles to AS 1428.1.' },
    { id: 'x2', official: false, text: 'Noted.' },
  ],
};

describe('rfiText', () => {
  it('puts the number, subject and status first, then the question and each response', () => {
    expect(rfiText(RFI)).toBe(
      [
        'RFI-031: Level 3 corridor door hardware\nStatus: closed',
        'Question:\nLever handles or knobs?',
        'Official response:\nLever handles to AS 1428.1.',
        'Comment (not the official response):\nNoted.',
      ].join('\n\n'),
    );
  });

  it('says so when there is no official response, even if someone has commented', () => {
    const text = rfiText({
      ...RFI,
      status: 'open',
      responses: [{ id: 'x2', official: false, text: 'Maybe the dark grey.' }],
    });
    expect(text).toContain('Comment (not the official response):\nMaybe the dark grey.');
    expect(text.endsWith('There is no official response on this RFI yet.')).toBe(true);
    expect(rfiText(RFI)).not.toContain('no official response');
  });

  it('skips empty responses and copes with a missing number', () => {
    const text = rfiText({
      ...RFI,
      number: null,
      responses: [{ id: 'x1', official: true, text: '   ' }],
    });
    expect(text.startsWith('RFI: Level 3 corridor door hardware')).toBe(true);
    expect(text).not.toContain('Official response:');
    expect(text).toContain('no official response');
  });
});

describe('rfiRevisionId', () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/;

  it('is a UUID that stays the same while the text does', () => {
    expect(rfiRevisionId(RFI)).toMatch(uuid);
    expect(rfiRevisionId({ ...RFI })).toBe(rfiRevisionId(RFI));
    // Ids of responses are not part of the text: only what they say.
    expect(
      rfiRevisionId({
        ...RFI,
        responses: RFI.responses.map((r) => ({ ...r, id: `${r.id}-other` })),
      }),
    ).toBe(rfiRevisionId(RFI));
  });

  it('changes with a new response, an edit to the question, a new status or another RFI', () => {
    const base = rfiRevisionId(RFI);
    const more = {
      ...RFI,
      responses: [...RFI.responses, { id: 'x3', official: false, text: 'Ok.' }],
    };
    expect(rfiRevisionId(more)).not.toBe(base);
    expect(rfiRevisionId({ ...RFI, question: 'Lever handles?' })).not.toBe(base);
    expect(rfiRevisionId({ ...RFI, status: 'answered' })).not.toBe(base);
    expect(rfiRevisionId({ ...RFI, id: 'r2' })).not.toBe(base);
  });

  it('changes when a comment becomes the official response', () => {
    const promoted = {
      ...RFI,
      responses: [RFI.responses[0]!, { ...RFI.responses[1]!, official: true }],
    };
    expect(rfiRevisionId(promoted)).not.toBe(rfiRevisionId(RFI));
  });
});
