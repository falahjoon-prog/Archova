import { describe, expect, it } from 'vitest';
import {
  closeBlockers,
  hazardInsights,
  hazardLines,
  planWarnings,
  pretaskLabel,
  suggestHazards,
  type PretaskHazard,
} from '../../src/domain/pretask';

const h = (hazard: string, over: Partial<PretaskHazard> = {}): PretaskHazard => ({
  hazard,
  riskBefore: 'high',
  controls: 'Edge protection',
  riskAfter: 'low',
  ...over,
});
const signed = { signedAt: new Date() };

describe('pre-task plan rules', () => {
  it('numbers plans PTP-0001', () => expect(pretaskLabel(12)).toBe('PTP-0012'));

  it('needs a hazard, controls, a crew and every signature to close', () => {
    expect(closeBlockers([], [signed])[0]).toMatch(/at least one hazard/);
    expect(closeBlockers([h('Falls', { controls: ' ' })], [signed])[0]).toMatch(/control "Falls"/);
    expect(closeBlockers([h('Falls')], [])[0]).toMatch(/Add the people/);
    expect(closeBlockers([h('Falls')], [signed, { signedAt: null }])[0]).toMatch(/1 person has/);
    expect(closeBlockers([h('Falls')], [signed])).toEqual([]);
  });

  it('will not close with extreme risk left or a rating that got worse', () => {
    expect(closeBlockers([h('Trench', { riskAfter: 'extreme' })], [signed])[0]).toMatch(
      /Do not start/,
    );
    expect(
      closeBlockers([h('Dust', { riskBefore: 'low', riskAfter: 'medium' })], [signed])[0],
    ).toMatch(/higher risk after/);
  });

  it('warns about SWMS state and each crew member, never blocking', () => {
    const w = planWarnings({
      swms: { number: 3, status: 'submitted', expired: false },
      crew: [
        { personName: 'Sam', inductionStatus: 'needs_reinduction', swmsRead: false },
        { personName: 'Lee', inductionStatus: 'current', swmsRead: true },
        { personName: 'Kim', inductionStatus: 'unknown', swmsRead: null },
      ],
    });
    expect(w.map((x) => x.code)).toEqual(['swms_not_accepted', 'induction', 'swms_not_read']);
    expect(w[1]!.message).toMatch(/Sam .*redo the site induction/);
    expect(
      planWarnings({ swms: { number: 3, status: 'accepted', expired: true }, crew: [] })[0]!.code,
    ).toBe('swms_expired');
  });
});

describe('Nova hazard suggestions', () => {
  it('splits SWMS hazard text into lines', () => {
    expect(hazardLines('- Falls from the slab edge\n2) Dust; ok')).toEqual([
      'Falls from the slab edge',
      'Dust',
    ]);
  });

  it('puts hazards raised on two or more recent plans first, with the controls last used', () => {
    const s = suggestHazards({
      swms: { number: 2, hazardsAndRisks: 'Dust\nNoise', controls: ['Wet cutting', 'Ear muffs'] },
      recentPlans: [
        { workDate: '2026-11-18', hazards: [h('Slippery  ground!', { controls: 'Matting' })] },
        { workDate: '2026-11-17', hazards: [h('slippery ground', { controls: 'Old' })] },
        { workDate: '2026-11-16', hazards: [h('Once only')] },
      ],
      recentIncidentTypes: [{ type: 'near_miss', count: 2 }],
      current: [h('noise')],
    });
    expect(s.map((x) => [x.reason, x.hazard])).toEqual([
      ['recurring', 'Slippery  ground!'],
      ['from_swms', 'Dust'],
      ['recent_incident', 'Repeat of a recent near miss'],
    ]);
    expect(s[0]!.controls).toBe('Matting');
    expect(s[0]!.because).toMatch(/2 plans/);
    expect(s[1]!.controls).toBe('Wet cutting; Ear muffs');
  });
});

describe('hazard insights', () => {
  const plan = (
    companyId: string | null,
    workDate: string,
    hazards: PretaskHazard[],
    over: { status?: 'open' | 'closed'; reviewed?: boolean } = {},
  ) => ({
    companyId,
    status: over.status ?? 'closed',
    reviewed: over.reviewed ?? false,
    workDate,
    hazards,
    crewCount: 2,
    signedCount: 2,
  });

  it('counts hazards once per plan, ignoring case and punctuation, with the high-risk share', () => {
    const i = hazardInsights([
      plan('c1', '2026-11-18', [h('Wet ground!'), h('Noise', { riskBefore: 'low' })]),
      plan('c2', '2026-11-19', [h('wet ground'), h('wet  ground')], { reviewed: true }),
      plan(null, '2026-11-17', [h('Noise', { riskBefore: 'low' })], { status: 'open' }),
    ]);
    expect(i).toMatchObject({ plans: 3, closed: 2, reviewed: 1, toReview: 1 });
    expect(i.topHazards[0]).toEqual({
      hazard: 'Wet ground!',
      plans: 2,
      highRiskPlans: 2,
      lastSeen: '2026-11-19',
      companyIds: ['c1', 'c2'],
    });
    expect(i.topHazards[1]).toMatchObject({ hazard: 'Noise', plans: 2, highRiskPlans: 0 });
    expect(i.byCompany.map((c) => [c.companyId, c.plans, c.highRiskHazards])).toEqual([
      ['c1', 1, 1],
      ['c2', 1, 1],
      [null, 1, 0],
    ]);
  });
});
