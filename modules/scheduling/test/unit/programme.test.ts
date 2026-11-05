import { describe, expect, it } from 'vitest';
import { ImportError, parseMspXml, parseXer } from '../../src/domain/import';
import {
  addWorkDays,
  analyse,
  cascade,
  lookahead,
  varianceDays,
  wouldCycle,
  workingDays,
  type ActivityInput,
  type DependencyInput,
} from '../../src/domain/programme';

const act = (
  id: string,
  start: string,
  finish: string,
  extra: Partial<ActivityInput> = {},
): ActivityInput => ({
  id,
  wbs: '',
  name: id,
  kind: 'task',
  start,
  finish,
  pctComplete: 0,
  assignee: '',
  ...extra,
});
const dep = (
  id: string,
  p: string,
  s: string,
  type: DependencyInput['type'] = 'FS',
  lagDays = 0,
): DependencyInput => ({
  id,
  predecessorId: p,
  successorId: s,
  type,
  lagDays,
});

describe('working days', () => {
  it('counts Monday to Friday inclusive and skips weekends', () => {
    expect(workingDays('2026-11-02', '2026-11-06')).toBe(5);
    expect(workingDays('2026-11-02', '2026-11-09')).toBe(6);
    expect(workingDays('2026-11-06', '2026-11-09')).toBe(2);
    expect(workingDays('2026-11-07', '2026-11-07')).toBe(0);
  });
});

describe('float and critical path', () => {
  // A (Mon-Wed) -> B (Thu-Fri) is the long chain; C (Mon-Mon) hangs off A and has room.
  const acts = [
    act('A', '2026-11-02', '2026-11-04'),
    act('B', '2026-11-05', '2026-11-06'),
    act('C', '2026-11-05', '2026-11-05'),
  ];
  const deps = [dep('d1', 'A', 'B'), dep('d2', 'A', 'C')];
  it('marks the longest chain critical and gives the other branch float', () => {
    const r = analyse(acts, deps).activities;
    expect(r.get('A')).toEqual({ floatDays: 0, critical: true });
    expect(r.get('B')).toEqual({ floatDays: 0, critical: true });
    expect(r.get('C')).toEqual({ floatDays: 1, critical: false });
  });
  it('flags a link the dates break', () => {
    const bad = [act('A', '2026-11-02', '2026-11-04'), act('B', '2026-11-04', '2026-11-06')];
    const r = analyse(bad, [dep('d1', 'A', 'B')]).dependencies.get('d1')!;
    expect(r.violated).toBe(true);
    expect(r.slackDays).toBe(-1);
  });
  it('reads lag and the other link types', () => {
    const a = [act('A', '2026-11-02', '2026-11-04'), act('B', '2026-11-04', '2026-11-10')];
    const ss = analyse(a, [dep('s', 'A', 'B', 'SS', 2)]).dependencies.get('s')!;
    expect(ss.slackDays).toBe(0);
    const ff = analyse(a, [dep('f', 'A', 'B', 'FF', 1)]).dependencies.get('f')!;
    expect(ff.slackDays).toBe(3);
  });
  it('never calls finished work critical, and survives bad data with a loop', () => {
    const done = analyse([act('A', '2026-11-02', '2026-11-04', { pctComplete: 100 })], []);
    expect(done.activities.get('A')!.critical).toBe(false);
    const loop = analyse(
      [act('A', '2026-11-02', '2026-11-03'), act('B', '2026-11-04', '2026-11-05')],
      [dep('x', 'A', 'B'), dep('y', 'B', 'A')],
    );
    expect(loop.activities.size).toBe(2);
  });
});

describe('wouldCycle', () => {
  const deps = [dep('1', 'A', 'B'), dep('2', 'B', 'C')];
  it('finds direct and indirect loops', () => {
    expect(wouldCycle(deps, 'C', 'A')).toBe(true);
    expect(wouldCycle(deps, 'B', 'A')).toBe(true);
    expect(wouldCycle(deps, 'A', 'A')).toBe(true);
    expect(wouldCycle(deps, 'A', 'C')).toBe(false);
  });
});

