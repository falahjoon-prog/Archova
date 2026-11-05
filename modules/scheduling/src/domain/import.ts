// Readers for MS Project XML and Primavera P6 XER (product/08 SCH-AC6). They read what the planner typed: dates, names,
// percent complete, WBS and the logic links. Summary and WBS rows are left out; links to them are dropped.
import type { LocalDate } from '@archova/time';
import { isLocalDate } from '@archova/time';
import type { DepType } from './programme';

export const MAX_ACTIVITIES = 5000;

export interface ImportedActivity {
  externalId: string;
  wbs: string;
  name: string;
  kind: 'task' | 'milestone';
  start: LocalDate;
  finish: LocalDate;
  pctComplete: number;
}
export interface ImportedLink {
  predecessor: string;
  successor: string;
  type: DepType;
  lagDays: number;
}
export interface ImportedProgramme {
  name: string | null;
  dataDate: LocalDate | null;
  activities: ImportedActivity[];
  links: ImportedLink[];
  /** Rows or links the reader had to leave out, with a reason a person can act on. */
  skipped: string[];
}

export class ImportError extends Error {}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');

function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block);
  return m ? decode(m[1]!.trim()) : null;
}
const dateOf = (v: string | null): LocalDate | null => {
  const d = v?.slice(0, 10) ?? '';
  return isLocalDate(d) ? d : null;
};
const clampPct = (n: number) =>
  Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 0;

const MSP_LINK: Record<string, DepType> = { '0': 'FF', '1': 'FS', '2': 'SF', '3': 'SS' };

/** Reads the `Tasks` of an MS Project XML export (File > Save As > XML). Lag is read in working days of 8 hours. */
export function parseMspXml(xml: string): ImportedProgramme {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new ImportError('The file declares a DTD, which is not accepted.');
  if (!/<Project[\s>]/.test(xml) || !xml.includes('<Tasks>'))
    throw new ImportError(
      'This does not look like an MS Project XML file (no <Project> with <Tasks>).',
    );
  const skipped: string[] = [];
  const activities: ImportedActivity[] = [];
  const links: ImportedLink[] = [];
  const taskBlocks = xml.match(/<Task>[\s\S]*?<\/Task>/g) ?? [];
  const kept = new Set<string>();
  const head = xml.slice(0, xml.indexOf('<Tasks>'));
  for (const block of taskBlocks) {
    const uid = tag(block.replace(/<PredecessorLink>[\s\S]*?<\/PredecessorLink>/g, ''), 'UID');
    if (!uid || uid === '0') continue; // 0 is the project summary row
    const name = tag(block, 'Name');
    if (tag(block, 'Summary') === '1') continue;
    if (!name) {
      skipped.push(`Task ${uid} has no name`);
      continue;
    }
    const start = dateOf(tag(block, 'Start'));
    let finish = dateOf(tag(block, 'Finish'));
    if (!start || !finish) {
      skipped.push(`"${name}" has no dates`);
      continue;
    }
    const milestone = tag(block, 'Milestone') === '1';
    if (milestone) finish = start;
    if (finish < start) {
      skipped.push(`"${name}" finishes before it starts`);
      continue;
    }
    kept.add(uid);
    activities.push({
      externalId: uid,
      wbs: tag(block, 'WBS') ?? tag(block, 'OutlineNumber') ?? '',
      name: name.slice(0, 300),
      kind: milestone ? 'milestone' : 'task',
      start,
      finish,
      pctComplete: clampPct(Number(tag(block, 'PercentComplete') ?? 0)),
    });
    for (const l of block.match(/<PredecessorLink>[\s\S]*?<\/PredecessorLink>/g) ?? []) {
      const pred = tag(l, 'PredecessorUID');
      if (!pred) continue;
      const lagTenthsOfMinute = Number(tag(l, 'LinkLag') ?? 0);
      links.push({
        predecessor: pred,
        successor: uid,
        type: MSP_LINK[tag(l, 'Type') ?? '1'] ?? 'FS',
        lagDays: Math.round(lagTenthsOfMinute / 10 / 480) || 0,
      });
    }
    if (activities.length > MAX_ACTIVITIES)
      throw new ImportError(`More than ${MAX_ACTIVITIES} activities; split the programme.`);
  }
  if (!activities.length) throw new ImportError('The file has no tasks with dates.');
  return {
    name: tag(head, 'Title') ?? tag(head, 'Name'),
    dataDate: dateOf(tag(head, 'StatusDate') ?? tag(head, 'CurrentDate')),
    activities,
    links: links.filter((l) => {
      const ok = kept.has(l.predecessor) && kept.has(l.successor);
      if (!ok)
        skipped.push(
          `A link to a summary or missing task (${l.predecessor} -> ${l.successor}) was dropped`,
        );
      return ok;
    }),
    skipped,
  };
}

