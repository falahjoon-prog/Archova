import { describe, expect, it } from 'vitest';
import type { Delivery, DeliveryFlag, Resource } from '../data/api';
import { answerQuestion, layoutDay, onDay, rangeOf } from '../lib/board';

const TZ = 'Australia/Brisbane';
const at = (hhmm: string, day = '2026-11-09') => new Date(`${day}T${hhmm}:00+10:00`).toISOString();
const dock: Resource = {
  id: 'lgr_dock',
  name: 'Gate 2 dock',
  kind: 'dock',
  capacity: 1,
  active: true,
  note: null,
  version: 1,
};
const crane: Resource = {
  id: 'lgr_crane',
  name: 'Tower crane',
  kind: 'crane',
  capacity: 1,
  active: true,
  note: null,
  version: 1,
};
let n = 0;
const d = (over: Partial<Delivery>): Delivery => ({
  id: `dlv_${++n}`,
  number: n,
  title: 'Level 3 beams',
  supplierName: 'Acme Steel',
  supplierCompanyId: null,
  supplierContact: null,
  supplierEmail: null,
  supplierPhone: null,
  items: [],
  windowStart: at('09:00'),
  windowEnd: at('10:00'),
  zoneId: dock.id,
  needsLift: false,
  liftResourceId: null,
  liftStart: null,
  liftEnd: null,
  vehicle: null,
  accessNotes: null,
  status: 'scheduled',
  arrivedAt: null,
  unloadedAt: null,
  statusReason: null,
  commitmentId: null,
  commitmentLabel: null,
  version: 1,
  ...over,
});
const flag = (deliveryId: string, kind: DeliveryFlag['kind'], message: string): DeliveryFlag => ({
  deliveryId,
  kind,
  severity: 'high',
  message,
  relatedDeliveryIds: [],
});
const now = new Date(at('09:40'));

describe('layoutDay', () => {
  it('puts a delivery on its dock and, separately, on its crane, at the right place on the timeline', () => {
    const x = d({
      liftResourceId: crane.id,
      needsLift: true,
      liftStart: at('09:30'),
      liftEnd: at('10:30'),
    });
    const { lanes, unplanned } = layoutDay([x], [crane, dock], '2026-11-09', TZ);
    expect(lanes.map((l) => l.resource.name)).toEqual(['Gate 2 dock', 'Tower crane']);
    const [dockLane, craneLane] = lanes;
    // 6am to 6pm is 12 hours: 9am is a quarter of the way along, one hour is 1/12 wide.
    expect(dockLane!.blocks[0]).toMatchObject({ lift: false, left: 25 });
    expect(dockLane!.blocks[0]!.width).toBeCloseTo(100 / 12);
    expect(craneLane!.blocks[0]).toMatchObject({ lift: true });
    expect(craneLane!.blocks[0]!.left).toBeCloseTo((3.5 / 12) * 100);
    expect(unplanned).toEqual([]);
  });
  it('leaves cancelled deliveries off, lists ones with no dock, and ignores other days', () => {
    const none = d({ zoneId: null });
    const gone = d({ status: 'cancelled' });
    const later = d({
      windowStart: at('09:00', '2026-11-10'),
      windowEnd: at('10:00', '2026-11-10'),
    });
    const { lanes, unplanned } = layoutDay([none, gone, later], [dock], '2026-11-09', TZ);
    expect(lanes[0]!.blocks).toEqual([]);
    expect(unplanned).toEqual([none]);
    expect(onDay([later, none], '2026-11-10', TZ)).toEqual([later]);
  });
  it('widens the timeline to hours booked outside 6am to 6pm', () => {
    const early = d({ windowStart: at('04:30'), windowEnd: at('05:30') });
    const late = d({ windowStart: at('19:00'), windowEnd: at('20:15') });
    expect(layoutDay([early, late], [dock], '2026-11-09', TZ).hours).toEqual({ start: 4, end: 21 });
    expect(layoutDay([d({})], [dock], '2026-11-09', TZ).hours).toEqual({ start: 6, end: 18 });
  });
  it('skips retired resources', () => {
    expect(layoutDay([d({})], [{ ...dock, active: false }], '2026-11-09', TZ).lanes).toEqual([]);
  });
});

describe('rangeOf', () => {
  it('covers whole local days, not UTC days', () => {
    expect(rangeOf('2026-11-09', '2026-11-09', TZ)).toEqual({
      from: '2026-11-08T14:00:00.000Z',
      to: '2026-11-09T14:00:00.000Z',
    });
  });
});

describe('answerQuestion', () => {
  const late = d({});
  const steel = d({
    supplierName: 'Hume Concrete',
    title: 'Footing pour',
    windowStart: at('13:00'),
    windowEnd: at('14:00'),
  });
  const tomorrow = d({
    supplierName: 'Timber Co',
    windowStart: at('08:00', '2026-11-10'),
    windowEnd: at('09:00', '2026-11-10'),
  });
  const ctx = {
    deliveries: [late, steel, tomorrow],
    resources: [dock, crane],
    flags: [flag(late.id, 'late', '#1 Acme Steel is 40 min past the start of its 9:00 am window.')],
    tz: TZ,
    now,
  };
  it('names what is late from the flags', () => {
    const a = answerQuestion("What's late?", ctx);
    expect(a.deliveryIds).toEqual([late.id]);
    expect(a.text).toContain('Acme Steel');
  });
  it('says so when nothing is wrong', () => {
    expect(answerQuestion('any clashes?', ctx).text).toBe('No docks or cranes are double-booked.');
    expect(answerQuestion('is anything late', { ...ctx, flags: [] }).deliveryIds).toEqual([]);
  });
  it('lists today and tomorrow by the project’s calendar', () => {
    expect(answerQuestion("what's due today", ctx).deliveryIds).toEqual([late.id, steel.id]);
    expect(answerQuestion('what is coming tomorrow', ctx).deliveryIds).toEqual([tomorrow.id]);
  });
  it('finds a supplier or material by name', () => {
    expect(answerQuestion('who is bringing the footing pour', ctx).deliveryIds).toEqual([steel.id]);
    expect(answerQuestion('anything from hume?', ctx).deliveryIds).toEqual([steel.id]);
  });
  it('reports when a crane is free', () => {
    const lifted = d({
      liftResourceId: crane.id,
      windowStart: at('09:00'),
      windowEnd: at('11:00'),
    });
    const a = answerQuestion('when is the crane free', { ...ctx, deliveries: [lifted] });
    expect(a.text).toBe('Tower crane is booked until 11:00 am.');
    expect(answerQuestion('when is the crane free', { ...ctx, deliveries: [] }).text).toContain(
      'free for the rest',
    );
    expect(answerQuestion('when is the crane free', { ...ctx, resources: [dock] }).text).toContain(
      'No crane',
    );
  });
  it('says what it can answer when it does not understand', () => {
    expect(answerQuestion('make me a sandwich', ctx).text).toContain(
      'I can answer from this board',
    );
  });
});
