import { describe, expect, it } from 'vitest';
import {
  acknowledgementSummary,
  flagRank,
  formatTransmittalNumber,
  parseRecipients,
  receiptState,
  type RegisterFlag,
  type RegisterRecipient,
} from '../lib/types';

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

describe('register helpers', () => {
  const r = (role: 'to' | 'cc', status: RegisterRecipient['status']) =>
    ({ role, status }) as RegisterRecipient;

  it('summarises acknowledgements for the people asked, not the copied ones', () => {
    expect(acknowledgementSummary([])).toBe('Not issued');
    expect(acknowledgementSummary([r('cc', 'cc')])).toBe('1 copied');
    expect(
      acknowledgementSummary([r('to', 'acknowledged'), r('to', 'overdue'), r('cc', 'cc')]),
    ).toBe('1 of 2 acknowledged');
  });

  it('ranks the worst flag', () => {
    const f = (severity: 'high' | 'medium' | 'low') => ({ severity }) as RegisterFlag;
    expect(flagRank([])).toBe(0);
    expect(flagRank([f('low'), f('high'), f('medium')])).toBe(3);
  });
});
