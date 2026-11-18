// Pure helpers for the delivery board: times in the project's zone, the day timeline layout, and the rule-based
// answers Nova gives to questions about the board. Nothing here calls a model, so asking costs no credits.

import {
  addDays,
  endOfLocalDay,
  localDateOf,
  startOfLocalDay,
  zonedParts,
  zonedToUtc,
} from '@archova/time';
import type { Delivery, DeliveryFlag, DeliveryStatus, Resource } from '../data/api';

export const STATUS_LABELS: Record<DeliveryStatus, string> = {
  scheduled: 'Scheduled',
  arrived: 'On site',
  unloaded: 'Unloaded',
  delayed: 'Delayed',
  missed: 'Missed',
  cancelled: 'Cancelled',
};
export const STATUS_TONES = {
  scheduled: 'info',
  arrived: 'warning',
  unloaded: 'success',
  delayed: 'warning',
  missed: 'danger',
  cancelled: 'neutral',
} as const;
export const KIND_LABELS: Record<Resource['kind'], string> = {
  dock: 'Dock',
  laydown: 'Laydown area',
  crane: 'Crane',
  hoist: 'Hoist',
  lift: 'Lift',
  forklift: 'Forklift',
};
export const isDock = (k: Resource['kind']) => k === 'dock' || k === 'laydown';
/** Statuses that still hold a place on the board. */
export const HOLDS_SLOT: readonly DeliveryStatus[] = ['scheduled', 'arrived', 'delayed'];

/** The hours the timeline shows, in the project's zone. */
export const DAY_START_HOUR = 6;
export const DAY_END_HOUR = 18;

export function fmtTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(new Date(iso))
    .toLowerCase();
}

export function fmtWindow(d: { windowStart: string; windowEnd: string }, tz: string): string {
  return `${fmtTime(d.windowStart, tz)} to ${fmtTime(d.windowEnd, tz)}`;
}

