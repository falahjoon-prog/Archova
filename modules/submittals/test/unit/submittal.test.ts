import { describe, expect, it } from 'vitest';
import {
  applyResponse,
  ballInCourt,
  canSeeSubmittal,
  computeSubmitBy,
  defaultNumberLabel,
  stepDueDates,
  submitByState,
  worstStatus,
  type StepState,
} from '../../src/domain/submittal';

describe('computeSubmitBy (SUB-AC2)', () => {
  it('counts lead time plus review time back in business days', () => {
    // Fri 2026-11-27 minus 15 business days (5 lead + 10 review) = Fri 2026-11-06.
    expect(computeSubmitBy('2026-11-27', 5, 10)).toBe('2026-11-06');
  });
  it('skips weekends', () => {
    // Mon 2026-11-02 minus 1 business day is the Friday before.
    expect(computeSubmitBy('2026-11-02', 0, 1)).toBe('2026-10-30');
  });
  it('is null without a required-on-site date', () => {
    expect(computeSubmitBy(null, 5, 10)).toBeNull();
  });
});

describe('submitByState', () => {
  const base = { status: 'draft', submitBy: '2026-11-06', requiredOnSite: '2026-11-27' } as const;
  it('is ok until the date passes, amber after, red five business days later', () => {
    expect(submitByState(base, '2026-11-06')).toBe('ok');
    expect(submitByState(base, '2026-11-09')).toBe('amber');
    expect(submitByState(base, '2026-11-12')).toBe('amber');
    expect(submitByState(base, '2026-11-13')).toBe('red');
  });
  it('goes red once required on site has passed and it is not approved', () => {
    expect(submitByState({ ...base, status: 'in_review' }, '2026-11-28')).toBe('red');
  });
  it('does not flag a submitted item before then, or an approved one ever', () => {
    expect(submitByState({ ...base, status: 'submitted' }, '2026-11-20')).toBe('ok');
    expect(submitByState({ ...base, status: 'approved' }, '2027-01-01')).toBe('none');
  });
});

describe('applyResponse (SUB-AC3, AC4)', () => {
  const path = (...responses: StepState['response'][]): StepState[] =>
    responses.map((response, i) => ({
      step: i + 1,
      kind: i === 0 ? 'builder' : 'consultant',
      response,
    }));

  it('lets the builder forward to the first consultant', () => {
    expect(applyResponse(path('pending', 'pending', 'pending'), 1, 'forwarded')).toEqual({
      kind: 'advance',
      nextStep: 2,
    });
  });
  it('refuses to forward with nobody after, and a consultant forwarding', () => {
    expect(applyResponse(path('pending'), 1, 'forwarded')).toHaveProperty('error');
    expect(applyResponse(path('forwarded', 'pending', 'pending'), 2, 'forwarded')).toHaveProperty(
      'error',
    );
  });
  it('makes the builder forward rather than approve when consultants remain', () => {
    expect(applyResponse(path('pending', 'pending'), 1, 'approved')).toHaveProperty('error');
  });
  it('lets the builder return a status that ends the review', () => {
    expect(applyResponse(path('pending', 'pending'), 1, 'revise_resubmit')).toEqual({
      kind: 'return',
      status: 'revise_resubmit',
    });
    expect(applyResponse(path('pending'), 1, 'approved')).toEqual({
      kind: 'return',
      status: 'approved',
    });
  });
  it('passes an approval on to the next consultant and ends on the last', () => {
    expect(applyResponse(path('forwarded', 'pending', 'pending'), 2, 'approved')).toEqual({
      kind: 'advance',
      nextStep: 3,
    });
    expect(applyResponse(path('forwarded', 'approved_as_noted', 'pending'), 3, 'approved')).toEqual(
      { kind: 'return', status: 'approved_as_noted' },
    );
  });
  it('ends the review at once when a consultant sends it back', () => {
    expect(applyResponse(path('forwarded', 'pending', 'pending'), 2, 'rejected')).toEqual({
      kind: 'return',
      status: 'rejected',
    });
  });
  it('refuses a step that is not waiting', () => {
    expect(applyResponse(path('forwarded', 'pending'), 1, 'forwarded')).toHaveProperty('error');
    expect(applyResponse(path('pending'), 9, 'approved')).toHaveProperty('error');
    // Nor one that is still queued behind another.
    expect(applyResponse(path('forwarded', 'pending', 'pending'), 3, 'approved')).toHaveProperty(
      'error',
    );
  });
});

describe('worstStatus', () => {
  it('takes the most severe response', () => {
    expect(worstStatus(['approved', 'approved_as_noted'])).toBe('approved_as_noted');
    expect(worstStatus(['approved', 'rejected', 'revise_resubmit'])).toBe('rejected');
  });
});

describe('ballInCourt', () => {
  it('follows the status', () => {
    expect(ballInCourt('draft', null)).toBe('subcontractor');
    expect(ballInCourt('submitted', { kind: 'builder', approverId: 'u' })).toBe('builder');
    expect(ballInCourt('in_review', { kind: 'consultant', approverId: 'u' })).toBe('consultant');
    expect(ballInCourt('revise_resubmit', null)).toBe('subcontractor');
    expect(ballInCourt('approved', null)).toBeNull();
  });
});

describe('canSeeSubmittal', () => {
  const item = {
    status: 'in_review',
    createdBy: 'maker',
    responsibleCompanyId: 'sub-co',
    stepApproverIds: ['arch'],
  } as const;
  it('shows builder staff everything', () => {
    expect(
      canSeeSubmittal(
        { ...item, status: 'draft' },
        { userId: 'x', companyId: null, isInternal: true },
      ),
    ).toBe(true);
  });
  it('shows the responsible company and the reviewers, not other companies', () => {
    expect(canSeeSubmittal(item, { userId: 'y', companyId: 'sub-co', isInternal: false })).toBe(
      true,
    );
    expect(canSeeSubmittal(item, { userId: 'arch', companyId: 'arch-co', isInternal: false })).toBe(
      true,
    );
    expect(canSeeSubmittal(item, { userId: 'z', companyId: 'other', isInternal: false })).toBe(
      false,
    );
  });
  it('keeps a draft from reviewers until it is submitted', () => {
    expect(
      canSeeSubmittal(
        { ...item, status: 'draft' },
        { userId: 'arch', companyId: 'arch-co', isInternal: false },
      ),
    ).toBe(false);
  });
});

describe('numbering and step dates', () => {
  it('pads the default number', () => expect(defaultNumberLabel(14)).toBe('SD-014'));
  it('spreads the review time over the steps', () => {
    // Mon 2026-11-02, 10 business days, 2 steps → +5 and +10 business days.
    expect(stepDueDates('2026-11-02', 10, 2)).toEqual(['2026-11-09', '2026-11-16']);
  });
});
