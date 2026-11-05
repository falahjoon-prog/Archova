import { describe, expect, it } from 'vitest';
import { releaseStages } from '../../src/domain/release';

const terms = (over = {}) => ({
  firstReleasePctHundredths: 5000,
  practicalCompletionOn: '2026-10-01',
  defectsPeriodDays: 365,
  ...over,
});
const run = (over: Record<string, unknown> = {}) =>
  releaseStages({
    terms: terms(),
    retentionHeldCents: 100_000,
    releasedByStage: {},
    today: '2026-11-05',
    ...over,
  } as Parameters<typeof releaseStages>[0]);

describe('releaseStages', () => {
  it('splits the retention by the first-release share and dates the second from practical completion', () => {
    const [pc, end] = run();
    expect(pc).toMatchObject({ entitledCents: 50_000, dueOn: '2026-10-01', status: 'due' });
    expect(end).toMatchObject({ entitledCents: 50_000, dueOn: '2027-10-01', status: 'upcoming' });
  });

  it('waits for dates that are not set', () => {
    const [pc, end] = run({ terms: terms({ practicalCompletionOn: null }) });
    expect(pc?.status).toBe('awaiting_date');
    expect(end?.status).toBe('awaiting_date');
    expect(run({ terms: terms({ defectsPeriodDays: null }) })[1]?.status).toBe('awaiting_date');
  });

  it('tracks what is released and marks a fully released stage', () => {
    const [pc, end] = run({
      releasedByStage: { practical_completion: 50_000, defects_end: 10_000 },
    });
    expect(pc).toMatchObject({ remainingCents: 0, status: 'released' });
    expect(end).toMatchObject({ releasedCents: 10_000, remainingCents: 40_000 });
  });

  it('gives the odd cent to the second stage so the stages add up', () => {
    const [pc, end] = run({
      retentionHeldCents: 10_001,
      terms: terms({ firstReleasePctHundredths: 3333 }),
    });
    expect((pc?.entitledCents ?? 0) + (end?.entitledCents ?? 0)).toBe(10_001);
  });
});
