import { describe, expect, it } from 'vitest';
import {
  HRCW_CATEGORIES,
  isExpired,
  swmsAdvisories,
  swmsGaps,
  swmsTransition,
  type SwmsContent,
} from '../../src/domain/swms';

const complete: SwmsContent = {
  hazardsAndRisks: 'Fall from the edge of level 3',
  controlMeasures: [{ level: 'engineer', description: 'Edge protection' }],
  implementation: 'Supervisor checks the edge protection each morning and after wind.',
  siteSpecific: 'Level 3 slab edge, crane on the north side.',
};

describe('swmsGaps (compliance 03 §3)', () => {
  it('is empty when every required item is present', () => {
    expect(swmsGaps(['fall_2m'], complete)).toEqual([]);
  });
  it('lists what is missing, by item', () => {
    expect(swmsGaps([], {}).map((g) => g.item)).toEqual([1, 2, 3, 4, 5]);
  });
  it('ignores controls with no description', () => {
    expect(
      swmsGaps(['fall_2m'], {
        ...complete,
        controlMeasures: [{ level: 'ppe', description: ' ' }],
      }).map((g) => g.item),
    ).toEqual([3]);
  });
  it('wants the WHS plan only when it applies', () => {
    expect(swmsGaps(['fall_2m'], { ...complete, whsPlanApplies: true }).map((g) => g.item)).toEqual(
      [6],
    );
    expect(
      swmsGaps(['fall_2m'], {
        ...complete,
        whsPlanApplies: true,
        whsPlanConsidered: 'See WHSMP s4',
      }),
    ).toEqual([]);
  });
  it('wants every control considered when a fall over 2 m has only admin or PPE controls', () => {
    const weak = {
      ...complete,
      controlMeasures: [{ level: 'ppe' as const, description: 'Harness' }],
    };
    expect(swmsGaps(['fall_2m'], weak).map((g) => g.item)).toEqual([8]);
    expect(swmsGaps(['mobile_plant'], weak)).toEqual([]);
    expect(
      swmsGaps(['fall_2m'], {
        ...weak,
        fallControlsConsidered: 'Scaffold: not practicable, roof pitch',
      }),
    ).toEqual([]);
  });
  it('knows 19 categories', () => {
    expect(HRCW_CATEGORIES).toHaveLength(19);
  });
});

describe('swmsAdvisories', () => {
  it('flags administrative and PPE only controls', () => {
    const codes = swmsAdvisories([], {
      ...complete,
      controlMeasures: [{ level: 'ppe', description: 'Use appropriate PPE' }],
    }).map((a) => a.code);
    expect(codes).toContain('only_admin_or_ppe');
  });
  it('adds a silica prompt for cutting masonry', () => {
    const codes = swmsAdvisories([], {
      ...complete,
      workDescription: 'Cutting concrete pavers with an angle grinder',
    }).map((a) => a.code);
    expect(codes).toContain('silica');
  });
  it('prompts for the asbestos register', () => {
    expect(swmsAdvisories(['asbestos'], complete).map((a) => a.code)).toContain(
      'asbestos_register',
    );
  });
});

describe('swmsTransition', () => {
  it('moves through review', () => {
    expect(swmsTransition('submitted', 'markReviewed', null)).toEqual({ ok: true, to: 'reviewed' });
    expect(swmsTransition('reviewed', 'accept', null)).toEqual({ ok: true, to: 'accepted' });
    expect(swmsTransition('submitted', 'accept', null)).toEqual({ ok: true, to: 'accepted' });
  });
  it('needs a reason to reject or reopen', () => {
    expect(swmsTransition('submitted', 'reject', null)).toEqual({
      ok: false,
      code: 'swms.reason_required',
    });
    expect(swmsTransition('accepted', 'reopen', 'Work changed')).toEqual({
      ok: true,
      to: 'submitted',
    });
  });
  it('does not accept twice or review a rejected SWMS', () => {
    expect(swmsTransition('accepted', 'accept', null).ok).toBe(false);
    expect(swmsTransition('rejected', 'accept', null).ok).toBe(false);
  });
});

describe('isExpired', () => {
  it('compares site-local dates', () => {
    expect(isExpired('2026-10-01', '2026-10-02')).toBe(true);
    expect(isExpired('2026-10-02', '2026-10-02')).toBe(false);
    expect(isExpired(null, '2026-10-02')).toBe(false);
  });
});