describe('lookahead', () => {
  const acts = [
    act('past', '2026-10-01', '2026-10-09'),
    act('now', '2026-11-04', '2026-11-12'),
    act('later', '2026-11-16', '2026-11-20', { wbs: '1.2' }),
    act('far', '2026-12-14', '2026-12-18'),
    act('done', '2026-11-04', '2026-11-05', { pctComplete: 100 }),
    act('behind', '2026-10-26', '2026-11-06'),
  ];
  it('takes whole weeks from the Monday and leaves out finished and out-of-window work', () => {
    const r = lookahead(acts, '2026-11-05', 3, '2026-11-05');
    expect(r.windowStart).toBe('2026-11-02');
    expect(r.windowEnd).toBe('2026-11-22');
    expect(r.items.map((i) => i.activityId)).toEqual(['behind', 'now', 'later']);
    expect(r.items.find((i) => i.activityId === 'behind')!.late).toBe(true);
    expect(r.items.find((i) => i.activityId === 'later')!.late).toBe(false);
    expect(r.items.find((i) => i.activityId === 'now')!.startsInWindow).toBe(true);
  });
});

const MSP = `<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project"><Title>Tower M</Title><StatusDate>2026-11-02T08:00:00</StatusDate>
<Tasks>
<Task><UID>0</UID><Name>Tower M</Name><Summary>1</Summary></Task>
<Task><UID>1</UID><WBS>1</WBS><Name>Structure</Name><Summary>1</Summary><Start>2026-11-02T08:00:00</Start><Finish>2026-11-13T17:00:00</Finish></Task>
<Task><UID>2</UID><WBS>1.1</WBS><Name>Pour &amp; strip slab</Name><Start>2026-11-02T08:00:00</Start><Finish>2026-11-04T17:00:00</Finish><PercentComplete>50</PercentComplete></Task>
<Task><UID>3</UID><WBS>1.2</WBS><Name>Frame</Name><Start>2026-11-05T08:00:00</Start><Finish>2026-11-13T17:00:00</Finish>
 <PredecessorLink><PredecessorUID>2</PredecessorUID><Type>1</Type><LinkLag>4800</LinkLag></PredecessorLink>
 <PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type></PredecessorLink></Task>
<Task><UID>4</UID><WBS>1.3</WBS><Name>Topping out</Name><Milestone>1</Milestone><Start>2026-11-13T17:00:00</Start><Finish>2026-11-13T17:00:00</Finish>
 <PredecessorLink><PredecessorUID>3</PredecessorUID><Type>3</Type></PredecessorLink></Task>
</Tasks></Project>`;

describe('MS Project XML', () => {
  it('reads tasks, milestones, percent, lag and link types and drops summary rows', () => {
    const p = parseMspXml(MSP);
    expect(p.name).toBe('Tower M');
    expect(p.dataDate).toBe('2026-11-02');
    expect(p.activities.map((a) => [a.externalId, a.name, a.kind, a.pctComplete])).toEqual([
      ['2', 'Pour & strip slab', 'task', 50],
      ['3', 'Frame', 'task', 0],
      ['4', 'Topping out', 'milestone', 0],
    ]);
    expect(p.links).toEqual([
      { predecessor: '2', successor: '3', type: 'FS', lagDays: 1 },
      { predecessor: '3', successor: '4', type: 'SS', lagDays: 0 },
    ]);
    expect(p.skipped.length).toBe(1);
  });
  it('refuses a DTD and non-project files', () => {
    expect(() =>
      parseMspXml('<!DOCTYPE x [<!ENTITY a "b">]><Project><Tasks></Tasks></Project>'),
    ).toThrow(ImportError);
    expect(() => parseMspXml('<html></html>')).toThrow(ImportError);
  });
});

