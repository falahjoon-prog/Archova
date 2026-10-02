import { describe, expect, it } from 'vitest';
import {
  ballInCourt,
  canSeeRfi,
  formatRfiNumber,
  missingToOpen,
  nextStatus,
  type RfiAudience,
} from '../../src/domain/rfi';

describe('RFI lifecycle', () => {
  it.each([
    ['draft', 'open', 'open'],
    ['open', 'answer', 'answered'],
    ['answered', 'answer', 'answered'],
    ['answered', 'close', 'closed'],
    ['closed', 'reopen', 'open'],
    ['open', 'void', 'void'],
    ['answered', 'void', 'void'],
    ['draft', 'close', null],
    ['open', 'close', null],
    ['void', 'reopen', null],
    ['closed', 'void', null],
    ['closed', 'edit', null],
  ] as const)('%s --%s--> %s', (from, action, to) => {
    expect(nextStatus(from, action)).toBe(to);
  });

  it('lists what is missing before an RFI can be sent', () => {
    expect(
      missingToOpen({ subject: 'Slab edge', questionText: ' ', assigneeCount: 0, dueDate: null }),
    ).toEqual(['question', 'assigneeIds', 'dueDate']);
  });

  it('puts the ball with assignees while open and the builder once answered', () => {
    const r = { managerId: 'pm', assigneeIds: ['eng'] };
    expect(ballInCourt('open', r)).toEqual({ side: 'assignees', userIds: ['eng'] });
    expect(ballInCourt('answered', r)).toEqual({ side: 'builder', userIds: ['pm'] });
    expect(ballInCourt('closed', r).side).toBeNull();
  });

  it('formats numbers', () => {
    expect(formatRfiNumber(7)).toBe('RFI-007');
    expect(formatRfiNumber(1234)).toBe('RFI-1234');
  });
});

describe('canSeeRfi (RFI-AC9)', () => {
  const base: RfiAudience = {
    status: 'open',
    isPrivate: false,
    createdBy: 'pm',
    raisedByCompanyId: 'builder',
    distributionUserIds: [],
    distributionCompanyIds: ['sparky'],
    assigneeUserIds: ['eng'],
    assigneeCompanyIds: ['engco'],
  };
  const sub = { userId: 'sub1', companyId: 'sparky', isInternal: false };
  const plumber = { userId: 'p1', companyId: 'plumbco', isInternal: false };
  const engMate = { userId: 'eng2', companyId: 'engco', isInternal: false };

  it('shows distributed and assigned RFIs to external companies', () => {
    expect(canSeeRfi(base, sub)).toBe(true);
    expect(canSeeRfi(base, engMate)).toBe(true);
    expect(canSeeRfi(base, plumber)).toBe(false);
  });

  it('keeps private RFIs and other companies drafts away from externals', () => {
    expect(canSeeRfi({ ...base, isPrivate: true }, sub)).toBe(false);
    expect(canSeeRfi({ ...base, status: 'draft' }, sub)).toBe(false);
    expect(
      canSeeRfi({ ...base, status: 'draft', createdBy: 'sub2', raisedByCompanyId: 'sparky' }, sub),
    ).toBe(true);
  });

  it('shows everything to builder staff', () => {
    expect(
      canSeeRfi({ ...base, isPrivate: true }, { userId: 'x', companyId: null, isInternal: true }),
    ).toBe(true);
  });
});
