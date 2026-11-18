import { describe, expect, it } from 'vitest';
import type { Flag, Unit } from '../data/api';
import { NEXT_STEP, answerQuestion } from '../lib/units';

const unit = (over: Partial<Unit>): Unit => ({
  id: 'pfu_1',
  number: 1,
  code: 'BP-1',
  name: 'Pod',
  kind: 'bathroom_pod',
  factoryName: null,
  supplierCompanyId: null,
  location: null,
  installSequence: null,
  weightKg: null,
  dimensions: null,
  status: 'in_fabrication',
  progressPct: 0,
  fabStart: null,
  fabDue: null,
  shipDate: null,
  installDate: null,
  shippedAt: null,
  deliveredAt: null,
  installedAt: null,
  statusReason: null,
  deliveryId: null,
  deliveryLabel: null,
  notes: null,
  qaTotal: 4,
  qaDone: 0,
  qaFailed: 0,
  version: 1,
  ...over,
});
const flag = (unitId: string, kind: Flag['kind']): Flag => ({
  unitId,
  kind,
  severity: 'medium',
  message: kind,
  relatedUnitIds: [],
});
const TODAY = '2026-11-18';

describe('answerQuestion', () => {
  const a = unit({ id: 'a', code: 'A', status: 'qa_hold', qaFailed: 1 });
  const b = unit({ id: 'b', code: 'B', installDate: '2026-11-25' });
  const c = unit({ id: 'c', code: 'C', installDate: '2026-11-20', status: 'planned' });
  const units = [a, b, c];

  it('lists units on QA hold or with a failed check', () => {
    expect(answerQuestion("What's on QA hold?", { units, flags: [], today: TODAY })).toMatchObject({
      unitIds: ['a'],
    });
  });
  it('lists what is behind from the flags', () => {
    const r = answerQuestion('what is late', {
      units,
      flags: [
        flag('b', 'fab_late'),
        flag('b', 'install_overdue'),
        flag('c', 'delivery_not_booked'),
      ],
      today: TODAY,
    });
    expect(r.unitIds).toEqual(['b']);
    expect(r.text).toContain('B');
  });
  it('lists the next installs soonest first', () => {
    const r = answerQuestion('what installs next?', { units, flags: [], today: TODAY });
    expect(r.unitIds).toEqual(['c', 'b']);
  });
  it('says so when nothing is wrong, and hints when it does not understand', () => {
    expect(answerQuestion('anything late', { units: [], flags: [], today: TODAY }).text).toBe(
      'Nothing is behind its dates.',
    );
    expect(answerQuestion('banana', { units, flags: [], today: TODAY }).text).toContain('Try:');
  });
});

describe('NEXT_STEP', () => {
  it('offers a way forward from every status except installed', () => {
    expect(NEXT_STEP.planned.main).toBe('start');
    expect(NEXT_STEP.on_site.main).toBe('install');
    expect(NEXT_STEP.installed.main).toBeNull();
    expect(NEXT_STEP.rejected.main).toBe('reopen');
  });
});