const row = (kind: string, ...cols: string[]) => [kind, ...cols].join('\t');
const XER = [
  'ERMHDR\t20.12\t2026-11-02\tProject\tadmin',
  row('%T', 'PROJECT'),
  row('%F', 'proj_id', 'proj_short_name', 'last_recalc_date'),
  row('%R', '1', 'Tower M', '2026-11-02 08:00'),
  row('%T', 'PROJWBS'),
  row('%F', 'wbs_id', 'wbs_short_name', 'parent_wbs_id'),
  row('%R', '10', 'TM', ''),
  row('%R', '11', 'STR', '10'),
  row('%T', 'TASK'),
  row(
    '%F',
    'task_id',
    'task_code',
    'task_name',
    'task_type',
    'wbs_id',
    'target_start_date',
    'target_end_date',
    'act_start_date',
    'act_end_date',
    'phys_complete_pct',
  ),
  row(
    '%R',
    '100',
    'A1000',
    'Pour slab',
    'TT_Task',
    '11',
    '2026-11-02 08:00',
    '2026-11-04 17:00',
    '2026-11-02 08:00',
    '2026-11-04 17:00',
    '100',
  ),
  row(
    '%R',
    '101',
    'A1010',
    'Frame',
    'TT_Task',
    '11',
    '2026-11-05 08:00',
    '2026-11-13 17:00',
    '',
    '',
    '25',
  ),
  row('%R', '102', 'A1020', 'Topped out', 'TT_FinMile', '11', '', '2026-11-13 17:00', '', '', ''),
  row(
    '%R',
    '103',
    'WBS',
    'Structure',
    'TT_WBS',
    '11',
    '2026-11-02 08:00',
    '2026-11-13 17:00',
    '',
    '',
    '',
  ),
  row('%T', 'TASKPRED'),
  row('%F', 'task_pred_id', 'task_id', 'pred_task_id', 'pred_type', 'lag_hr_cnt'),
  row('%R', '1', '101', '100', 'PR_FS', '8'),
  row('%R', '2', '102', '101', 'PR_FF', '0'),
  row('%R', '3', '102', '103', 'PR_FS', '0'),
  '%E',
].join('\n');

describe('P6 XER', () => {
  it('reads activities, finish milestones, progress, WBS and logic', () => {
    const p = parseXer(XER);
    expect(p.name).toBe('Tower M');
    expect(p.dataDate).toBe('2026-11-02');
    expect(
      p.activities.map((a) => [a.externalId, a.kind, a.start, a.finish, a.pctComplete]),
    ).toEqual([
      ['100', 'task', '2026-11-02', '2026-11-04', 100],
      ['101', 'task', '2026-11-05', '2026-11-13', 25],
      ['102', 'milestone', '2026-11-13', '2026-11-13', 0],
    ]);
    expect(p.activities[0]!.wbs).toBe('STR · A1000');
    expect(p.links).toEqual([
      { predecessor: '100', successor: '101', type: 'FS', lagDays: 1 },
      { predecessor: '101', successor: '102', type: 'FF', lagDays: 0 },
    ]);
    expect(p.skipped).toHaveLength(1);
  });
  it('refuses other files', () => {
    expect(() => parseXer('hello')).toThrow(ImportError);
  });
});

describe('re-flow after a move', () => {
  it('adds working days across a weekend', () => {
    expect(addWorkDays('2026-11-06', 1)).toBe('2026-11-09');
    expect(addWorkDays('2026-11-06', 0)).toBe('2026-11-06');
    expect(addWorkDays('2026-11-02', 5)).toBe('2026-11-09');
  });
  it('measures finish variance in working days', () => {
    expect(varianceDays('2026-11-09', '2026-11-06')).toBe(1);
    expect(varianceDays('2026-11-04', '2026-11-06')).toBe(-2);
    expect(varianceDays('2026-11-06', '2026-11-06')).toBe(0);
  });
  it('pushes broken successors later down the chain and never pulls anything earlier', () => {
    const acts = [
      act('A', '2026-11-04', '2026-11-05'), // moved here from Mon-Tue
      act('B', '2026-11-04', '2026-11-05'),
      act('C', '2026-11-06', '2026-11-06'),
      act('D', '2026-11-02', '2026-11-02'), // not linked: untouched
    ];
    const deps = [dep('d1', 'A', 'B'), dep('d2', 'B', 'C')];
    const r = cascade(acts, deps, 'A');
    expect(r.get('B')).toEqual({ start: '2026-11-06', finish: '2026-11-09' });
    expect(r.get('C')).toEqual({ start: '2026-11-10', finish: '2026-11-10' });
    expect(r.has('A') || r.has('D')).toBe(false);
    // Moving earlier leaves the links with spare room, so nothing changes.
    expect(
      cascade(
        [act('A', '2026-11-02', '2026-11-02'), act('B', '2026-11-04', '2026-11-04')],
        [dep('d', 'A', 'B')],
        'A',
      ).size,
    ).toBe(0);
  });
  it('leaves finished work alone', () => {
    const acts = [
      act('A', '2026-11-09', '2026-11-09'),
      act('B', '2026-11-09', '2026-11-09', { pctComplete: 100 }),
    ];
    expect(cascade(acts, [dep('d', 'A', 'B')], 'A').size).toBe(0);
  });
});
