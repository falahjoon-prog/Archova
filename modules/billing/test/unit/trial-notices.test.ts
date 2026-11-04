import { describe, expect, it } from 'vitest';
import { dueNoticeDays, renderTrialEndingEmail } from '../../src/application/trial-notices';

const NOW = new Date('2026-11-04T22:00:00Z');
const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

describe('dueNoticeDays', () => {
  it('is null outside the 3-day window and once the trial has ended', () => {
    expect(dueNoticeDays(inHours(24 * 5), NOW)).toBeNull();
    expect(dueNoticeDays(inHours(0), NOW)).toBeNull();
    expect(dueNoticeDays(inHours(-2), NOW)).toBeNull();
  });
  it('picks the 3-day notice between 3 days and 1 day out', () => {
    expect(dueNoticeDays(inHours(72), NOW)).toBe(3);
    expect(dueNoticeDays(inHours(30), NOW)).toBe(3);
  });
  it('picks only the 1-day notice when first seen with a day left', () => {
    expect(dueNoticeDays(inHours(24), NOW)).toBe(1);
    expect(dueNoticeDays(inHours(2), NOW)).toBe(1);
  });
});

describe('renderTrialEndingEmail', () => {
  const base = {
    orgName: 'Harbour <Builders>',
    recipientName: 'Dana',
    recipientEmail: 'dana@example.com',
    trialEndsAt: new Date('2026-11-07T13:00:00Z'),
    timeZone: 'Australia/Sydney',
    appUrl: 'https://app.archova.com.au/harbour',
  };
  it('says tomorrow for one day and shows the date in the company time zone', () => {
    const m = renderTrialEndingEmail({ ...base, daysBefore: 1 });
    expect(m.subject).toBe('Your Archova trial ends tomorrow');
    expect(m.to).toBe('dana@example.com');
    expect(m.text).toContain('ends tomorrow');
    expect(m.text).toContain('8 November 2026');
  });
  it('says the number of days otherwise and escapes HTML', () => {
    const m = renderTrialEndingEmail({ ...base, daysBefore: 3 });
    expect(m.subject).toBe('Your Archova trial ends in 3 days');
    expect(m.html).toContain('Harbour &lt;Builders&gt;');
    expect(m.html).not.toContain('<Builders>');
  });
});
