import { describe, expect, it } from 'vitest';
import {
  canDo,
  computeFlags,
  draftNotice,
  suggestSlots,
  type DeliveryView,
  type ResourceView,
} from '../../src/domain/logistics';

const TZ = 'Australia/Brisbane'; // UTC+10, no daylight saving
const at = (hhmm: string, day = '2026-11-09') => new Date(`${day}T${hhmm}:00+10:00`);

const dock: ResourceView = {
  id: 'dock',
  name: 'Gate 2 dock',
  kind: 'dock',
  capacity: 1,
  active: true,
};
const crane: ResourceView = {
  id: 'crane',
  name: 'Tower crane',
  kind: 'crane',
  capacity: 1,
  active: true,
};
const wide: ResourceView = {
  id: 'wide',
  name: 'Laydown',
  kind: 'laydown',
  capacity: 2,
  active: true,
};

let n = 0;
const d = (over: Partial<DeliveryView>): DeliveryView => ({
  id: `d${++n}`,
  number: n,
  title: 'Steel',
  supplierName: 'Acme Steel',
  status: 'scheduled',
  windowStart: at('09:00'),
  windowEnd: at('10:00'),
  zoneId: 'dock',
  needsLift: false,
  liftResourceId: null,
  liftStart: null,
  liftEnd: null,
  arrivedAt: null,
  ...over,
});
const kinds = (fs: { kind: string }[]) => fs.map((f) => f.kind);

describe('computeFlags', () => {
  it('is quiet before the window and after the grace period starts', () => {
    const x = d({});
    expect(computeFlags([x], [dock], at('08:50'), TZ)).toEqual([]);
    expect(computeFlags([x], [dock], at('09:10'), TZ)).toEqual([]);
  });
  it('calls a delivery late past the grace and overdue past the window', () => {
    const x = d({});
    expect(kinds(computeFlags([x], [dock], at('09:30'), TZ))).toEqual(['late']);
    const over = computeFlags([x], [dock], at('10:05'), TZ);
    expect(kinds(over)).toEqual(['overdue']);
    expect(over[0]!.severity).toBe('high');
  });
  it('does not call an arrived or cancelled delivery late', () => {
    const arrived = d({ status: 'arrived', arrivedAt: at('09:20') });
    const cancelled = d({ status: 'cancelled' });
    expect(computeFlags([arrived, cancelled], [dock], at('11:00'), TZ)).toEqual([]);
  });
  it('notes a truck that arrived after its window closed', () => {
    const x = d({ status: 'unloaded', arrivedAt: at('10:40') });
    expect(kinds(computeFlags([x], [dock], at('12:00'), TZ))).toEqual(['arrived_late']);
  });
  it('flags two deliveries on a one-truck dock, but not back to back', () => {
    const a = d({});
    const b = d({ windowStart: at('09:30'), windowEnd: at('10:30') });
    const c = d({ windowStart: at('10:00'), windowEnd: at('11:00') });
    const flags = computeFlags([a, b], [dock], at('07:00'), TZ);
    expect(kinds(flags)).toEqual(['double_booked', 'double_booked']);
    expect(flags[0]!.relatedDeliveryIds).toEqual([b.id]);
    expect(computeFlags([a, c], [dock], at('07:00'), TZ)).toEqual([]);
  });
  it('honours capacity: two trucks fit a two-truck laydown, three do not', () => {
    const two = [d({ zoneId: 'wide' }), d({ zoneId: 'wide' })];
    expect(computeFlags(two, [wide], at('07:00'), TZ)).toEqual([]);
    const three = [...two, d({ zoneId: 'wide' })];
    expect(computeFlags(three, [wide], at('07:00'), TZ)).toHaveLength(3);
  });
  it('flags a crane wanted by two deliveries at once, using the lift times when given', () => {
    const a = d({ zoneId: 'dock', liftResourceId: 'crane', needsLift: true });
    const b = d({
      zoneId: 'wide',
      windowStart: at('08:00'),
      windowEnd: at('09:30'),
      liftResourceId: 'crane',
      needsLift: true,
      liftStart: at('09:15'),
      liftEnd: at('09:45'),
    });
    expect(kinds(computeFlags([a, b], [dock, wide, crane], at('07:00'), TZ))).toEqual([
      'lift_clash',
      'lift_clash',
    ]);
    const c = { ...b, liftStart: at('08:00'), liftEnd: at('08:30') };
    expect(computeFlags([a, c], [dock, wide, crane], at('07:00'), TZ)).toEqual([]);
  });
  it('ignores cancelled deliveries when looking for clashes', () => {
    const a = d({});
    const b = d({ status: 'cancelled' });
    expect(computeFlags([a, b], [dock], at('07:00'), TZ)).toEqual([]);
  });
  it('flags a delivery due within 48 hours with no zone, or a lift with no crane', () => {
    const noZone = d({ zoneId: null });
    const noCrane = d({ needsLift: true, windowStart: at('13:00'), windowEnd: at('14:00') });
    const flags = computeFlags([noZone, noCrane], [dock], at('07:00'), TZ);
    expect(kinds(flags)).toEqual(['no_plan', 'no_plan']);
    expect(flags[0]!.message).toContain('no unloading zone');
    expect(flags[1]!.message).toContain('no crane or hoist booking');
  });
  it('leaves a far-off delivery with no plan alone', () => {
    const far = d({
      zoneId: null,
      windowStart: at('09:00', '2026-11-20'),
      windowEnd: at('10:00', '2026-11-20'),
    });
    expect(computeFlags([far], [dock], at('07:00'), TZ)).toEqual([]);
  });
  it('lists the most urgent first', () => {
    const noPlan = d({ zoneId: null, windowStart: at('15:00'), windowEnd: at('16:00') });
    const overdue = d({});
    expect(kinds(computeFlags([noPlan, overdue], [dock], at('10:30'), TZ))).toEqual([
      'overdue',
      'no_plan',
    ]);
  });
});

