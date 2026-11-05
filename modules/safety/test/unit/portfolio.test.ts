import { describe, expect, it } from 'vitest';
import { awaitingRegulatorNotice } from '../../src/domain/incident';

const i = (status: string, isNotifiable: boolean, regulatorNotifiedAt: Date | null) => ({
  status,
  isNotifiable,
  regulatorNotifiedAt,
});

describe('awaitingRegulatorNotice', () => {
  it('flags an open notifiable incident with no notification recorded', () => {
    expect(awaitingRegulatorNotice(i('reported', true, null))).toBe(true);
    expect(awaitingRegulatorNotice(i('investigating', true, null))).toBe(true);
  });
  it('does not flag one already notified, not notifiable, or closed', () => {
    expect(awaitingRegulatorNotice(i('reported', true, new Date()))).toBe(false);
    expect(awaitingRegulatorNotice(i('reported', false, null))).toBe(false);
    expect(awaitingRegulatorNotice(i('closed', true, null))).toBe(false);
  });
});
