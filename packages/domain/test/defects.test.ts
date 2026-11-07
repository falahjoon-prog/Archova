import { describe, expect, it } from 'vitest';
import {
  availableDefectActions,
  defectApproverRule,
  defectLabel,
  defectTransition,
  hasDefectLocation,
} from '../src';

describe('defect lifecycle', () => {
  it('walks the happy path', () => {
    expect(defectTransition({ status: 'draft', action: 'issue', actor: 'builder' })).toEqual({
      ok: true,
      to: 'open',
    });
    expect(
      defectTransition({
        status: 'open',
        action: 'markReadyForReview',
        actor: 'assignee',
        photoCount: 1,
      }),
    ).toEqual({ ok: true, to: 'ready_for_review' });
    expect(
      defectTransition({ status: 'ready_for_review', action: 'close', actor: 'builder' }),
    ).toEqual({ ok: true, to: 'closed' });
  });

  it('needs an after photo for ready for review unless the project turned it off', () => {
    const base = { status: 'open', action: 'markReadyForReview', actor: 'assignee' } as const;
    expect(defectTransition(base)).toEqual({ ok: false, code: 'defect.photo_required' });
    expect(defectTransition({ ...base, requirePhotoForReady: false })).toMatchObject({ ok: true });
  });

  it('needs a reason to reject, dispute or void', () => {
    expect(
      defectTransition({
        status: 'ready_for_review',
        action: 'reject',
        actor: 'builder',
        reason: ' ',
      }),
    ).toEqual({ ok: false, code: 'defect.reason_required' });
    expect(
      defectTransition({
        status: 'ready_for_review',
        action: 'reject',
        actor: 'builder',
        reason: 'Grout still cracked',
      }),
    ).toEqual({ ok: true, to: 'open' });
    expect(defectTransition({ status: 'open', action: 'dispute', actor: 'assignee' })).toEqual({
      ok: false,
      code: 'defect.reason_required',
    });
  });

  it('keeps each side to its own actions and refuses impossible moves', () => {
    expect(
      defectTransition({ status: 'ready_for_review', action: 'close', actor: 'assignee' }),
    ).toEqual({ ok: false, code: 'defect.not_allowed' });
    expect(
      defectTransition({ status: 'closed', action: 'void', actor: 'builder', reason: 'x' }),
    ).toEqual({
      ok: false,
      code: 'defect.invalid_transition',
    });
    expect(availableDefectActions('open', 'assignee')).toEqual(['markReadyForReview', 'dispute']);
    expect(availableDefectActions('ready_for_review', 'builder')).toEqual([
      'close',
      'reject',
      'void',
    ]);
    expect(availableDefectActions('closed', 'builder')).toEqual(['reopen']);
  });

  it('requires a pin or a location', () => {
    expect(hasDefectLocation({ sheetId: 's', pinX: 0.2, pinY: 0.9 })).toBe(true);
    expect(hasDefectLocation({ sheetId: 's', pinX: 1.2, pinY: 0.9 })).toBe(false);
    expect(hasDefectLocation({ locationId: 'loc' })).toBe(true);
    expect(hasDefectLocation({})).toBe(false);
  });

  it('labels numbered and local defects', () => {
    expect(defectLabel(42)).toBe('DEF-0042');
    expect(defectLabel(null)).toBe('D-local');
  });
});

describe('reopen and the final approver', () => {
  it('reopens only a closed defect, on the builder side, with a reason', () => {
    expect(
      defectTransition({ status: 'closed', action: 'reopen', actor: 'builder', reason: 'again' }),
    ).toEqual({ ok: true, to: 'open' });
    expect(
      defectTransition({ status: 'open', action: 'reopen', actor: 'builder', reason: 'x' }),
    ).toEqual({ ok: false, code: 'defect.invalid_transition' });
    expect(
      defectTransition({ status: 'closed', action: 'reopen', actor: 'assignee', reason: 'x' }),
    ).toEqual({ ok: false, code: 'defect.not_allowed' });
  });

  it('restricts close, reject and reopen to the named approver', () => {
    expect(defectApproverRule({ finalApproverUserId: 'a' }, 'close', 'b')).toBe(false);
    expect(defectApproverRule({ finalApproverUserId: 'a' }, 'close', 'a')).toBe(true);
    expect(defectApproverRule({ finalApproverUserId: 'a' }, 'issue', 'b')).toBe(true);
    expect(defectApproverRule({}, 'close', 'b')).toBe(true);
  });
});

describe('stand-in approver and close evidence', () => {
  const d = {
    finalApproverUserId: 'boss',
    approverDelegateUserId: 'deputy',
    approverDelegateFrom: '2026-11-10',
    approverDelegateUntil: '2026-11-14',
  };
  it('lets the stand-in act only inside their dates', () => {
    expect(defectApproverRule(d, 'close', 'deputy', '2026-11-09')).toBe(false);
    expect(defectApproverRule(d, 'close', 'deputy', '2026-11-10')).toBe(true);
    expect(defectApproverRule(d, 'reopen', 'deputy', '2026-11-14')).toBe(true);
    expect(defectApproverRule(d, 'close', 'deputy', '2026-11-15')).toBe(false);
    expect(defectApproverRule(d, 'close', 'boss', '2026-11-09')).toBe(true);
    expect(defectApproverRule(d, 'close', 'deputy')).toBe(false);
  });

  it('needs a note or photo to close when the defect asks for evidence', () => {
    const base = {
      status: 'ready_for_review' as const,
      action: 'close' as const,
      actor: 'builder' as const,
      requireCloseEvidence: true,
    };
    expect(defectTransition(base)).toEqual({ ok: false, code: 'defect.evidence_required' });
    expect(defectTransition({ ...base, reason: 'Re-grouted' })).toEqual({ ok: true, to: 'closed' });
    expect(defectTransition({ ...base, photoCount: 1 })).toEqual({ ok: true, to: 'closed' });
  });
});
