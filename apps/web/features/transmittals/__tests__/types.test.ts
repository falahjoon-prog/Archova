import { describe, expect, it } from 'vitest';
import { formatTransmittalNumber, parseRecipients, receiptState } from '../lib/types';

const none = { deliveredAt: null, openedAt: null, downloadedAt: null, acknowledgedAt: null };

describe('transmittal helpers', () => {
  it('numbers a sent transmittal and calls a draft a draft', () => {
    expect(formatTransmittalNumber(12)).toBe('T-0012');
    expect(formatTransmittalNumber(null)).toBe('Draft');
  });

  it('reports the furthest step a recipient has reached', () => {
    const t = '2026-10-30T00:00:00Z';
    expect(receiptState(none)).toBe('not_sent');
    expect(receiptState({ ...none, deliveredAt: t })).toBe('sent');
    expect(receiptState({ ...none, deliveredAt: t, openedAt: t })).toBe('opened');
    expect(receiptState({ ...none, openedAt: t, downloadedAt: t })).toBe('downloaded');
    expect(receiptState({ ...none, openedAt: t, downloadedAt: t, acknowledgedAt: t })).toBe(
      'acknowledged',
    );
  });

  it('splits recipients on commas, semicolons and spaces, drops repeats and flags bad ones', () => {
    expect(parseRecipients('a@x.com, b@y.com;\nA@X.com  nope')).toEqual({
      emails: ['a@x.com', 'b@y.com'],
      invalid: ['nope'],
    });
    expect(parseRecipients('')).toEqual({ emails: [], invalid: [] });
  });
});