interface XerTable {
  fields: string[];
  rows: Array<Record<string, string>>;
}

function readXer(text: string): Record<string, XerTable> {
  const tables: Record<string, XerTable> = {};
  let current: XerTable | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const cols = raw.split('\t');
    const code = cols[0];
    if (code === '%T') {
      current = { fields: [], rows: [] };
      tables[cols[1]!.trim()] = current;
    } else if (code === '%F' && current) {
      current.fields = cols.slice(1).map((c) => c.trim());
    } else if (code === '%R' && current) {
      const row: Record<string, string> = {};
      current.fields.forEach((f, i) => (row[f] = (cols[i + 1] ?? '').trim()));
      current.rows.push(row);
    }
  }
  return tables;
}

const XER_LINK: Record<string, DepType> = { PR_FS: 'FS', PR_SS: 'SS', PR_FF: 'FF', PR_SF: 'SF' };

/** Reads a Primavera P6 XER export: TASK for the activities, TASKPRED for the logic, PROJWBS for the WBS codes. */
export function parseXer(text: string): ImportedProgramme {
  if (!/^ERMHDR/m.test(text))
    throw new ImportError('This does not look like a P6 XER file (no ERMHDR header).');
  const t = readXer(text);
  const tasks = t.TASK?.rows ?? [];
  if (!tasks.length) throw new ImportError('The file has no TASK table.');
  const wbsCode = new Map<string, string>();
  const wbsRows = t.PROJWBS?.rows ?? [];
  const wbsById = new Map(wbsRows.map((w) => [w.wbs_id!, w]));
  const wbsPath = (id: string): string => {
    const parts: string[] = [];
    let w = wbsById.get(id);
    for (let guard = 0; w && guard < 50; guard++) {
      if (w.parent_wbs_id) parts.unshift(w.wbs_short_name ?? '');
      w = wbsById.get(w.parent_wbs_id ?? '');
    }
    return parts.filter(Boolean).join('.');
  };
  for (const w of wbsRows) wbsCode.set(w.wbs_id!, wbsPath(w.wbs_id!));
  const skipped: string[] = [];
  const activities: ImportedActivity[] = [];
  const kept = new Set<string>();
  for (const r of tasks) {
    const type = r.task_type ?? 'TT_Task';
    if (type === 'TT_WBS') continue;
    const name = r.task_name;
    if (!r.task_id || !name) continue;
    let start = dateOf(r.act_start_date || r.early_start_date || r.target_start_date || null);
    let finish = dateOf(r.act_end_date || r.early_end_date || r.target_end_date || null);
    // A start milestone carries only a start date and a finish milestone only a finish date.
    if (type === 'TT_Mile') finish = start;
    if (type === 'TT_FinMile') start = finish;
    if (!start || !finish) {
      skipped.push(`"${name}" has no dates`);
      continue;
    }
    const milestone = type === 'TT_Mile' || type === 'TT_FinMile';
    if (finish < start) {
      skipped.push(`"${name}" finishes before it starts`);
      continue;
    }
    kept.add(r.task_id);
    const pct = r.phys_complete_pct ? Number(r.phys_complete_pct) : r.act_end_date ? 100 : 0;
    const wbs = wbsCode.get(r.wbs_id ?? '') ?? '';
    activities.push({
      externalId: r.task_id,
      wbs: [wbs, r.task_code].filter(Boolean).join(' · ').slice(0, 100),
      name: name.slice(0, 300),
      kind: milestone ? 'milestone' : 'task',
      start,
      finish,
      pctComplete: clampPct(pct),
    });
    if (activities.length > MAX_ACTIVITIES)
      throw new ImportError(`More than ${MAX_ACTIVITIES} activities; split the programme.`);
  }
  if (!activities.length) throw new ImportError('The file has no activities with dates.');
  const links: ImportedLink[] = [];
  for (const r of t.TASKPRED?.rows ?? []) {
    const type = XER_LINK[r.pred_type ?? 'PR_FS'];
    if (!type || !r.task_id || !r.pred_task_id) continue;
    if (!kept.has(r.task_id) || !kept.has(r.pred_task_id)) {
      skipped.push(
        `A link to a WBS or missing activity (${r.pred_task_id} -> ${r.task_id}) was dropped`,
      );
      continue;
    }
    links.push({
      predecessor: r.pred_task_id,
      successor: r.task_id,
      type,
      lagDays: Math.round(Number(r.lag_hr_cnt || 0) / 8) || 0,
    });
  }
  const project = t.PROJECT?.rows[0];
  return {
    name: project?.proj_short_name || null,
    dataDate: dateOf(project?.last_recalc_date ?? null),
    activities,
    links,
    skipped,
  };
}
