// Regulator evidence pack: the safety records of one project for a date range, in the form a WHS regulator asks for
// during an audit or after an incident, and the pre-check that finds what is missing before it is handed over.
// Pure, no IO. The gap check is plain rules: it says what the records show, never that the site is compliant.

export const SECTION_LIMIT = 2000;

export interface Section<T> {
  /** The caller may not read this tool on the project, so the pack leaves it out (and says so). */
  restricted: boolean;
  truncated: boolean;
  rows: readonly T[];
}

export interface PackIncident {
  ref: string;
  title: string;
  type: string;
  severity: string;
  occurredAt: string;
  location: string | null;
  status: 'reported' | 'investigating' | 'closed';
  isNotifiable: boolean;
  notifiableClass: string | null;
  regulatorNotifiedAt: string | null;
  writtenNoticeRequestedAt: string | null;
  hasRootCause: boolean;
  closedAt: string | null;
}

export interface PackAction {
  incidentRef: string;
  number: number;
  title: string;
  dueDate: string | null;
  status: 'open' | 'done' | 'verified';
  completedAt: string | null;
  verifiedAt: string | null;
}

export interface PackPretask {
  ref: string;
  taskTitle: string;
  workDate: string;
  location: string | null;
  supervisorName: string;
  status: 'open' | 'closed';
  hazards: number;
  hazardsWithoutControls: number;
  crew: number;
  signed: number;
  notCurrentlyInducted: number;
  reviewed: boolean;
}

export interface PackToolbox {
  ref: string;
  title: string;
  heldOn: string;
  presenterName: string;
  status: 'open' | 'closed';
  attendees: number;
  signed: number;
}

export interface PackInduction {
  workerName: string;
  completedOn: string;
  quizScore: number | null;
  expiresOn: string | null;
  method: 'self' | 'assisted' | 'link';
}

export interface PackInspection {
  ref: string;
  title: string;
  status: string;
  scheduledFor: string | null;
  completedOn: string | null;
  pass: number;
  fail: number;
}

export interface EvidenceSources {
  incidents: Section<PackIncident>;
  actions: Section<PackAction>;
  pretasks: Section<PackPretask>;
  toolbox: Section<PackToolbox>;
  inductions: Section<PackInduction>;
  inspections: Section<PackInspection>;
}

export type GapSeverity = 'high' | 'medium' | 'low';
export interface Gap {
  section: keyof EvidenceSources | 'pack';
  severity: GapSeverity;
  message: string;
}

export interface EvidencePack extends EvidenceSources {
  project: { name: string; number: string | null; timeZone: string };
  from: string;
  to: string;
  generatedOn: string;
  gaps: Gap[];
}

export const SECTION_LABELS: Record<keyof EvidenceSources, string> = {
  incidents: 'Incidents',
  actions: 'Corrective actions',
  pretasks: 'Pre-task plans',
  toolbox: 'Toolbox talks',
  inductions: 'Site inductions',
  inspections: 'Inspections',
};

const SEVERITY_RANK: Record<GapSeverity, number> = { high: 0, medium: 1, low: 2 };

const day = (iso: string) => iso.slice(0, 10);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Weeks (7 days from `from`) inside the range with no toolbox talk held. Only meaningful for a range of 14+ days. */
export function weeksWithoutTalk(from: string, to: string, held: readonly string[]): string[] {
  if (addDays(from, 13) > to) return [];
  const out: string[] = [];
  for (let start = from; addDays(start, 6) <= to; start = addDays(start, 7)) {
    const end = addDays(start, 6);
    if (!held.some((d) => d >= start && d <= end)) out.push(start);
  }
  return out;
}

