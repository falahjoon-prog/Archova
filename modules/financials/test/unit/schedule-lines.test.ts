import { describe, expect, it } from 'vitest';
import { isScheduleLinesError, scheduleFromLines } from '../../src/domain/schedule-lines';

// Two lines claimed: $20,000 and $10,000, retention $1,500 (5%), so the claim's net is $28,500.00.
const lines = [
  { sovItemId: 'a', variationId: null, thisClaim: 2_000_000 },
  { sovItemId: null, variationId: 'v', thisClaim: 1_000_000 },
];
const NET = 2_850_000;
// 5% of the gross, no cap, nothing held before.
const opts = { claimNetCents: NET, retentionFor: (g: number) => Math.round(g * 0.05) };
const run = (input: Parameters<typeof scheduleFromLines>[1], o = opts) => {
  const r = scheduleFromLines(lines, input, o);
  if (isScheduleLinesError(r)) throw new Error(`expected a schedule, got ${r.code}`);
  return r;
};

describe('scheduleFromLines', () => {
  it('gives the claim net exactly when every line is scheduled in full, even if left out', () => {
    expect(run([])).toMatchObject({ scheduledNet: NET, withheldNet: 0 });
  });

  it('recalculates retention on what is scheduled and keeps each reduced line with its reason', () => {
    const r = run([
      { variationId: 'v', scheduledAmount: 400_000, reason: 'Panels not yet installed.' },
    ]);
    expect(r.scheduledGross).toBe(2_400_000);
    expect(r.retentionOnSchedule).toBe(120_000);
    expect(r.scheduledNet).toBe(2_280_000);
    expect(r.withheldNet).toBe(570_000);
    expect(r.lines.find((l) => l.variationId === 'v')).toMatchObject({
      claimedAmount: 1_000_000,
      scheduledAmount: 400_000,
      reason: 'Panels not yet installed.',
    });
  });

  it('uses the contract terms, not a proportion: a cap changes the answer', () => {
    const capped = {
      ...opts,
      retentionFor: (g: number) => Math.min(Math.round(g * 0.05), 100_000),
    };
    const r = run(
      [{ variationId: 'v', scheduledAmount: 0, reason: 'Not started on site.' }],
      capped,
    );
    expect(r.retentionOnSchedule).toBe(100_000);
    expect(r.scheduledNet).toBe(1_900_000);
  });

  it('takes deductions off after retention, each with its own reason', () => {
    const r = run([], {
      ...opts,
      deductions: [
        {
          description: 'Back-charge: site cleaning',
          amount: 50_000,
          reason: 'Cleaning done by us, invoice 114.',
        },
      ],
    } as typeof opts);
    expect(r.scheduledNet).toBe(NET - 50_000);
    expect(r.withheldNet).toBe(50_000);
    expect(r.deductions).toHaveLength(1);
  });

  it('refuses a deduction with no description, no amount or a thin reason', () => {
    const bad = (d: { description: string; amount: number; reason: string }) =>
      scheduleFromLines(lines, [], { ...opts, deductions: [d] });
    expect(bad({ description: '', amount: 100, reason: 'Long enough reason.' })).toEqual({
      code: 'deduction_invalid',
      index: 0,
    });
    expect(bad({ description: 'x', amount: 0, reason: 'Long enough reason.' })).toEqual({
      code: 'deduction_invalid',
      index: 0,
    });
    expect(bad({ description: 'x', amount: 100, reason: 'short' })).toEqual({
      code: 'deduction_invalid',
      index: 0,
    });
  });

  it('refuses deductions that take the schedule below nothing', () => {
    const r = scheduleFromLines(lines, [], {
      ...opts,
      deductions: [{ description: 'Set-off', amount: NET + 1, reason: 'A long enough reason.' }],
    });
    expect(r).toEqual({ code: 'deductions_exceed' });
  });

  it('refuses a reduced line with no reason, or a one-word reason', () => {
    for (const reason of [undefined, '', '   ', 'x', 'short']) {
      expect(
        scheduleFromLines(lines, [{ sovItemId: 'a', scheduledAmount: 1, reason }], opts),
      ).toEqual({ code: 'reason_missing', keys: ['a'] });
    }
  });

  it('needs no reason for a line scheduled in full', () => {
    expect(run([{ sovItemId: 'a', scheduledAmount: 2_000_000 }])).toMatchObject({ withheldNet: 0 });
  });

  it('refuses an amount above the claim, a negative amount, an unknown line and a repeated line', () => {
    expect(
      scheduleFromLines(lines, [{ sovItemId: 'a', scheduledAmount: 2_000_001 }], opts),
    ).toMatchObject({ code: 'over_line', key: 'a' });
    expect(
      scheduleFromLines(
        lines,
        [{ sovItemId: 'a', scheduledAmount: -1, reason: 'A long enough reason.' }],
        opts,
      ),
    ).toMatchObject({ code: 'over_line' });
    expect(scheduleFromLines(lines, [{ sovItemId: 'zz', scheduledAmount: 1 }], opts)).toEqual({
      code: 'unknown_line',
      key: 'zz',
    });
    expect(
      scheduleFromLines(
        lines,
        [
          { sovItemId: 'a', scheduledAmount: 1, reason: 'A long enough reason.' },
          { sovItemId: 'a', scheduledAmount: 2, reason: 'A long enough reason.' },
        ],
        opts,
      ),
    ).toEqual({ code: 'duplicate_line', key: 'a' });
  });

  it('cannot reduce a line with nothing or less than nothing on it: it is scheduled as claimed', () => {
    const odd = [
      { sovItemId: 'a', variationId: null, thisClaim: 1_000_000 },
      { sovItemId: 'd', variationId: null, thisClaim: -200_000 },
      { sovItemId: 'z', variationId: null, thisClaim: 0 },
    ];
    const r = scheduleFromLines(
      odd,
      [
        { sovItemId: 'd', scheduledAmount: 0 },
        { sovItemId: 'z', scheduledAmount: 0 },
      ],
      {
        claimNetCents: 760_000,
        retentionFor: (g) => Math.round(g * 0.05),
      },
    );
    if (isScheduleLinesError(r)) throw new Error(r.code);
    expect(r.lines.find((l) => l.sovItemId === 'd')?.scheduledAmount).toBe(-200_000);
    expect(r.scheduledNet).toBe(760_000);
  });
});
