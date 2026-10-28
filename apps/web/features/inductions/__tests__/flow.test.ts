import { describe, expect, it } from 'vitest';
import {
  furthestStep,
  isAuMobile,
  isReachable,
  maskMobile,
  paramsToStep,
  stepNumber,
  stepToParams,
  totalSteps,
} from '../worker/lib/flow';
import type { InductionProgress, WorkerInduction } from '../worker/lib/types';

const induction = {
  sectionCount: 2,
  sections: [
    { id: 's1', title: 'One', blocks: [] },
    { id: 's2', title: 'Two', blocks: [] },
  ],
} as unknown as WorkerInduction;

const progress = (over: Partial<InductionProgress> = {}): InductionProgress => ({
  verified: true,
  worker: null,
  returning: false,
  sections: {},
  quiz: { passed: false, attempts: 0 },
  credentials: [],
  completion: null,
  ...over,
});

describe('induction flow', () => {
  it('counts details, each section, quiz, tickets and declaration', () => {
    expect(totalSteps(induction)).toBe(6);
    expect(stepNumber({ kind: 'details' }, induction)).toBe(1);
    expect(stepNumber({ kind: 'section', index: 1 }, induction)).toBe(3);
    expect(stepNumber({ kind: 'declaration' }, induction)).toBe(6);
  });

  it('resumes at the first unfinished step and never lets a step be skipped (IND-AC4)', () => {
    expect(furthestStep(induction, progress({ verified: false }))).toEqual({ kind: 'details' });
    const p = progress({ sections: { s1: { complete: true } } });
    expect(furthestStep(induction, p)).toEqual({ kind: 'section', index: 1 });
    expect(isReachable({ kind: 'section', index: 0 }, induction, p)).toBe(true);
    expect(isReachable({ kind: 'quiz' }, induction, p)).toBe(false);
    expect(isReachable({ kind: 'done' }, induction, p)).toBe(false);

    const passed = progress({
      sections: { s1: { complete: true }, s2: { complete: true } },
      quiz: { passed: true, attempts: 1 },
    });
    expect(furthestStep(induction, passed)).toEqual({ kind: 'credentials' });
  });

  it('only shows the done screen once signed', () => {
    const done = progress({
      completion: {
        completedAt: '2026-10-02T01:00:00Z',
        version: 4,
      },
    });
    expect(isReachable({ kind: 'done' }, induction, done)).toBe(true);
    expect(isReachable({ kind: 'declaration' }, induction, done)).toBe(false);
  });

  it('round-trips steps through the URL', () => {
    expect(stepToParams({ kind: 'section', index: 1 })).toEqual({ step: 'section', n: '2' });
    expect(paramsToStep({ step: 'section', n: '2' }, induction)).toEqual({
      kind: 'section',
      index: 1,
    });
    expect(paramsToStep({ step: 'section', n: '9' }, induction)).toBeNull();
    expect(paramsToStep({ step: 'nope', n: '' }, induction)).toBeNull();
  });

  it('accepts Australian mobiles and masks all but the last three digits', () => {
    expect(isAuMobile('0412 345 678')).toBe(true);
    expect(isAuMobile('+61 412 345 678')).toBe(true);
    expect(isAuMobile('02 9000 0000')).toBe(false);
    expect(maskMobile('0412 345 678')).toBe('•••• ••• 678');
  });
});