describe('suggestSlots', () => {
  const req = { fromDate: '2026-11-09', days: 2, durationMinutes: 60, needsLift: false };
  it('offers windows inside site hours, none in the past, two a day', () => {
    const out = suggestSlots(req, [], [dock], at('06:00'), TZ);
    expect(out.map((s) => s.start.toISOString())).toEqual([
      at('07:00').toISOString(),
      at('09:30').toISOString(),
      at('07:00', '2026-11-10').toISOString(),
      at('09:30', '2026-11-10').toISOString(),
    ]);
    expect(out.every((s) => s.end.getTime() - s.start.getTime() === 3_600_000)).toBe(true);
    const later = suggestSlots(req, [], [dock], at('12:10'), TZ);
    expect(later[0]!.start.getTime()).toBeGreaterThanOrEqual(at('12:10').getTime());
  });
  it('steers round booked time and uses another dock when one is free', () => {
    const busy = d({ windowStart: at('07:00'), windowEnd: at('09:00') });
    const one = suggestSlots({ ...req, days: 1 }, [busy], [dock], at('06:00'), TZ);
    expect(one[0]!.start.getTime()).toBe(at('09:00').getTime());
    const two = suggestSlots({ ...req, days: 1 }, [busy], [dock, wide], at('06:00'), TZ);
    expect(two[0]!.start.getTime()).toBe(at('07:00').getTime());
    expect(two[0]!.zoneId).toBe('wide');
  });
  it('needs a free crane when a lift is wanted, and offers none without one', () => {
    const craneBusy = d({
      zoneId: 'wide',
      liftResourceId: 'crane',
      windowStart: at('07:00'),
      windowEnd: at('11:00'),
    });
    const out = suggestSlots(
      { ...req, days: 1, needsLift: true },
      [craneBusy],
      [dock, wide, crane],
      at('06:00'),
      TZ,
    );
    expect(out[0]!.start.getTime()).toBe(at('11:00').getTime());
    expect(out[0]!.liftResourceId).toBe('crane');
    expect(suggestSlots({ ...req, needsLift: true }, [], [dock], at('06:00'), TZ)).toEqual([]);
  });
  it('skips retired resources and a duration longer than the day', () => {
    expect(suggestSlots(req, [], [{ ...dock, active: false }], at('06:00'), TZ)).toEqual([]);
    expect(suggestSlots({ ...req, durationMinutes: 600 }, [], [dock], at('06:00'), TZ)).toEqual([]);
  });
});

describe('transitions', () => {
  it('only allows sensible moves', () => {
    expect(canDo('scheduled', 'arrive')).toBe(true);
    expect(canDo('delayed', 'arrive')).toBe(true);
    expect(canDo('unloaded', 'arrive')).toBe(false);
    expect(canDo('scheduled', 'unload')).toBe(false);
    expect(canDo('arrived', 'unload')).toBe(true);
    expect(canDo('missed', 'reschedule')).toBe(true);
    expect(canDo('cancelled', 'reschedule')).toBe(false);
  });
});

describe('draftNotice', () => {
  const base = {
    projectName: 'Harbour Tower',
    senderName: 'Sam',
    supplierName: 'Acme Steel',
    supplierContact: 'Jo',
    deliveryNumber: 7,
    title: 'Level 3 beams',
    windowStart: at('09:00'),
    windowEnd: at('10:00'),
    zoneName: 'Gate 2 dock',
    liftName: 'Tower crane',
    accessNotes: null,
    poLabel: 'PO 12 · Structural steel',
  };
  it('writes the times in the project zone, not UTC', () => {
    const n = draftNotice({ ...base, kind: 'confirm' }, TZ);
    expect(n.subject).toContain('delivery #7 (PO 12 · Structural steel) to Harbour Tower');
    expect(n.body).toContain('Monday 9 November, 9:00 am to 10:00 am');
    expect(n.body.startsWith('Hi Jo,')).toBe(true);
  });
  it('offers the proposed slot on a reschedule and asks for a time when there is none', () => {
    const slot = {
      start: at('13:00'),
      end: at('14:00'),
      zoneId: 'dock',
      liftResourceId: null,
      liftEnd: null,
      zoneName: 'Gate 2 dock',
    };
    expect(draftNotice({ ...base, kind: 'reschedule', proposed: slot }, TZ).body).toContain(
      '1:00 pm to 2:00 pm',
    );
    expect(draftNotice({ ...base, kind: 'reschedule' }, TZ).body).toContain(
      'next time you can deliver',
    );
  });
  it('names the reason on a cancellation', () => {
    expect(
      draftNotice({ ...base, kind: 'cancel', reason: 'Slab pour delayed' }, TZ).body,
    ).toContain('Reason: Slab pour delayed');
  });
});
