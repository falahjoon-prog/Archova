import { describe, expect, it } from 'vitest';
import { actorsFor, canSeeDefect, permissionFor, resolveTransition } from '../../src/domain/defect';

const builder = { userId: 'u1', companyId: 'own', isInternal: true };
const sub = { userId: 'u2', companyId: 'sparky', isInternal: false };
const other = { userId: 'u3', companyId: 'tiler', isInternal: false };
const client = { userId: 'u4', companyId: 'client', isInternal: false };

const defect = (status: 'draft' | 'open', over = {}) => ({
  status,
  assigneeCompanyId: 'sparky',
  raisedByCompanyId: 'own',
  createdBy: 'u1',
  ...over,
});

describe('canSeeDefect (DEF-AC9)', () => {
  it('shows builder staff everything', () => {
    expect(canSeeDefect(defect('draft'), builder)).toBe(true);
  });
  it('shows a subcontractor only open defects assigned to their company', () => {
    expect(canSeeDefect(defect('open'), sub)).toBe(true);
    expect(canSeeDefect(defect('open'), other)).toBe(false);
    expect(canSeeDefect(defect('draft'), sub)).toBe(false);
  });
  it('shows a client what they raised, drafts included only to the author', () => {
    const raised = defect('open', { raisedByCompanyId: 'client', createdBy: 'u4' });
    expect(canSeeDefect(raised, client)).toBe(true);
    expect(canSeeDefect({ ...raised, status: 'draft' as const }, client)).toBe(true);
    expect(canSeeDefect({ ...raised, status: 'draft' as const, createdBy: 'x' }, client)).toBe(
      false,
    );
  });
});

describe('resolveTransition', () => {
  const open = { status: 'open' as const, assigneeCompanyId: 'sparky' };
  it('lets the assigned company, not the builder, mark ready for review', () => {
    expect(resolveTransition(open, sub, { action: 'markReadyForReview', photoCount: 1 })).toEqual({
      ok: true,
      to: 'ready_for_review',
    });
    expect(
      resolveTransition(open, builder, { action: 'markReadyForReview', photoCount: 1 }),
    ).toEqual({
      ok: false,
      code: 'defect.not_allowed',
    });
  });
  it('lets a builder crew assigned their own defect act on both sides', () => {
    const crew = { userId: 'u1', companyId: 'own', isInternal: true };
    const mine = { status: 'open' as const, assigneeCompanyId: 'own' };
    expect(actorsFor(mine, crew)).toEqual(['builder', 'assignee']);
    expect(resolveTransition(mine, crew, { action: 'close' }).ok).toBe(true);
    expect(resolveTransition(mine, crew, { action: 'markReadyForReview', photoCount: 1 }).ok).toBe(
      true,
    );
  });
  it('keeps the most useful refusal across sides', () => {
    const mine = { status: 'open' as const, assigneeCompanyId: 'own' };
    const crew = { userId: 'u1', companyId: 'own', isInternal: true };
    expect(resolveTransition(mine, crew, { action: 'dispute' })).toEqual({
      ok: false,
      code: 'defect.reason_required',
    });
  });
  it('refuses an outsider', () => {
    expect(resolveTransition(open, other, { action: 'dispute', reason: 'x' })).toEqual({
      ok: false,
      code: 'defect.not_allowed',
    });
  });
});

describe('permissionFor', () => {
  it('maps actions to the permission that gates them (DEF-AC6)', () => {
    expect(permissionFor('issue')).toBe('defects.defects.create');
    expect(permissionFor('markReadyForReview')).toBe('defects.defects.respond');
    expect(permissionFor('dispute')).toBe('defects.defects.respond');
    for (const a of ['close', 'reject', 'reassign', 'void'] as const)
      expect(permissionFor(a)).toBe('defects.defects.close');
  });
});

describe('punch list roles', () => {
  const open = (over = {}) => ({
    status: 'ready_for_review' as const,
    assigneeCompanyId: 'sparky',
    ...over,
  });

  it('lets only the named final approver close, reject or reopen', () => {
    const approver = { userId: 'u9', companyId: 'client', isInternal: false };
    const withApprover = open({ finalApproverUserId: 'u9' });
    expect(resolveTransition(withApprover, builder, { action: 'close' }).ok).toBe(false);
    expect(resolveTransition(withApprover, approver, { action: 'close' })).toEqual({
      ok: true,
      to: 'closed',
    });
    expect(
      resolveTransition(withApprover, approver, { action: 'reject', reason: 'still chipped' }).ok,
    ).toBe(true);
  });

  it('keeps builder-side close when no approver is named', () => {
    expect(resolveTransition(open(), builder, { action: 'close' }).ok).toBe(true);
  });

  it('reopens a closed defect with a reason', () => {
    const closed = { status: 'closed' as const, assigneeCompanyId: 'sparky' };
    expect(resolveTransition(closed, builder, { action: 'reopen' })).toEqual({
      ok: false,
      code: 'defect.reason_required',
    });
    expect(
      resolveTransition(closed, builder, { action: 'reopen', reason: 'crack came back' }),
    ).toEqual({ ok: true, to: 'open' });
    expect(resolveTransition(closed, sub, { action: 'reopen', reason: 'x' }).ok).toBe(false);
  });

  it('shows a named person the item whatever their company', () => {
    const d = defect('open', { distributionUserIds: ['u3'], managerUserId: 'u4' });
    expect(canSeeDefect(d, other)).toBe(true);
    expect(canSeeDefect(d, client)).toBe(true);
    expect(canSeeDefect(defect('open'), other)).toBe(false);
  });
});

describe('stand-in approver', () => {
  const ready = {
    status: 'ready_for_review' as const,
    assigneeCompanyId: 'sparky',
    finalApproverUserId: 'u9',
    approverDelegateUserId: 'u8',
    approverDelegateFrom: '2026-11-10',
    approverDelegateUntil: '2026-11-14',
  };
  const deputy = { userId: 'u8', companyId: 'client', isInternal: false };

  it('gives the stand-in the builder side only inside their dates', () => {
    expect(actorsFor(ready, deputy, '2026-11-12')).toEqual(['builder']);
    expect(actorsFor(ready, deputy, '2026-11-20')).toEqual([]);
    expect(resolveTransition(ready, deputy, { action: 'close' }, '2026-11-12')).toEqual({
      ok: true,
      to: 'closed',
    });
    expect(resolveTransition(ready, deputy, { action: 'close' }, '2026-11-20').ok).toBe(false);
  });

  it('applies the evidence rule from the defect', () => {
    const d = { ...ready, requireCloseEvidence: true };
    expect(resolveTransition(d, deputy, { action: 'close' }, '2026-11-12')).toEqual({
      ok: false,
      code: 'defect.evidence_required',
    });
    expect(
      resolveTransition(d, deputy, { action: 'close', reason: 'checked on site' }, '2026-11-12').ok,
    ).toBe(true);
  });
});
