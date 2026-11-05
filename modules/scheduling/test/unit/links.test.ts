import { describe, expect, it } from 'vitest';
import { resolveLinks, type LinkTarget } from '../../src/domain/links';

const rfi: LinkTarget = {
  id: 'r1',
  ref: 'RFI-012',
  title: 'Slab edge',
  status: 'open',
  dueDate: '2026-11-20',
  scheduleImpactDays: 3,
};

describe('resolveLinks', () => {
  it('fills in what the caller can see and hides the rest', () => {
    const out = resolveLinks(
      [
        { id: 'l1', activityId: 'a1', kind: 'rfi', targetId: 'r1' },
        { id: 'l2', activityId: 'a1', kind: 'rfi', targetId: 'gone' },
        { id: 'l3', activityId: 'a1', kind: 'submittal', targetId: 'r1' },
      ],
      { rfi: new Map([['r1', rfi]]), submittal: new Map() },
    );
    expect(out.map((l) => l.visible)).toEqual([true, false, false]);
    expect(out[0]).toMatchObject({ ref: 'RFI-012', scheduleImpactDays: 3, dueDate: '2026-11-20' });
    expect(out[1]).toMatchObject({ ref: null, title: null, status: null, dueDate: null });
  });
});