/** What is missing or open in the records, worst first. `today` is the project's local date. */
export function findGaps(
  s: EvidenceSources,
  range: { from: string; to: string },
  today: string,
): Gap[] {
  const gaps: Gap[] = [];
  const add = (section: Gap['section'], severity: GapSeverity, message: string) =>
    gaps.push({ section, severity, message });

  for (const key of Object.keys(SECTION_LABELS) as (keyof EvidenceSources)[]) {
    const sec = s[key];
    if (sec.restricted)
      add(
        key,
        'high',
        `You cannot read ${SECTION_LABELS[key].toLowerCase()} on this project, so they are left out of the pack.`,
      );
    else if (sec.truncated)
      add(
        key,
        'medium',
        `${SECTION_LABELS[key]} hit the ${SECTION_LIMIT} row limit. Narrow the dates so nothing is cut off.`,
      );
  }
  const readable = (Object.keys(SECTION_LABELS) as (keyof EvidenceSources)[]).filter(
    (k) => !s[k].restricted,
  );
  if (readable.length > 0 && readable.every((k) => s[k].rows.length === 0))
    add('pack', 'high', 'No safety records fall in these dates. Check the date range.');

  if (!s.incidents.restricted)
    for (const i of s.incidents.rows) {
      if (i.isNotifiable && !i.regulatorNotifiedAt)
        add(
          'incidents',
          'high',
          `${i.ref} is notifiable but no regulator notification time is recorded.`,
        );
      if (i.isNotifiable && i.writtenNoticeRequestedAt && i.status !== 'closed')
        add('incidents', 'medium', `${i.ref}: written notice was requested and is not yet closed.`);
      if (i.status === 'closed' && !i.hasRootCause)
        add('incidents', 'medium', `${i.ref} is closed with no root cause recorded.`);
      if (i.status !== 'closed')
        add('incidents', 'medium', `${i.ref} is still ${i.status}, with its investigation open.`);
    }

  if (!s.actions.restricted) {
    for (const a of s.actions.rows) {
      const label = `${a.incidentRef} action ${a.number}`;
      if (a.status !== 'verified' && a.dueDate !== null && a.dueDate < today)
        add('actions', 'high', `${label} is overdue (due ${a.dueDate}) and not verified.`);
      else if (a.status !== 'verified' && a.dueDate === null)
        add('actions', 'low', `${label} has no due date and is not verified.`);
    }
  }

  if (!s.pretasks.restricted)
    for (const p of s.pretasks.rows) {
      if (p.hazards === 0) add('pretasks', 'high', `${p.ref} has no hazards recorded.`);
      else if (p.hazardsWithoutControls > 0)
        add(
          'pretasks',
          'high',
          `${p.ref} has ${plural(p.hazardsWithoutControls, 'hazard')} with no controls.`,
        );
      if (p.crew === 0) add('pretasks', 'medium', `${p.ref} has no crew on it.`);
      else if (p.signed < p.crew)
        add('pretasks', 'medium', `${p.ref}: ${p.crew - p.signed} of ${p.crew} crew did not sign.`);
      if (p.notCurrentlyInducted > 0)
        add(
          'pretasks',
          'medium',
          `${p.ref}: ${plural(p.notCurrentlyInducted, 'crew member')} had no current site induction when signing.`,
        );
      if (p.status === 'open' && p.workDate < today)
        add('pretasks', 'medium', `${p.ref} (${p.workDate}) was never closed.`);
    }

  if (!s.toolbox.restricted) {
    for (const t of s.toolbox.rows) {
      if (t.attendees === 0) add('toolbox', 'medium', `${t.ref} has no attendees recorded.`);
      else if (t.signed < t.attendees)
        add(
          'toolbox',
          'low',
          `${t.ref}: ${t.attendees - t.signed} of ${t.attendees} attendees did not sign.`,
        );
    }
    const quiet = weeksWithoutTalk(
      range.from,
      range.to,
      s.toolbox.rows.map((t) => t.heldOn),
    );
    if (quiet.length > 0)
      add(
        'toolbox',
        'low',
        `No toolbox talk in ${plural(quiet.length, 'week')} (from ${quiet.slice(0, 4).join(', ')}${quiet.length > 4 ? ' and later' : ''}).`,
      );
  }

  if (!s.inductions.restricted)
    for (const i of s.inductions.rows)
      if (i.expiresOn !== null && i.expiresOn < range.to)
        add('inductions', 'medium', `${i.workerName}'s induction expired on ${i.expiresOn}.`);

  if (!s.inspections.restricted)
    for (const i of s.inspections.rows) {
      const done = i.status === 'submitted' || i.status === 'closed';
      if (!done && i.scheduledFor !== null && i.scheduledFor < today)
        add(
          'inspections',
          'medium',
          `${i.ref} was scheduled for ${i.scheduledFor} and is not complete.`,
        );
      if (i.fail > 0 && i.status !== 'closed')
        add(
          'inspections',
          'medium',
          `${i.ref} has ${plural(i.fail, 'failed item')} and is not closed.`,
        );
    }

  return gaps.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

export interface PdfLine {
  style: 'title' | 'heading' | 'body' | 'small';
  text: string;
}

const tick = (b: boolean) => (b ? 'yes' : 'no');

/** The pack as lines for the PDF: cover, what Nova found, then each section as a list. */
export function packLines(p: EvidencePack): PdfLine[] {
  const L: PdfLine[] = [];
  const line = (style: PdfLine['style'], text: string) => L.push({ style, text });
  line('title', 'Safety evidence pack');
  line('body', `${p.project.name}${p.project.number ? ` (${p.project.number})` : ''}`);
  line(
    'body',
    `Records from ${p.from} to ${p.to}. Prepared ${p.generatedOn} (${p.project.timeZone}).`,
  );
  line(
    'small',
    'Copied from the project records as they stand on the day it was prepared. It records what was entered; it does not say the site complied. Archova does not notify the regulator: the dates shown are the ones the builder entered.',
  );

  line('heading', 'Contents');
  for (const k of Object.keys(SECTION_LABELS) as (keyof EvidenceSources)[])
    line(
      'body',
      `${SECTION_LABELS[k]}: ${p[k].restricted ? 'not included (no access)' : p[k].rows.length}`,
    );

  line('heading', 'Gaps found before export');
  if (p.gaps.length === 0) line('body', 'None found by the pre-check.');
  for (const g of p.gaps) line('body', `[${g.severity}] ${g.message}`);

  const section = <T>(key: keyof EvidenceSources, rows: readonly T[], f: (r: T) => string) => {
    line('heading', SECTION_LABELS[key]);
    if (p[key].restricted)
      line('body', 'Not included: the person who prepared this pack cannot read it.');
    else if (rows.length === 0) line('body', 'No records in these dates.');
    for (const r of rows) line('body', f(r));
  };
  section(
    'incidents',
    p.incidents.rows,
    (i) =>
      `${i.ref} ${i.occurredAt.slice(0, 16).replace('T', ' ')} UTC. ${i.title}. ${i.type}, ${i.severity}, ${i.status}. Notifiable: ${tick(i.isNotifiable)}${i.notifiableClass ? ` (${i.notifiableClass})` : ''}. Regulator notified: ${i.regulatorNotifiedAt ?? 'not recorded'}. Root cause recorded: ${tick(i.hasRootCause)}.${i.location ? ` Location: ${i.location}.` : ''}`,
  );
  section(
    'actions',
    p.actions.rows,
    (a) =>
      `${a.incidentRef} action ${a.number}: ${a.title}. Due ${a.dueDate ?? 'not set'}. ${a.status}${a.verifiedAt ? ` (verified ${day(a.verifiedAt)})` : a.completedAt ? ` (done ${day(a.completedAt)})` : ''}.`,
  );
  section(
    'pretasks',
    p.pretasks.rows,
    (t) =>
      `${t.ref} ${t.workDate}. ${t.taskTitle}. Supervisor ${t.supervisorName}. ${t.status}. ${plural(t.hazards, 'hazard')}, crew signed ${t.signed} of ${t.crew}, reviewed: ${tick(t.reviewed)}.${t.location ? ` Location: ${t.location}.` : ''}`,
  );
  section(
    'toolbox',
    p.toolbox.rows,
    (t) =>
      `${t.ref} ${t.heldOn}. ${t.title}. Presenter ${t.presenterName}. ${t.status}. Signed ${t.signed} of ${t.attendees}.`,
  );
  section(
    'inductions',
    p.inductions.rows,
    (i) =>
      `${i.workerName}. Completed ${i.completedOn}${i.quizScore !== null ? `, quiz ${i.quizScore}%` : ''}, ${i.method}. Valid to ${i.expiresOn ?? 'no expiry'}.`,
  );
  section(
    'inspections',
    p.inspections.rows,
    (i) =>
      `${i.ref} ${i.title}. ${i.status}. Scheduled ${i.scheduledFor ?? 'n/a'}, completed ${i.completedOn ?? 'not yet'}. Pass ${i.pass}, fail ${i.fail}.`,
  );
  return L;
}
