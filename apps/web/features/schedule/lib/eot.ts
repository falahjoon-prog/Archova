// Pure helpers for the EOT claims board: labels, clock chips and the rule-based answers Nova gives to questions about
// the events. Nothing here calls a model, so asking costs no credits. Wording follows compliance/08 §5: it states
// dates and counts from the contract periods a person entered, and never says an extension is due.

import { formatLocalDate } from '@/shared/lib/format';
import type {
  DelayEvent,
  DelayEventClock,
  DelayEventFlag,
  DelayEventInsights,
  DelayEventItem,
  DelayEventStatus,
} from '../data/eot';

export const STATUS_LABELS: Record<DelayEventStatus, string> = {
  draft: 'Draft',
  notice_given: 'Notice given',
  claimed: 'Claim sent',
  assessed: 'Assessed',
  closed: 'Closed',
  withdrawn: 'Withdrawn',
};
export const STATUS_TONES = {
  draft: 'neutral',
  notice_given: 'info',
  claimed: 'warning',
  assessed: 'success',
  closed: 'neutral',
  withdrawn: 'neutral',
} as const;

export const FORM_LABELS = {
  as4000: 'AS 4000',
  as2124: 'AS 2124',
  as4902: 'AS 4902',
  other: 'Other contract',
} as const;

export const ITEM_LABELS: Record<DelayEventItem['kind'], string> = {
  diary_delay: 'Site diary',
  rfi_impact: 'RFI impact',
  rfi_late: 'RFI answered late',
  weather_day: 'Rain day',
  correspondence: 'Notice',
  note: 'Note',
};

export const FLAG_LABELS: Record<DelayEventFlag['kind'], string> = {
  notice_overdue: 'Notice period ended',
  notice_due_soon: 'Notice period ending',
  claim_overdue: 'Claim period ended',
  claim_due_soon: 'Claim period ending',
  periods_unconfirmed: 'Periods to check',
  untracked_delay: 'Not in an event',
  no_evidence: 'No evidence',
  days_over_span: 'Days to check',
  wet_days_over_allowance: 'Wet days',
  assessment_waiting: 'Awaiting assessment',
};
export const SEVERITY_TONE = { high: 'danger', medium: 'warning', low: 'info' } as const;

export type ClockView = {
  tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  text: string;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What to show on a notice or claim clock: a date and how long is left, or that it was given. */
export function clockView(
  c: DelayEventClock,
  sentOn: string | null,
  verb: 'notice' | 'claim',
  live: boolean,
): ClockView {
  if (sentOn)
    return {
      tone: c.state === 'met_late' ? 'warning' : 'success',
      text: `${verb === 'notice' ? 'Given' : 'Sent'} ${formatLocalDate(sentOn)}${c.state === 'met_late' ? ' (after the date)' : ''}`,
    };
  if (!live) return { tone: 'neutral', text: '—' };
  const due = formatLocalDate(c.dueOn);
  switch (c.state) {
    case 'overdue':
      return { tone: 'danger', text: `Ended ${due}` };
    case 'due_today':
      return { tone: 'danger', text: `Ends today (${due})` };
    case 'due_soon':
      return { tone: 'warning', text: `${plural(c.daysLeft ?? 0, 'day')} left (${due})` };
    default:
      return { tone: 'info', text: `${plural(c.daysLeft ?? 0, 'day')} left (${due})` };
  }
}

export const isLive = (s: DelayEventStatus) => s !== 'closed' && s !== 'withdrawn';

export function fmtDate(d: string | null): string {
  return d ? formatLocalDate(d) : '—';
}

export interface Answer {
  text: string;
  eventIds: string[];
}

/** Questions Nova answers straight from the board and its checks, with the events behind the answer. */
export function answerQuestion(
  question: string,
  ctx: { events: readonly DelayEvent[]; insights: DelayEventInsights },
): Answer {
  const q = question.toLowerCase();
  const { events, insights } = ctx;
  const flags = insights.flags;
  const s = insights.summary;
  const live = events.filter((e) => isLive(e.status));

  if (/(due|deadline|clock|time bar|notice|running out|expir)/.test(q)) {
    const items = flags.filter((f) =>
      [
        'notice_overdue',
        'notice_due_soon',
        'claim_overdue',
        'claim_due_soon',
        'untracked_delay',
      ].includes(f.kind),
    );
    if (items.length === 0)
      return {
        text: live.length
          ? 'No notice or claim period is close to ending on the dates entered. Check the contract periods are right.'
          : 'There are no open delay events.',
        eventIds: [],
      };
    return {
      text: `${plural(items.length, 'date')} to look at. ${items[0]!.message}`,
      eventIds: items.flatMap((f) => (f.eventId ? [f.eventId] : [])),
    };
  }
  if (/(not in|untracked|missing|uncovered|no event|possible|register)/.test(q))
    return {
      text:
        s.untrackedDelays === 0
          ? 'Every delay marked as a possible EOT is already in an event.'
          : `${plural(s.untrackedDelays, 'delay')} marked as a possible EOT ${s.untrackedDelays === 1 ? 'is' : 'are'} in no event. Use New delay event to group them.`,
      eventIds: [],
    };
  if (/(days|claimed|granted|how many|total)/.test(q))
    return {
      text: `${plural(s.daysClaimed, 'day')} claimed and ${plural(s.daysGranted, 'day')} granted so far across ${plural(s.events, 'event')}. ${plural(s.awaitingAssessment, 'claim')} awaiting assessment.`,
      eventIds: events.filter((e) => e.status === 'claimed').map((e) => e.id),
    };
  if (/(wet|rain|weather)/.test(q))
    return {
      text:
        s.wetDayAllowance === null
          ? `${plural(s.wetDays, 'rain day')} attached to events. No wet-day allowance is set in the contract periods.`
          : `${plural(s.wetDays, 'rain day')} attached to events against an allowance of ${s.wetDayAllowance}.`,
      eventIds: events.filter((e) => e.evidence.rainDays > 0).map((e) => e.id),
    };
  if (/(evidence|support|missing)/.test(q)) {
    const bare = live.filter((e) => e.evidence.items === 0);
    return {
      text: bare.length
        ? `${bare.map((e) => e.ref).join(', ')} ${bare.length === 1 ? 'has' : 'have'} no evidence attached.`
        : 'Every open event has evidence attached.',
      eventIds: bare.map((e) => e.id),
    };
  }
  return {
    text: 'Try: what is due, what is not in an event, how many days are claimed, which events have no evidence, or how many rain days.',
    eventIds: [],
  };
}
