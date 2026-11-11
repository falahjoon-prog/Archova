import { describe, expect, it } from 'vitest';
import {
  availableConditionActions,
  conditionLabel,
  conditionTransition,
  isConditionOverdue,
  nextDueDate,
} from '../../src/domain/condition';
import { expiryState } from '../../src/domain/document';
import { environmentFlags } from '../../src/domain/flags';
import { STARTER_CONDITIONS } from '../../src/domain/starter-pack';

describe('condition transitions', () => {
  it('moves through start and sign-off', () => {
    expect(conditionTransition('not_started', 'start', 'once', null)).toEqual({
      ok: true,
      to: 'in_progress',
    });
    expect(conditionTransition('in_progress', 'signOff', 'once', null)).toEqual({
      ok: true,
      to: 'compliant',
    });
  });

  it('lets a recurring condition be signed off again, but not a one-off', () => {
    expect(conditionTransition('compliant', 'signOff', 'weekly', null).ok).toBe(true);
    expect(conditionTransition('compliant', 'signOff', 'once', null).ok).toBe(false);
  });

  it('needs a reason to flag, exempt or reopen', () => {
    for (const a of ['flagNonCompliant', 'markNotApplicable', 'reopen'] as const) {
      const from = a === 'reopen' ? 'compliant' : 'in_progress';
      expect(conditionTransition(from, a, 'once', ' ')).toEqual({
        ok: false,
        code: 'environment.reason_required',
      });
      expect(conditionTransition(from, a, 'once', 'because').ok).toBe(true);
    }
  });

  it('can clear a breach by signing off again', () => {
    expect(conditionTransition('non_compliant', 'signOff', 'once', null)).toEqual({
      ok: true,
      to: 'compliant',
    });
  });

  it('does not flag a condition that is not applicable or already flagged', () => {
    expect(conditionTransition('not_applicable', 'flagNonCompliant', 'once', 'x').ok).toBe(false);
    expect(conditionTransition('non_compliant', 'flagNonCompliant', 'once', 'x').ok).toBe(false);
  });
});

describe('scheduling', () => {
  it('rolls a recurring condition to its next due date', () => {
    expect(nextDueDate('daily', '2026-11-07')).toBe('2026-11-08');
    expect(nextDueDate('weekly', '2026-11-07')).toBe('2026-11-14');
    expect(nextDueDate('quarterly', '2026-11-07')).toBe('2027-02-06');
  });

  it('leaves one-off and per-event conditions unscheduled', () => {
    expect(nextDueDate('once', '2026-11-07')).toBeNull();
    expect(nextDueDate('per_event', '2026-11-07')).toBeNull();
  });

  it('is overdue only after the due date and never when not applicable', () => {
    const today = '2026-11-07';
    expect(isConditionOverdue({ status: 'in_progress', dueDate: '2026-11-06' }, today)).toBe(true);
    expect(isConditionOverdue({ status: 'in_progress', dueDate: today }, today)).toBe(false);
    expect(isConditionOverdue({ status: 'not_applicable', dueDate: '2026-01-01' }, today)).toBe(
      false,
    );
    expect(isConditionOverdue({ status: 'compliant', dueDate: null }, today)).toBe(false);
  });
});

describe('available actions', () => {
  it('gives the site team start and flag, and the accountable person sign-off', () => {
    const site = { update: true, signOff: false };
    const officer = { update: true, signOff: true };
    const c = { status: 'in_progress', frequency: 'weekly' } as const;
    expect(availableConditionActions(c, site)).toEqual(['flagNonCompliant']);
    expect(availableConditionActions(c, officer)).toEqual([
      'signOff',
      'flagNonCompliant',
      'markNotApplicable',
    ]);
    expect(availableConditionActions(c, { update: false, signOff: false })).toEqual([]);
  });
});

describe('labels and expiry', () => {
  it('pads the condition number', () => expect(conditionLabel(7)).toBe('EMC-0007'));

  it('classifies document expiry', () => {
    const today = '2026-11-07';
    expect(expiryState(null, today)).toBe('none');
    expect(expiryState('2026-11-06', today)).toBe('expired');
    expect(expiryState('2026-11-20', today)).toBe('expiring');
    expect(expiryState('2027-03-01', today)).toBe('valid');
  });
});

describe('flags', () => {
  const base = {
    today: '2026-11-07',
    plan: { status: 'active' as const, nextReviewDate: '2027-05-07' },
    conditions: [],
    documents: [],
  };

  it('is quiet when everything is current', () => {
    expect(environmentFlags(base)).toEqual([]);
  });

  it('flags a missing plan and an unapproved one', () => {
    expect(environmentFlags({ ...base, plan: null }).map((f) => f.code)).toEqual(['plan_missing']);
    expect(
      environmentFlags({ ...base, plan: { status: 'draft', nextReviewDate: null } }).map(
        (f) => f.code,
      ),
    ).toEqual(['plan_unapproved']);
  });

  it('flags breaches as critical and overdue sign-offs as warnings, each condition once', () => {
    const flags = environmentFlags({
      ...base,
      conditions: [
        { id: 'a', number: 1, status: 'non_compliant', dueDate: '2026-10-01' },
        { id: 'b', number: 2, status: 'in_progress', dueDate: '2026-11-01' },
        { id: 'c', number: 3, status: 'compliant', dueDate: '2026-12-01' },
      ],
    });
    expect(flags.map((f) => [f.code, f.severity, f.conditionIds])).toEqual([
      ['conditions_non_compliant', 'critical', ['a']],
      ['conditions_overdue', 'warning', ['b']],
    ]);
    expect(flags[0]!.message).toContain('EMC-0001');
  });

  it('flags expired and expiring documents and a plan review that has lapsed', () => {
    const flags = environmentFlags({
      ...base,
      plan: { status: 'active', nextReviewDate: '2026-11-01' },
      documents: [
        { id: 'd1', title: 'EPA licence', expiresOn: '2026-10-31' },
        { id: 'd2', title: 'Permit', expiresOn: '2026-11-25' },
      ],
    });
    expect(flags.map((f) => f.code)).toEqual([
      'documents_expired',
      'documents_expiring',
      'plan_review_due',
    ]);
    expect(flags[2]!.message).toContain('6 days');
  });
});

describe('starter pack', () => {
  it('has unique titles so applying it twice can skip what is there', () => {
    const titles = STARTER_CONDITIONS.map((c) => c.title.toLowerCase());
    expect(new Set(titles).size).toBe(titles.length);
    expect(STARTER_CONDITIONS.length).toBeGreaterThanOrEqual(10);
  });
});