export function fmtDay(date: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${date}T12:00:00Z`));
}

/** `HH:mm` of an instant in the zone, for a time input. */
export function timeInputValue(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/** The instant a wall-clock date and time mean in the project's zone. */
export const instantOf = (date: string, hhmm: string, tz: string) =>
  zonedToUtc(date, hhmm, tz).toISOString();

/** The ISO range a set of project-local days covers. */
export function rangeOf(firstDay: string, lastDay: string, tz: string) {
  return {
    from: startOfLocalDay(firstDay, tz).toISOString(),
    to: endOfLocalDay(lastDay, tz).toISOString(),
  };
}

export const dayOf = (iso: string, tz: string) => localDateOf(iso, tz);

/** Deliveries that start on `day` (project zone), earliest first. */
export function onDay(deliveries: readonly Delivery[], day: string, tz: string): Delivery[] {
  return deliveries
    .filter((d) => dayOf(d.windowStart, tz) === day)
    .sort((a, b) => a.windowStart.localeCompare(b.windowStart) || a.number - b.number);
}

export interface Block {
  delivery: Delivery;
  /** Percent from the left edge and width of the timeline, clamped to the visible hours. */
  left: number;
  width: number;
  /** Is this the crane booking rather than the unloading? */
  lift: boolean;
}
export interface Lane {
  resource: Resource;
  blocks: Block[];
}

/** Site hours, widened to the whole hour either side of anything booked outside them that day. */
export function dayHours(
  deliveries: readonly Delivery[],
  day: string,
  tz: string,
): { start: number; end: number } {
  let start = DAY_START_HOUR;
  let end = DAY_END_HOUR;
  const next = endOfLocalDay(day, tz).getTime();
  for (const d of onDay(deliveries, day, tz)) {
    if (d.status === 'cancelled') continue;
    const a = zonedParts(d.windowStart, tz);
    start = Math.min(start, a.hour);
    const e = new Date(d.windowEnd).getTime();
    // A window that runs past midnight stops at the end of the day.
    end = Math.max(
      end,
      e >= next
        ? 24
        : zonedParts(d.windowEnd, tz).hour + (zonedParts(d.windowEnd, tz).minute > 0 ? 1 : 0),
    );
  }
  return { start, end: Math.min(end, 24) };
}

/** One lane per active dock and crane; a delivery shows once on its dock and once on its lift. */
export function layoutDay(
  deliveries: readonly Delivery[],
  resources: readonly Resource[],
  day: string,
  tz: string,
): { lanes: Lane[]; unplanned: Delivery[]; hours: { start: number; end: number } } {
  const hours = dayHours(deliveries, day, tz);
  const open = zonedToUtc(day, `${String(hours.start).padStart(2, '0')}:00`, tz).getTime();
  const close =
    hours.end >= 24
      ? endOfLocalDay(day, tz).getTime()
      : zonedToUtc(day, `${String(hours.end).padStart(2, '0')}:00`, tz).getTime();
  const span = close - open;
  const place = (s: string, e: string) => {
    const a = Math.max(open, new Date(s).getTime());
    const b = Math.min(close, new Date(e).getTime());
    if (b <= a) return null;
    return { left: ((a - open) / span) * 100, width: Math.max(((b - a) / span) * 100, 1.5) };
  };
  const live = onDay(deliveries, day, tz).filter((d) => d.status !== 'cancelled');
  const lanes = resources
    .filter((r) => r.active)
    .sort((a, b) => Number(isDock(b.kind)) - Number(isDock(a.kind)) || a.name.localeCompare(b.name))
    .map((resource): Lane => {
      const blocks: Block[] = [];
      for (const delivery of live) {
        if (delivery.zoneId === resource.id) {
          const p = place(delivery.windowStart, delivery.windowEnd);
          if (p) blocks.push({ delivery, ...p, lift: false });
        }
        if (delivery.liftResourceId === resource.id) {
          const p = place(
            delivery.liftStart ?? delivery.windowStart,
            delivery.liftEnd ?? delivery.windowEnd,
          );
          if (p) blocks.push({ delivery, ...p, lift: true });
        }
      }
      return { resource, blocks };
    });
  return { lanes, unplanned: live.filter((d) => !d.zoneId), hours };
}

export interface AskContext {
  deliveries: readonly Delivery[];
  resources: readonly Resource[];
  flags: readonly DeliveryFlag[];
  tz: string;
  now: Date;
}
export interface Answer {
  text: string;
  deliveryIds: string[];
}

const label = (d: Delivery) => `#${d.number} ${d.supplierName} (${d.title})`;
const list = (ds: readonly Delivery[], tz: string) =>
  ds.map((d) => `${fmtWindow(d, tz)}: ${label(d)}`).join('\n');
const ids = (ds: readonly Delivery[]) => ds.map((d) => d.id);

/** Answers from the loaded board, by rule. Anything it can't read from the board it says so. */
export function answerQuestion(question: string, c: AskContext): Answer {
  const q = question.toLowerCase();
  const today = dayOf(c.now.toISOString(), c.tz);
  const tomorrow = addDays(today, 1);
  const live = c.deliveries.filter((d) => HOLDS_SLOT.includes(d.status));
  const byId = new Map(c.deliveries.map((d) => [d.id, d]));
  const flagged = (...kinds: DeliveryFlag['kind'][]) => {
    const seen = new Set<string>();
    return c.flags
      .filter((f) => kinds.includes(f.kind))
      .map((f) => byId.get(f.deliveryId))
      .filter((d): d is Delivery => !!d && !seen.has(d.id) && !!seen.add(d.id));
  };

  if (/\b(late|overdue|behind|missing|not (here|arrived)|where is)\b/.test(q)) {
    const ds = flagged('late', 'overdue');
    return ds.length
      ? { text: `${ds.length} not here yet:\n${list(ds, c.tz)}`, deliveryIds: ids(ds) }
      : { text: 'Nothing is running late right now.', deliveryIds: [] };
  }
  if (/\b(clash|clashes|double|conflict|overlap|overbook)/.test(q)) {
    const ds = flagged('double_booked', 'lift_clash');
    return ds.length
      ? {
          text: `${ds.length} deliveries compete for the same dock or crane:\n${c.flags
            .filter((f) => f.kind === 'double_booked' || f.kind === 'lift_clash')
            .map((f) => f.message)
            .join('\n')}`,
          deliveryIds: ids(ds),
        }
      : { text: 'No docks or cranes are double-booked.', deliveryIds: [] };
  }
  if (/\b(no plan|unplanned|without|missing a|no (zone|dock|crane))\b/.test(q)) {
    const ds = flagged('no_plan');
    return ds.length
      ? {
          text: ds.map((d) => c.flags.find((f) => f.deliveryId === d.id)!.message).join('\n'),
          deliveryIds: ids(ds),
        }
      : {
          text: 'Every delivery due in the next 48 hours has its dock and lift sorted.',
          deliveryIds: [],
        };
  }
  if (/\b(crane|hoist|lift)\b/.test(q) && /\b(free|available|next|book|when)\b/.test(q)) {
    const lifts = c.resources.filter((r) => r.active && !isDock(r.kind));
    if (lifts.length === 0)
      return {
        text: 'No crane, hoist or lift has been added to this project yet.',
        deliveryIds: [],
      };
    const text = lifts
      .map((r) => {
        const upcoming = live
          .filter((d) => d.liftResourceId === r.id)
          .map((d) => ({ d, end: d.liftEnd ?? d.windowEnd, start: d.liftStart ?? d.windowStart }))
          .filter((x) => new Date(x.end) > c.now)
          .sort((a, b) => a.start.localeCompare(b.start));
        if (upcoming.length === 0) return `${r.name} is free for the rest of the schedule.`;
        let freeAt = c.now.toISOString();
        for (const x of upcoming) {
          if (new Date(x.start) > new Date(freeAt)) break;
          if (x.end > freeAt) freeAt = x.end;
        }
        const busyNow = freeAt !== c.now.toISOString();
        return busyNow
          ? `${r.name} is booked until ${fmtTime(freeAt, c.tz)}.`
          : `${r.name} is free now; next booked ${fmtTime(upcoming[0]!.start, c.tz)}.`;
      })
      .join('\n');
    return { text, deliveryIds: [] };
  }
  const day = /\btomorrow\b/.test(q)
    ? tomorrow
    : /\b(today|this morning|this arvo|this afternoon|due|arriving|coming)\b/.test(q)
      ? today
      : null;
  if (day) {
    const ds = onDay(c.deliveries, day, c.tz).filter((d) => d.status !== 'cancelled');
    return ds.length
      ? {
          text: `${ds.length} on ${day === today ? 'today' : 'tomorrow'}:\n${list(ds, c.tz)}`,
          deliveryIds: ids(ds),
        }
      : { text: `Nothing is booked for ${day === today ? 'today' : 'tomorrow'}.`, deliveryIds: [] };
  }
  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w));
  const match = c.deliveries.filter((d) => {
    const hay =
      `${d.supplierName} ${d.title} ${d.items.map((i) => i.description).join(' ')} ${d.commitmentLabel ?? ''}`.toLowerCase();
    return words.some((w) => hay.includes(w));
  });
  if (match.length)
    return {
      text: `${match.length} match:\n${match
        .slice(0, 8)
        .map(
          (d) =>
            `${fmtDay(dayOf(d.windowStart, c.tz))} ${fmtWindow(d, c.tz)}: ${label(d)} — ${STATUS_LABELS[d.status]}`,
        )
        .join('\n')}`,
      deliveryIds: ids(match),
    };
  const next = live
    .filter((d) => new Date(d.windowEnd) > c.now)
    .sort((a, b) => a.windowStart.localeCompare(b.windowStart))[0];
  return {
    text: `I can answer from this board: what's late, what's clashing, what's due today or tomorrow, when a crane is free, deliveries with no plan, or a supplier or material by name.${next ? ` Next up: ${fmtDay(dayOf(next.windowStart, c.tz))} ${fmtWindow(next, c.tz)}, ${label(next)}.` : ''}`,
    deliveryIds: [],
  };
}
const STOP = new Set([
  'what',
  'when',
  'where',
  'which',
  'with',
  'from',
  'that',
  'this',
  'have',
  'does',
  'about',
  'delivery',
  'deliveries',
  'truck',
  'trucks',
]);
