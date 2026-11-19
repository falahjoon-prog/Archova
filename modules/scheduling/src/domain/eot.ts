// Pure rules for delay events and extension-of-time claims (product/08 SCH-AC3..5, integrations/09, compliance/08 §5).
// Deadlines come from the contract periods a person entered, never from AI. Nova's drafts here are templates filled from
// the evidence pack: they state facts and quote the evidence, and never say an extension is due or that a time bar does
// not apply. A person edits and sends; nothing is sent from here.
import { addBusinessDays, addDays, daysBetween, type LocalDate } from '@archova/time';
import { DELAY_CAUSES, type DelayCause } from './register';

export { DELAY_CAUSES, type DelayCause };

export const EOT_FORMS = ['as4000', 'as2124', 'as4902', 'other'] as const;
export type EotForm = (typeof EOT_FORMS)[number];
export const DAY_BASES = ['calendar', 'business'] as const;
export type DayBasis = (typeof DAY_BASES)[number];

export const EVENT_STATUSES = [
  'draft',
  'notice_given',
  'claimed',
  'assessed',
  'closed',
  'withdrawn',
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const ITEM_KINDS = [
  'diary_delay',
  'rfi_impact',
  'rfi_late',
  'weather_day',
  'correspondence',
  'note',
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export interface EotSettings {
  form: EotForm;
  noticeDays: number;
  claimDays: number;
  dayBasis: DayBasis;
  noticeClause: string | null;
  claimClause: string | null;
  /** A person checked the periods against the contract. Until then every date is an estimate. */
  confirmed: boolean;
  rainThresholdMm: number;
  wetDayAllowance: number | null;
}

/** Unamended-form starting points (compliance/08 §5). Shown as defaults to check, never as what the contract says. */
export const FORM_DEFAULTS: Record<
  EotForm,
  { noticeDays: number; claimDays: number; label: string }
> = {
  as4000: { noticeDays: 14, claimDays: 28, label: 'AS 4000' },
  as2124: { noticeDays: 14, claimDays: 28, label: 'AS 2124' },
  as4902: { noticeDays: 14, claimDays: 28, label: 'AS 4902' },
  other: { noticeDays: 14, claimDays: 28, label: 'Other contract' },
};

export const DEFAULT_SETTINGS: EotSettings = {
  form: 'as4000',
  noticeDays: 14,
  claimDays: 28,
  dayBasis: 'calendar',
  noticeClause: null,
  claimClause: null,
  confirmed: false,
  rainThresholdMm: 10,
  wetDayAllowance: null,
};

export const CAUSE_LABEL: Record<DelayCause, string> = {
  weather: 'Inclement weather',
  client: 'Client or principal',
  design: 'Design information',
  subcontractor: 'Subcontractor',
  authority: 'Authority',
  industrial: 'Industrial action',
  other: 'Other',
};

// ------------------------------------------------------------------------------------------------ status moves

export type EventAction =
  'give_notice' | 'submit_claim' | 'record_assessment' | 'close' | 'withdraw' | 'reopen';

/** Which statuses each action may start from. A claim may go in without a recorded notice (a flag points that out). */
export const ACTION_FROM: Record<EventAction, readonly EventStatus[]> = {
  give_notice: ['draft'],
  submit_claim: ['draft', 'notice_given'],
  record_assessment: ['claimed', 'assessed'],
  close: ['assessed', 'claimed', 'notice_given', 'draft'],
  withdraw: ['draft', 'notice_given', 'claimed'],
  reopen: ['closed', 'withdrawn'],
};
export const canDo = (status: EventStatus, action: EventAction) =>
  ACTION_FROM[action].includes(status);

/** Statuses whose clock is still running or whose result is not known. */
export const LIVE_STATUSES: readonly EventStatus[] = [
  'draft',
  'notice_given',
  'claimed',
  'assessed',
];

// ------------------------------------------------------------------------------------------------ deadlines

/** The date a period ends. Business days skip weekends only; public holidays are not counted out, so the date is never later than the contract's. */
export function addPeriod(from: LocalDate, days: number, basis: DayBasis): LocalDate {
  return basis === 'business' ? addBusinessDays(from, days) : addDays(from, days);
}

export type ClockState = 'met' | 'met_late' | 'ok' | 'due_soon' | 'due_today' | 'overdue';
export interface Clock {
  dueOn: LocalDate;
  /** Calendar days from today to the due date; negative when it has passed. Null once the step was done. */
  daysLeft: number | null;
  state: ClockState;
  /** True when a person set the date to match a contract amendment. */
  overridden: boolean;
}

/** The state of one notice or claim clock. `sentOn` is when it was given; a late one is still shown as given. */
export function clock(
  dueOn: LocalDate,
  sentOn: LocalDate | null,
  today: LocalDate,
  overridden: boolean,
): Clock {
  if (sentOn)
    return { dueOn, daysLeft: null, state: sentOn <= dueOn ? 'met' : 'met_late', overridden };
  const left = daysBetween(today, dueOn);
  const state: ClockState =
    left < 0 ? 'overdue' : left === 0 ? 'due_today' : left <= 3 ? 'due_soon' : 'ok';
  return { dueOn, daysLeft: left, state, overridden };
}

export interface EventDates {
  awareOn: LocalDate;
  noticeDueOn: LocalDate | null;
  claimDueOn: LocalDate | null;
  noticeSentOn: LocalDate | null;
  claimSentOn: LocalDate | null;
}

export function clocks(e: EventDates, s: EotSettings, today: LocalDate) {
  return {
    notice: clock(
      e.noticeDueOn ?? addPeriod(e.awareOn, s.noticeDays, s.dayBasis),
      e.noticeSentOn,
      today,
      e.noticeDueOn !== null,
    ),
    claim: clock(
      e.claimDueOn ?? addPeriod(e.awareOn, s.claimDays, s.dayBasis),
      e.claimSentOn,
      today,
      e.claimDueOn !== null,
    ),
  };
}

// ------------------------------------------------------------------------------------------------ weather

export interface WeatherReading {
  rainfallMm: number | null;
  minTempC: number | null;
  maxTempC: number | null;
  windKmh: number | null;
  conditions: string | null;
}

/** A rain day by the project's threshold, or one the site manager logged weather delay hours on. */
export function isRainDay(rainMm: number | null, weatherDelayHours: number, thresholdMm: number) {
  return (rainMm ?? 0) >= thresholdMm || weatherDelayHours > 0;
}

export function weatherText(w: WeatherReading | null): string {
  if (!w) return 'No weather recorded';
  const parts: string[] = [];
  if (w.rainfallMm !== null) parts.push(`${w.rainfallMm} mm rain`);
  if (w.conditions) parts.push(w.conditions);
  if (w.maxTempC !== null) parts.push(`max ${w.maxTempC}°C`);
  if (w.windKmh !== null) parts.push(`wind ${w.windKmh} km/h`);
  return parts.length ? parts.join(', ') : 'Weather recorded without readings';
}

// ------------------------------------------------------------------------------------------------ evidence

export interface EvidenceItem {
  id: string;
  kind: ItemKind;
  onDate: LocalDate | null;
  label: string;
  detail: string | null;
  hours: number | null;
  days: number | null;
  rainMm: number | null;
}

export interface EvidenceSummary {
  items: number;
  diaryHours: number;
  rfiDays: number;
  rainDays: number;
  rainMm: number;
  notices: number;
  firstDate: LocalDate | null;
  lastDate: LocalDate | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function summariseEvidence(items: readonly EvidenceItem[]): EvidenceSummary {
  const dates = items
    .map((i) => i.onDate)
    .filter((d): d is LocalDate => d !== null)
    .sort();
  return {
    items: items.length,
    diaryHours: round2(
      items.reduce((n, i) => n + (i.kind === 'diary_delay' ? (i.hours ?? 0) : 0), 0),
    ),
    rfiDays: round2(
      items.reduce(
        (n, i) => n + (i.kind === 'rfi_impact' || i.kind === 'rfi_late' ? (i.days ?? 0) : 0),
        0,
      ),
    ),
    rainDays: items.filter((i) => i.kind === 'weather_day').length,
    rainMm: round2(items.reduce((n, i) => n + (i.kind === 'weather_day' ? (i.rainMm ?? 0) : 0), 0)),
    notices: items.filter((i) => i.kind === 'correspondence').length,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
  };
}

/** Calendar days from the start to the end (today while it continues), counting both days. A starting point for the claim, not an entitlement. */
export function spanDays(
  startedOn: LocalDate,
  endedOn: LocalDate | null,
  today: LocalDate,
): number {
  const end = endedOn ?? (today < startedOn ? startedOn : today);
  return daysBetween(startedOn, end) + 1;
}

// ------------------------------------------------------------------------------------------------ Nova flags

export type FlagKind =
  | 'notice_overdue'
  | 'notice_due_soon'
  | 'claim_overdue'
  | 'claim_due_soon'
  | 'periods_unconfirmed'
  | 'untracked_delay'
  | 'no_evidence'
  | 'days_over_span'
  | 'wet_days_over_allowance'
  | 'assessment_waiting';
export type Severity = 'high' | 'medium' | 'low';

export interface Flag {
  kind: FlagKind;
  severity: Severity;
  message: string;
  eventId: string | null;
}

export interface FlagEvent extends EventDates {
  id: string;
  number: number;
  status: EventStatus;
  startedOn: LocalDate;
  endedOn: LocalDate | null;
  daysClaimed: number;
  evidence: EvidenceSummary;
}

export interface UntrackedDelay {
  date: LocalDate;
  label: string;
}

export const eventRef = (n: number) => `EOT-${String(n).padStart(3, '0')}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fmt = (d: LocalDate) => {
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};
export const fmtDay = fmt;

export function computeFlags(input: {
  today: LocalDate;
  settings: EotSettings;
  events: readonly FlagEvent[];
  untracked: readonly UntrackedDelay[];
  /** Wet days counted on the project against the contract allowance (rain days attached to events). */
  wetDaysUsed: number;
}): Flag[] {
  const { today, settings: s } = input;
  const out: Flag[] = [];
  const live = input.events.filter((e) => LIVE_STATUSES.includes(e.status));
  const estimated = s.confirmed
    ? ''
    : ' (estimated from the default, not yet checked against the contract)';

  for (const e of live) {
    const c = clocks(e, s, today);
    const ref = eventRef(e.number);
    if (e.noticeSentOn === null && e.status === 'draft') {
      if (c.notice.state === 'overdue')
        out.push({
          kind: 'notice_overdue',
          severity: 'high',
          eventId: e.id,
          message: `${ref}: the notice period ended on ${fmt(c.notice.dueOn)}${estimated}. Check the contract and give notice now with what is known.`,
        });
      else if (c.notice.state === 'due_today' || c.notice.state === 'due_soon')
        out.push({
          kind: 'notice_due_soon',
          severity:
            c.notice.state === 'due_today' || (c.notice.daysLeft ?? 9) <= 1 ? 'high' : 'medium',
          eventId: e.id,
          message: `${ref}: notice period ends ${fmt(c.notice.dueOn)}, ${plural(c.notice.daysLeft ?? 0, 'day')} left${estimated}.`,
        });
    }
    if (e.claimSentOn === null && (e.status === 'draft' || e.status === 'notice_given')) {
      if (c.claim.state === 'overdue')
        out.push({
          kind: 'claim_overdue',
          severity: 'high',
          eventId: e.id,
          message: `${ref}: the claim period ended on ${fmt(c.claim.dueOn)}${estimated}. Check the contract and send the claim with what is known.`,
        });
      else if (c.claim.state === 'due_today' || c.claim.state === 'due_soon')
        out.push({
          kind: 'claim_due_soon',
          severity: (c.claim.daysLeft ?? 9) <= 1 ? 'high' : 'medium',
          eventId: e.id,
          message: `${ref}: claim period ends ${fmt(c.claim.dueOn)}, ${plural(c.claim.daysLeft ?? 0, 'day')} left${estimated}.`,
        });
    }
    if (e.evidence.items === 0 && e.status !== 'assessed')
      out.push({
        kind: 'no_evidence',
        severity: 'medium',
        eventId: e.id,
        message: `${ref} has no evidence attached. Add the diary days, RFIs and notices that support it.`,
      });
    const span = spanDays(e.startedOn, e.endedOn, today);
    if (e.daysClaimed > span)
      out.push({
        kind: 'days_over_span',
        severity: 'low',
        eventId: e.id,
        message: `${ref} claims ${plural(e.daysClaimed, 'day')} but the event spans ${plural(span, 'day')}. Check the dates or add the reasoning to the claim.`,
      });
    if (e.status === 'claimed' && e.claimSentOn && daysBetween(e.claimSentOn, today) >= 28)
      out.push({
        kind: 'assessment_waiting',
        severity: 'low',
        eventId: e.id,
        message: `${ref}: claim sent ${fmt(e.claimSentOn)}, ${plural(daysBetween(e.claimSentOn, today), 'day')} ago, with no assessment recorded. Check the contract for the response time and follow up.`,
      });
  }

  // Delays the site marked as possible EOT that no event covers yet, while the notice period is running down.
  const tracked = input.untracked
    .map((u) => ({ ...u, left: daysBetween(today, addPeriod(u.date, s.noticeDays, s.dayBasis)) }))
    .filter((u) => u.left <= 7)
    .sort((a, b) => a.left - b.left);
  for (const u of tracked.slice(0, 10))
    out.push({
      kind: 'untracked_delay',
      severity: u.left <= 1 ? 'high' : 'medium',
      eventId: null,
      message:
        u.left < 0
          ? `${fmt(u.date)}: "${u.label}" is marked as a possible EOT and is in no delay event. A notice period counted from that day ended ${fmt(addPeriod(u.date, s.noticeDays, s.dayBasis))}${estimated}.`
          : `${fmt(u.date)}: "${u.label}" is marked as a possible EOT and is in no delay event. A notice period counted from that day ends in ${plural(u.left, 'day')}${estimated}.`,
    });

  if (s.wetDayAllowance !== null && input.wetDaysUsed > s.wetDayAllowance)
    out.push({
      kind: 'wet_days_over_allowance',
      severity: 'low',
      eventId: null,
      message: `${plural(input.wetDaysUsed, 'rain day')} attached to events against a contract allowance of ${s.wetDayAllowance}. Check how the contract counts wet days.`,
    });
  if (!s.confirmed && input.events.length + input.untracked.length > 0)
    out.push({
      kind: 'periods_unconfirmed',
      severity: 'low',
      eventId: null,
      message: `The notice and claim periods are the ${FORM_DEFAULTS[s.form].label} defaults. Check your contract and its special conditions, then confirm them in the settings.`,
    });

  const rank = { high: 0, medium: 1, low: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// ------------------------------------------------------------------------------------------------ Nova drafts

export interface DraftInput {
  kind: 'notice' | 'claim';
  projectName: string;
  senderName: string;
  today: LocalDate;
  settings: EotSettings;
  event: {
    number: number;
    title: string;
    cause: DelayCause;
    startedOn: LocalDate;
    endedOn: LocalDate | null;
    awareOn: LocalDate;
    daysClaimed: number;
    criticalPath: boolean | null;
    summary: string | null;
    affected: string | null;
    noticeSentOn: LocalDate | null;
    noticeRefLabel: string | null;
  };
  items: readonly EvidenceItem[];
}

export interface Draft {
  subject: string;
  body: string;
  /** Things a person should look at before sending. */
  warnings: string[];
}

const KIND_LABEL: Record<ItemKind, string> = {
  diary_delay: 'Site diary',
  rfi_impact: 'RFI',
  rfi_late: 'RFI answered late',
  weather_day: 'Weather',
  correspondence: 'Correspondence',
  note: 'Note',
};

function evidenceLines(items: readonly EvidenceItem[]): string[] {
  const sorted = [...items].sort((a, b) =>
    (a.onDate ?? '9999') === (b.onDate ?? '9999')
      ? 0
      : (a.onDate ?? '9999') < (b.onDate ?? '9999')
        ? -1
        : 1,
  );
  return sorted.map((i) => {
    const when = i.onDate ? `${fmt(i.onDate)}: ` : '';
    const lost =
      i.hours !== null
        ? ` (${i.hours} h lost)`
        : i.days !== null
          ? ` (${plural(i.days, 'day')})`
          : i.rainMm !== null
            ? ` (${i.rainMm} mm rain)`
            : '';
    const extra = i.detail ? ` - ${i.detail}` : '';
    return `- ${when}${KIND_LABEL[i.kind]}: ${i.label}${lost}${extra}`;
  });
}

/**
 * A notice of delay or EOT claim for a person to read, edit and send. It leans towards sending early with what is known
 * (courts generally enforce contract time bars), quotes the evidence and leaves anything unknown as a [placeholder].
 */
export function draftEotLetter(i: DraftInput): Draft {
  const { event: e, settings: s, items } = i;
  const ref = eventRef(e.number);
  const ev = summariseEvidence(items);
  const clause = (c: string | null) => c ?? '[clause number]';
  const warnings: string[] = [];
  if (!s.confirmed)
    warnings.push(
      `The ${i.kind === 'notice' ? 'notice' : 'claim'} period is the ${FORM_DEFAULTS[s.form].label} default. Check your contract and its special conditions.`,
    );
  if (items.length === 0)
    warnings.push('No evidence is attached to this event, so the letter has nothing to quote.');
  if (i.kind === 'claim' && e.daysClaimed === 0)
    warnings.push('Days claimed is 0. Enter the days you are claiming before sending.');
  if (i.kind === 'claim' && !e.noticeSentOn)
    warnings.push(
      'No notice of delay is recorded for this event. Check whether the contract needs one first.',
    );
  if (i.kind === 'claim' && e.criticalPath === null)
    warnings.push(
      'The effect on the critical path is not recorded. The letter leaves it for you to fill in.',
    );
  if (!e.endedOn) warnings.push('The delay has no end date, so the letter says it is continuing.');

  const weather = items.filter((x) => x.kind === 'weather_day');
  const weatherPara = weather.length
    ? `\nWeather: the site diary records rain on ${plural(weather.length, 'day')} in this period (${ev.rainMm} mm in total, against a ${s.rainThresholdMm} mm rain-day threshold).\n`
    : '';
  const period = e.endedOn
    ? `from ${fmt(e.startedOn)} to ${fmt(e.endedOn)}`
    : `from ${fmt(e.startedOn)} and continuing`;
  const records = items.length
    ? `Supporting records:\n${evidenceLines(items).join('\n')}\n`
    : 'Supporting records: [diary entries, RFIs, photos, correspondence]\n';
  const head = `${fmt(i.today)}\n\nTo: [Superintendent / Principal]\nProject: ${i.projectName}\nContract: [contract name and number]. Clause: ${clause(i.kind === 'notice' ? s.noticeClause : s.claimClause)}\nOur reference: ${ref}\n`;
  const sign = `\nRegards,\n${i.senderName}\n\nDraft prepared with Nova from the site records. Check it against the contract before sending.`;

  if (i.kind === 'notice') {
    const body = `${head}
NOTICE OF DELAY

We give notice under the Contract that the work under the Contract is being delayed, or is likely to be.

Event: ${e.title}
Cause of delay: ${CAUSE_LABEL[e.cause]}${e.summary ? `\nWhat happened: ${e.summary}` : ''}
Date we became aware: ${fmt(e.awareOn)}
Date the delay began: ${fmt(e.startedOn)}
${e.endedOn ? `Date the delay ended: ${fmt(e.endedOn)}` : 'The delay is continuing.'}
Activities and areas affected: ${e.affected ?? '[activities / areas]'}
Expected effect on the date for practical completion: ${e.daysClaimed > 0 ? `up to ${plural(e.daysClaimed, 'day')} on present information, to be confirmed in our claim` : 'to be advised'}
${weatherPara}
${records}
This notice is given on the information available now. We will add detail as it becomes known, and we will submit a claim for an extension of time within the period the Contract allows.
${sign}`;
    return { subject: `Notice of delay: ${e.title} (${ref})`, body, warnings };
  }

  const noticeRef = e.noticeRefLabel
    ? e.noticeRefLabel
    : e.noticeSentOn
      ? `notice of delay given ${fmt(e.noticeSentOn)}`
      : '[number and date]';
  const critical =
    e.criticalPath === true
      ? 'The delay is on the critical path.'
      : e.criticalPath === false
        ? 'The delay is not on the critical path on our assessment: [explain].'
        : '[explain the effect on the critical path]';
  const body = `${head}
CLAIM FOR EXTENSION OF TIME

Reference notice of delay: ${noticeRef}
Event: ${e.title}
Cause and qualifying event: ${CAUSE_LABEL[e.cause]}${e.summary ? `. ${e.summary}` : ''} [clause it falls under]
Date we became aware: ${fmt(e.awareOn)}
Period of delay: ${period}
Activities and areas affected: ${e.affected ?? '[activities / areas]'}
Days claimed: ${e.daysClaimed > 0 ? e.daysClaimed : '[number]'}
Effect on the critical path: ${critical}
${weatherPara}
${records}
We request that the date for practical completion be extended by the days claimed above.
${sign}`;
  return { subject: `Extension of time claim: ${e.title} (${ref})`, body, warnings };
}
