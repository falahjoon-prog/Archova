import { describe, expect, it } from 'vitest';
import { isScheduleLinesError, scheduleFromLines } from '../../src/domain/schedule-lines';

// Two lines claimed: $20,000 and $10,000, retention $1,500, so the claim's net is $28,500.00.
const lines = [
  { sovItemId: 'a', variationId: null, thisClaim: 2_000_000 },
  { sovItemId: null, variationId: 'v', thisClaim: 1_000_000 },
];
const NET = 2_850_000;

describe('scheduleFromLines', () => {
  it('gives the claim net exactly when every line is scheduled in full, even if left out', () => {
    expect(scheduleFromLines(lines, NET, [])).toMatchObject({
      scheduledNet: NET,
      withheldNet: 0,
    });
  });

  it('scales retention with what is scheduled and keeps each reduced line with its reason', () => {
    const r = scheduleFromLines(lines, NET, [
      { variationId: 'v', scheduledAmount: 400_000, reason: 'Panels not yet installed.' },
    ]);
    if (isScheduleLinesError(r)) throw new Error('expected a schedule');
    expect(r.scheduledGross).toBe(2_400_000);
    expect(r.scheduledNet).toBe(2_280_000);
    expect(r.withheldNet).toBe(570_000);
    expect(r.lines.find((l) => l.variationId === 'v')).toMatchObject({
      claimedAmount: 1_000_000,
      scheduledAmount: 400_000,
      reason: 'Panels not yet installed.',
    });
  });

  it('refuses a reduced line with no reason and names it', () => {
    expect(scheduleFromLines(lines, NET, [{ sovItemId: 'a', scheduledAmount: 0 }])).toEqual({
      code: 'reason_missing',
      keys: ['a'],
    });
    expect(
      scheduleFromLines(lines, NET, [{ sovItemId: 'a', scheduledAmount: 0, reason: '   ' }]),
    ).toMatchObject({ code: 'reason_missing' });
  });

  it('refuses a line over what the claim took, a line not on the claim, and a repeated line', () => {
    expect(
      scheduleFromLines(lines, NET, [{ sovItemId: 'a', scheduledAmount: 2_000_001 }]),
    ).toMatchObject({
      code: 'over_line',
    });
    expect(scheduleFromLines(lines, NET, [{ sovItemId: 'zzz', scheduledAmount: 1 }])).toEqual({
      code: 'unknown_line',
      key: 'zzz',
    });
    expect(
      scheduleFromLines(lines, NET, [
        { sovItemId: 'a', scheduledAmount: 2_000_000 },
        { sovItemId: 'a', scheduledAmount: 2_000_000 },
      ]),
    ).toEqual({ code: 'duplicate_line', key: 'a' });
  });
});
