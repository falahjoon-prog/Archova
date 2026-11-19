// Writes a programme as MS Project XML (MSPDI) so a planner can open it in Project or send it to a subcontractor.
// Pure: dates and ids in, one XML string out. The reader on the API side (`parseMspXml`) reads this same shape back.
import type { ScheduleActivity, ScheduleDependency, ScheduleDetail } from '../data/programme';

// XML 1.0 cannot carry most control characters, so they are dropped rather than escaped.
const isXmlSafe = (ch: string) => {
  const c = ch.charCodeAt(0);
  return c >= 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
};
const escapeXml = (s: string) =>
  [...s]
    .filter(isXmlSafe)
    .join('')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// MS Project link types: 0 FF, 1 FS, 2 SF, 3 SS.
const LINK_TYPE: Record<ScheduleDependency['type'], number> = { FF: 0, FS: 1, SF: 2, SS: 3 };

// A working day is 8 hours; lag is held in tenths of a minute (480 minutes a day), with LagFormat 7 meaning days.
const MINUTES_PER_DAY = 480;
const hours = (days: number) => `PT${Math.max(0, Math.round(days)) * 8}H0M0S`;

function taskXml(a: ScheduleActivity, uid: number, preds: string): string {
  const milestone = a.kind === 'milestone';
  return [
    '<Task>',
    `<UID>${uid}</UID>`,
    `<ID>${uid}</ID>`,
    `<Name>${escapeXml(a.name)}</Name>`,
    '<Type>0</Type>',
    '<IsNull>0</IsNull>',
    `<WBS>${escapeXml(a.wbs || String(uid))}</WBS>`,
    `<OutlineNumber>${escapeXml(a.wbs || String(uid))}</OutlineNumber>`,
    '<OutlineLevel>1</OutlineLevel>',
    `<Start>${a.start}T08:00:00</Start>`,
    `<Finish>${a.finish}T${milestone ? '08' : '17'}:00:00</Finish>`,
    `<Duration>${hours(milestone ? 0 : a.durationDays)}</Duration>`,
    '<DurationFormat>7</DurationFormat>',
    `<PercentComplete>${Math.min(100, Math.max(0, Math.round(a.pctComplete)))}</PercentComplete>`,
    `<Milestone>${milestone ? 1 : 0}</Milestone>`,
    '<Summary>0</Summary>',
    '<ConstraintType>0</ConstraintType>',
    preds,
    '</Task>',
  ].join('');
}

/** The programme as an MS Project XML document (File > Open in Project). Activity ids become task UIDs 1..n. */
export function buildMspXml(detail: ScheduleDetail): string {
  const { schedule, activities, dependencies } = detail;
  const uidOf = new Map(activities.map((a, i) => [a.id, i + 1]));
  const predsOf = new Map<number, string[]>();
  for (const d of dependencies) {
    const pred = uidOf.get(d.predecessorId);
    const succ = uidOf.get(d.successorId);
    if (!pred || !succ) continue;
    const list = predsOf.get(succ) ?? [];
    list.push(
      `<PredecessorLink><PredecessorUID>${pred}</PredecessorUID><Type>${LINK_TYPE[d.type]}</Type>` +
        `<CrossProject>0</CrossProject><LinkLag>${Math.round(d.lagDays * MINUTES_PER_DAY * 10)}</LinkLag>` +
        '<LagFormat>7</LagFormat></PredecessorLink>',
    );
    predsOf.set(succ, list);
  }
  const starts = activities.map((a) => a.start).sort();
  const finishes = activities.map((a) => a.finish).sort();
  const first = starts[0] ?? schedule.startDate ?? '2000-01-01';
  const last = finishes[finishes.length - 1] ?? schedule.finishDate ?? first;
  const name = escapeXml(schedule.name);
  const weekday = (day: number, working: boolean) =>
    `<WeekDay><DayType>${day}</DayType><DayWorking>${working ? 1 : 0}</DayWorking>${
      working
        ? '<WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes>'
        : ''
    }</WeekDay>`;
  const tasks = [
    // UID 0 is the project summary row Project expects first.
    `<Task><UID>0</UID><ID>0</ID><Name>${name}</Name><Type>1</Type><IsNull>0</IsNull><OutlineLevel>0</OutlineLevel>` +
      `<Start>${first}T08:00:00</Start><Finish>${last}T17:00:00</Finish><Summary>1</Summary></Task>`,
    ...activities.map((a, i) => taskXml(a, i + 1, (predsOf.get(i + 1) ?? []).join(''))),
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Project xmlns="http://schemas.microsoft.com/project">',
    '<SaveVersion>14</SaveVersion>',
    `<Name>${name}</Name>`,
    `<Title>${name}</Title>`,
    '<ScheduleFromStart>1</ScheduleFromStart>',
    `<StartDate>${first}T08:00:00</StartDate>`,
    `<FinishDate>${last}T17:00:00</FinishDate>`,
    '<MinutesPerDay>480</MinutesPerDay><MinutesPerWeek>2400</MinutesPerWeek><DaysPerMonth>20</DaysPerMonth>',
    '<DefaultStartTime>08:00:00</DefaultStartTime><DefaultFinishTime>17:00:00</DefaultFinishTime>',
    '<CalendarUID>1</CalendarUID>',
    '<Calendars><Calendar><UID>1</UID><Name>Standard</Name><IsBaseCalendar>1</IsBaseCalendar><WeekDays>',
    weekday(1, false),
    ...[2, 3, 4, 5, 6].map((d) => weekday(d, true)),
    weekday(7, false),
    '</WeekDays></Calendar></Calendars>',
    `<Tasks>${tasks.join('')}</Tasks>`,
    '</Project>',
  ].join('');
}

/** A safe file name for the download: `Master programme rev 2` becomes `master-programme-rev-2.xml`. */
export function mspFileName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'programme'}.xml`;
}
