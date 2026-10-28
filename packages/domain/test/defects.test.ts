import { describe, expect, it } from 'vitest';
import { availableDefectActions, defectLabel, defectTransition, hasDefectLocation } from '../src';

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
    expect(availableDefectActions('closed', 'builder')).toEqual([]);
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
