// Site logistics for material deliveries: statuses, the rules that flag trouble and the slot finder. Pure; the
// use cases are in application/. Everything here is rule-based (no model), so the flags and suggestions cost nothing.
import { addDays, zonedToUtc, type LocalDate } from '@archova/time';

export const RESOURCE_KINDS = ['dock', 'laydown', 'crane', 'hoist', 'lift', 'forklift'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
/** Places a truck unloads. Everything else lifts or moves material once it is on site. */
export const isDock = (k: ResourceKind) => k === 'dock' || k === 'laydown';

export const DELIVERY_STATUSES = [
  'scheduled',
  'arrived',
  'unloaded',
  'delayed',
  'missed',
  'cancelled',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export type EventKind =
  | 'created'
  | 'updated'
  | 'rescheduled'
  | 'arrived'
  | 'unloaded'
  | 'delayed'
  | 'missed'
  | 'cancelled'
  | 'notice_drafted';

/** Statuses that still hold a place in the schedule. */
export const HOLDS_SLOT: readonly DeliveryStatus[] = ['scheduled', 'arrived', 'delayed'];
const holdsSlot = (s: DeliveryStatus) => HOLDS_SLOT.includes(s);

export type Action = 'arrive' | 'unload' | 'delay' | 'miss' | 'cancel' | 'reschedule';
const FROM: Record<Action, readonly DeliveryStatus[]> = {
  arrive: ['scheduled', 'delayed'],
  unload: ['arrived'],
  delay: ['scheduled'],
  miss: ['scheduled', 'delayed'],
  cancel: ['scheduled', 'delayed', 'arrived'],
  reschedule: ['scheduled', 'delayed', 'missed'],
};
export const canDo = (status: DeliveryStatus, action: Action) => FROM[action].includes(status);

/** Minutes after the start of the window before a delivery is called late. */
export const GRACE_MINUTES = 15;
/** How far ahead a delivery with no logistics plan is raised. */
export const PLAN_HORIZON_HOURS = 48;
/** Hours the site takes deliveries, in the project's zone. */
export const SITE_HOURS = { open: '07:00', close: '16:00' } as const;

export interface Slot {
  start: Date;
  end: Date;
}
/** Half-open: a delivery ending at 10:00 and one starting at 10:00 do not clash. */
export const slotsOverlap = (a: Slot, b: Slot) => a.start < b.end && b.start < a.end;

export interface ResourceView {
  id: string;
  name: string;
  kind: ResourceKind;
  capacity: number;
  active: boolean;
}
export interface DeliveryView {
  id: string;
  number: number;
  title: string;
  supplierName: string;
  status: DeliveryStatus;
  windowStart: Date;
  windowEnd: Date;
  zoneId: string | null;
  needsLift: boolean;
  liftResourceId: string | null;
  liftStart: Date | null;
  liftEnd: Date | null;
  arrivedAt: Date | null;
}

export type FlagKind =
  'late' | 'overdue' | 'arrived_late' | 'double_booked' | 'lift_clash' | 'no_plan';
export type Severity = 'high' | 'medium' | 'low';
export interface Flag {
  deliveryId: string;
  kind: FlagKind;
  severity: Severity;
  message: string;
  relatedDeliveryIds: string[];
}

/** The part of the delivery that uses the dock, and the part that uses the lift (defaults to the same window). */
const dockSlot = (d: DeliveryView): Slot => ({ start: d.windowStart, end: d.windowEnd });
const liftSlot = (d: DeliveryView): Slot => ({
  start: d.liftStart ?? d.windowStart,
  end: d.liftEnd ?? d.windowEnd,
});

/** Deliveries that sit on `resource` at the same time as `d` and push it past the resource's capacity. */
function clashes(
  d: DeliveryView,
  all: readonly DeliveryView[],
  resource: ResourceView,
  slotOf: (x: DeliveryView) => Slot,
  resourceOf: (x: DeliveryView) => string | null,
): DeliveryView[] {
  const mine = slotOf(d);
  const others = all.filter(
    (o) =>
      o.id !== d.id &&
      holdsSlot(o.status) &&
      resourceOf(o) === resource.id &&
      slotsOverlap(mine, slotOf(o)),
  );
  // Capacity counts trucks on the dock at once: it is only a clash if some moment has more than `capacity`.
  const edges = [mine.start, ...others.map((o) => slotOf(o).start)].filter(
    (t) => t >= mine.start && t < mine.end,
  );
  const busiest = Math.max(
    ...edges.map((t) => 1 + others.filter((o) => slotOf(o).start <= t && t < slotOf(o).end).length),
  );
  return busiest > resource.capacity ? others : [];
}

/** Everything worth raising on the board, most urgent first. `now` is passed in so the rules stay testable. */
export function computeFlags(
  deliveries: readonly DeliveryView[],
  resources: readonly ResourceView[],
  now: Date,
  timeZone: string,
): Flag[] {
  const byId = new Map(resources.map((r) => [r.id, r]));
  const flags: Flag[] = [];
  const graceMs = GRACE_MINUTES * 60_000;
  const horizon = new Date(now.getTime() + PLAN_HORIZON_HOURS * 3_600_000);
  const hhmm = (d: Date) =>
    new Intl.DateTimeFormat('en-AU', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  const day = (d: Date) =>
    new Intl.DateTimeFormat('en-AU', {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(d);
  const label = (d: DeliveryView) => `#${d.number} ${d.supplierName}`;

  for (const d of deliveries) {
    if (d.status === 'scheduled' || d.status === 'delayed') {
      if (now > d.windowEnd) {
        flags.push({
          deliveryId: d.id,
          kind: 'overdue',
          severity: 'high',
          message: `${label(d)} was due by ${hhmm(d.windowEnd)} and has not arrived. Reschedule it or mark it missed.`,
          relatedDeliveryIds: [],
        });
      } else if (now.getTime() > d.windowStart.getTime() + graceMs) {
        const mins = Math.round((now.getTime() - d.windowStart.getTime()) / 60_000);
        flags.push({
          deliveryId: d.id,
          kind: 'late',
          severity: 'medium',
          message: `${label(d)} is ${mins} min past the start of its ${hhmm(d.windowStart)} window.`,
          relatedDeliveryIds: [],
        });
      }
    }
    if ((d.status === 'arrived' || d.status === 'unloaded') && d.arrivedAt) {
      if (d.arrivedAt.getTime() > d.windowEnd.getTime() + graceMs) {
        flags.push({
          deliveryId: d.id,
          kind: 'arrived_late',
          severity: 'low',
          message: `${label(d)} arrived at ${hhmm(d.arrivedAt)}, after its window closed at ${hhmm(d.windowEnd)}.`,
          relatedDeliveryIds: [],
        });
      }
    }
    if (!holdsSlot(d.status)) continue;

    const zone = d.zoneId ? byId.get(d.zoneId) : undefined;
    if (zone) {
      const c = clashes(d, deliveries, zone, dockSlot, (x) => x.zoneId);
      if (c.length)
        flags.push({
          deliveryId: d.id,
          kind: 'double_booked',
          severity: 'high',
          message: `${label(d)} overlaps ${c.map(label).join(', ')} at ${zone.name} (room for ${zone.capacity} at a time).`,
          relatedDeliveryIds: c.map((o) => o.id),
        });
    }
    const lift = d.liftResourceId ? byId.get(d.liftResourceId) : undefined;
    if (lift) {
      const c = clashes(d, deliveries, lift, liftSlot, (x) => x.liftResourceId);
      if (c.length)
        flags.push({
          deliveryId: d.id,
          kind: 'lift_clash',
          severity: 'high',
          message: `${label(d)} needs ${lift.name} while ${c.map(label).join(', ')} also has it.`,
          relatedDeliveryIds: c.map((o) => o.id),
        });
    }
    if (d.status === 'scheduled' && d.windowStart >= now && d.windowStart <= horizon) {
      const missing = [
        ...(zone ? [] : ['unloading zone']),
        ...(d.needsLift && !lift ? ['crane or hoist booking'] : []),
      ];
      if (missing.length)
        flags.push({
          deliveryId: d.id,
          kind: 'no_plan',
          severity: 'medium',
          message: `${label(d)} is due ${hhmm(d.windowStart)} on ${day(d.windowStart)} and has no ${missing.join(' or ')}.`,
          relatedDeliveryIds: [],
        });
    }
  }
  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  return flags.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export interface SlotRequest {
  /** First day to look at, a calendar date in the project's zone. */
  fromDate: LocalDate;
  days: number;
  durationMinutes: number;
  /** Only this dock, or any active dock when absent. */
  zoneId?: string;
  needsLift: boolean;
  /** How long the lift is needed; defaults to the delivery's duration. */
  liftMinutes?: number;
  /** Only this lift, or any active crane, hoist or lift when absent. */
  liftResourceId?: string;
}
export interface SlotSuggestion extends Slot {
  zoneId: string;
  liftResourceId: string | null;
  liftEnd: Date | null;
}

/** Free windows inside site hours: up to two a day, six in all, earliest first. Never starts in the past. */
export function suggestSlots(
  req: SlotRequest,
  deliveries: readonly DeliveryView[],
  resources: readonly ResourceView[],
  now: Date,
  timeZone: string,
): SlotSuggestion[] {
  const docks = resources.filter(
    (r) => r.active && isDock(r.kind) && (!req.zoneId || r.id === req.zoneId),
  );
  const lifts = req.needsLift
    ? resources.filter(
        (r) =>
          r.active &&
          !isDock(r.kind) &&
          r.kind !== 'forklift' &&
          (!req.liftResourceId || r.id === req.liftResourceId),
      )
    : [];
  if (docks.length === 0 || (req.needsLift && lifts.length === 0)) return [];
  const durMs = req.durationMinutes * 60_000;
  const liftMs = (req.liftMinutes ?? req.durationMinutes) * 60_000;
  const STEP = 30 * 60_000;
  const out: SlotSuggestion[] = [];

  const free = (
    r: ResourceView,
    slot: Slot,
    slotOf: (x: DeliveryView) => Slot,
    resourceOf: (x: DeliveryView) => string | null,
  ) => {
    const overlapping = deliveries.filter(
      (o) => holdsSlot(o.status) && resourceOf(o) === r.id && slotsOverlap(slot, slotOf(o)),
    );
    // Every start inside the candidate must leave room under capacity.
    const points = [slot.start, ...overlapping.map((o) => slotOf(o).start)].filter(
      (t) => t >= slot.start && t < slot.end,
    );
    return points.every(
      (t) =>
        overlapping.filter((o) => slotOf(o).start <= t && t < slotOf(o).end).length < r.capacity,
    );
  };

  for (let i = 0; i < req.days && out.length < 6; i += 1) {
    const day = addDays(req.fromDate, i);
    const open = zonedToUtc(day, SITE_HOURS.open, timeZone).getTime();
    const close = zonedToUtc(day, SITE_HOURS.close, timeZone).getTime();
    let found = 0;
    for (let s = open; s + durMs <= close && found < 2; s += STEP) {
      if (s < now.getTime()) continue;
      const slot = { start: new Date(s), end: new Date(s + durMs) };
      const dock = docks.find((r) => free(r, slot, dockSlot, (x) => x.zoneId));
      if (!dock) continue;
      let lift: ResourceView | undefined;
      let liftEnd: Date | null = null;
      if (req.needsLift) {
        const ls = { start: slot.start, end: new Date(s + liftMs) };
        lift = lifts.find((r) => free(r, ls, liftSlot, (x) => x.liftResourceId));
        if (!lift) continue;
        liftEnd = ls.end;
      }
      out.push({ ...slot, zoneId: dock.id, liftResourceId: lift?.id ?? null, liftEnd });
      found += 1;
      // Leave a gap so the two offers for a day are not neighbours.
      s += 2 * 60 * 60_000;
    }
  }
  return out.slice(0, 6);
}

export type NoticeKind = 'late' | 'reschedule' | 'cancel' | 'confirm';
export interface NoticeInput {
  kind: NoticeKind;
  projectName: string;
  senderName: string;
  supplierName: string;
  supplierContact: string | null;
  deliveryNumber: number;
  title: string;
  windowStart: Date;
  windowEnd: Date;
  zoneName: string | null;
  liftName: string | null;
  accessNotes: string | null;
  poLabel: string | null;
  /** The slot to offer, for `reschedule`. */
  proposed?: SlotSuggestion & { zoneName: string | null };
  reason?: string | null;
}
export interface Notice {
  subject: string;
  body: string;
}

/** A plain, polite note to the supplier for a person to read, edit and send. Nothing is sent from here. */
export function draftNotice(i: NoticeInput, timeZone: string): Notice {
  const when = (s: Date, e: Date) => {
    const day = new Intl.DateTimeFormat('en-AU', {
      timeZone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(s);
    const t = (d: Date) =>
      new Intl.DateTimeFormat('en-AU', {
        timeZone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
        .format(d)
        .toLowerCase();
    return `${day}, ${t(s)} to ${t(e)}`;
  };
  const ref = `delivery #${i.deliveryNumber}${i.poLabel ? ` (${i.poLabel})` : ''} to ${i.projectName}`;
  const hi = `Hi ${i.supplierContact?.trim() || i.supplierName},`;
  const sign = `Thanks,\n${i.senderName}`;
  const booked = `Booked window: ${when(i.windowStart, i.windowEnd)}`;
  const where = i.zoneName ? `\nUnloading at: ${i.zoneName}` : '';
  const crane = i.liftName ? `\nLift: ${i.liftName}` : '';
  const access = i.accessNotes ? `\nSite access: ${i.accessNotes}` : '';
  const why = i.reason ? `\nReason: ${i.reason}` : '';

  switch (i.kind) {
    case 'confirm':
      return {
        subject: `Confirmed: ${ref}`,
        body: `${hi}\n\nThis confirms ${ref}: ${i.title}.\n\n${booked}${where}${crane}${access}\n\nPlease reply if the truck can't make that window.\n\n${sign}`,
      };
    case 'late':
      return {
        subject: `Where is ${ref}?`,
        body: `${hi}\n\nWe haven't received ${ref}: ${i.title}.\n\n${booked}${where}\n\nCould you tell us where the truck is and when it will arrive? Our crew and ${i.liftName ?? 'unloading gear'} are held for this window, so we may need to move you to another slot.\n\n${sign}`,
      };
    case 'cancel':
      return {
        subject: `Cancelled: ${ref}`,
        body: `${hi}\n\nWe need to cancel ${ref}: ${i.title}.\n\n${booked}${why}\n\nPlease don't dispatch it. We'll be in touch to book a new time.\n\n${sign}`,
      };
    case 'reschedule': {
      const p = i.proposed;
      const offer = p
        ? `\n\nCould you deliver in this window instead?\nProposed window: ${when(p.start, p.end)}${p.zoneName ? `\nUnloading at: ${p.zoneName}` : ''}`
        : '\n\nCould you tell us the next time you can deliver?';
      return {
        subject: `New time needed: ${ref}`,
        body: `${hi}\n\nWe need to move ${ref}: ${i.title}.\n\n${booked}${why}${offer}\n\n${sign}`,
      };
    }
  }
}
