import { describe, expect, it } from 'vitest';
import { daysLate, isLate, programmeStatus } from '../../src/domain/programme';

const a = (start: string, finish: string, pctComplete: number) => ({ start, finish, pctComplete });

describe('isLate', () => {
  it('is late when it should have started and has not, or should have finished and has not', () => {
    expect(isLate(a('2026-11-01', '2026-11-20', 0), '2026-11-05')).toBe(true);
    expect(isLate(a('2026-10-01', '2026-11-01', 60), '2026-11-05')).toBe(true);
  });
  it('is not late when on track, not yet due, or complete', () => {
    expect(isLate(a('2026-10-01', '2026-11-20', 40), '2026-11-05')).toBe(false);
    expect(isLate(a('2026-11-10', '2026-11-20', 0), '2026-11-05')).toBe(false);
    expect(isLate(a('2026-10-01', '2026-11-01', 100), '2026-11-05')).toBe(false);
  });
});

describe('daysLate', () => {
  it('counts from the finish date, or the start date when work has not begun', () => {
    expect(daysLate(a('2026-10-01', '2026-11-01', 60), '2026-11-05')).toBe(4);
    expect(daysLate(a('2026-11-01', '2026-11-20', 0), '2026-11-05')).toBe(4);
  });
  it('is zero when not late or complete', () => {
    expect(daysLate(a('2026-10-01', '2026-11-20', 40), '2026-11-05')).toBe(0);
    expect(daysLate(a('2026-10-01', '2026-11-01', 100), '2026-11-05')).toBe(0);
  });
});

describe('programmeStatus', () => {
  it('maps percent complete to a status', () => {
    expect(programmeStatus(0)).toBe('not_started');
    expect(programmeStatus(40)).toBe('in_progress');
    expect(programmeStatus(100)).toBe('complete');
  });
});
