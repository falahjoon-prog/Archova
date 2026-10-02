import { describe, expect, it } from 'vitest';
import { defaultEotCandidate, diaryChangeProblem, isDiaryHours, isHeadcount } from '../src';

describe('diary rules', () => {
  it('ticks possible EOT for weather, client, design and authority delays', () => {
    expect(defaultEotCandidate('weather')).toBe(true);
    expect(defaultEotCandidate('authority')).toBe(true);
    expect(defaultEotCandidate('subcontractor')).toBe(false);
    expect(defaultEotCandidate('industrial')).toBe(false);
  });

  it('validates hours and headcount', () => {
    expect(isDiaryHours(7.5)).toBe(true);
    expect(isDiaryHours(7.6)).toBe(false);
    expect(isDiaryHours(25)).toBe(false);
    expect(isHeadcount(6)).toBe(true);
    expect(isHeadcount(0)).toBe(false);
    expect(isHeadcount(2.5)).toBe(false);
  });

  it('needs a reason to change a submitted day', () => {
    expect(diaryChangeProblem('draft', null)).toBeNull();
    expect(diaryChangeProblem('submitted', ' ')).toBe('diary.amendment_reason_required');
    expect(diaryChangeProblem('signed_off', 'Wrong crew count')).toBeNull();
  });
});
