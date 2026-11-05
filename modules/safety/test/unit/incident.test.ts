import { describe, expect, it } from 'vitest';
import {
  checkNotifiable,
  closeBlockers,
  correctiveTransition,
  incidentLabel,
  incidentTransition,
  isOverdue,
  keepUntil,
  writtenNoticeDueAt,
} from '../../src/domain/incident';

const cause = {
  method: 'five_whys' as const,
  causes: ['No edge protection'],
  summary: 'Guard missing',
};

describe('regulator timings', () => {
  it('gives the written notice 48 hours from the request', () => {
    const at = new Date('2026-11-05T01:00:00Z');
    expect(writtenNoticeDueAt(at)?.toISOString()).toBe('2026-11-07T01:00:00.000Z');
    expect(writtenNoticeDueAt(null)).toBeNull();
  });
  it('keeps the record 5 years from notification', () => {
    expect(keepUntil(new Date('2026-11-05T01:00:00Z'))?.toISOString()).toBe(
      '2031-11-05T01:00:00.000Z',
    );
    expect(keepUntil(null)).toBeNull();
  });
});

describe('checkNotifiable', () => {
  it('needs a class when notifiable', () => {
    expect(checkNotifiable(true, null)).toMatchObject({ ok: false, field: 'notifiableClass' });
    expect(checkNotifiable(true, 'death')).toEqual({ ok: true });
  });
  it('rejects a class on a non-notifiable incident', () => {
    expect(checkNotifiable(false, 'death')).toMatchObject({ ok: false, field: 'isNotifiable' });
    expect(checkNotifiable(false, null)).toEqual({ ok: true });
  });
});

describe('incidentTransition', () => {
  it('moves reported to investigating to closed', () => {
    expect(incidentTransition('reported', 'investigate', null)).toEqual({
      ok: true,
      to: 'investigating',
    });
    expect(incidentTransition('investigating', 'close', null)).toEqual({ ok: true, to: 'closed' });
  });
  it('will not close straight from reported', () => {
    expect(incidentTransition('reported', 'close', null)).toEqual({
      ok: false,
      code: 'incident.invalid_transition',
    });
  });
  it('needs a reason to reopen', () => {
    expect(incidentTransition('closed', 'reopen', ' ')).toEqual({
      ok: false,
      code: 'incident.reason_required',
    });
    expect(incidentTransition('closed', 'reopen', 'New witness')).toEqual({
      ok: true,
      to: 'investigating',
    });
  });
});

describe('closeBlockers', () => {
  it('is empty when ready', () => {
    expect(
      closeBlockers({
        isNotifiable: true,
        regulatorNotifiedAt: new Date(),
        rootCause: cause,
        actions: [{ status: 'verified' }],
      }),
    ).toEqual([]);
  });
  it('lists every thing missing', () => {
    expect(
      closeBlockers({
        isNotifiable: true,
        regulatorNotifiedAt: null,
        rootCause: null,
        actions: [{ status: 'open' }, { status: 'done' }],
      }).map((b) => b.field),
    ).toEqual(['rootCause', 'regulatorNotifiedAt', 'actions']);
  });
  it('treats blank causes as missing', () => {
    expect(
      closeBlockers({
        isNotifiable: false,
        regulatorNotifiedAt: null,
        rootCause: { ...cause, causes: [' '] },
        actions: [],
      }).map((b) => b.field),
    ).toEqual(['rootCause']);
  });
});

describe('corrective actions', () => {
  it('goes open, done, verified, and back from done', () => {
    expect(correctiveTransition('open', 'done')).toBe(true);
    expect(correctiveTransition('done', 'verified')).toBe(true);
    expect(correctiveTransition('done', 'open')).toBe(true);
    expect(correctiveTransition('open', 'verified')).toBe(false);
    expect(correctiveTransition('verified', 'open')).toBe(false);
  });
  it('is overdue only until verified', () => {
    expect(isOverdue('2026-11-01', 'open', '2026-11-05')).toBe(true);
    expect(isOverdue('2026-11-01', 'verified', '2026-11-05')).toBe(false);
    expect(isOverdue(null, 'open', '2026-11-05')).toBe(false);
    expect(isOverdue('2026-11-05', 'open', '2026-11-05')).toBe(false);
  });
  it('numbers incidents INC-0001', () => {
    expect(incidentLabel(7)).toBe('INC-0007');
  });
});
