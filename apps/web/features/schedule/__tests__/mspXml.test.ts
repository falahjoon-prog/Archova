import { describe, expect, it } from 'vitest';
import type { ScheduleActivity, ScheduleDetail } from '../data/programme';
import { buildMspXml, mspFileName } from '../lib/mspXml';

const act = (over: Partial<ScheduleActivity>): ScheduleActivity => ({
  id: 'a1',
  wbs: '1.1',
  name: 'Footings',
  kind: 'task',
  start: '2027-02-01',
  finish: '2027-02-05',
  durationDays: 5,
  pctComplete: 40,
  assignee: '',
  externalId: null,
  floatDays: 0,
  critical: false,
  baselineStart: null,
  baselineFinish: null,
  varianceDays: null,
  ...over,
});

const detail = (): ScheduleDetail =>
  ({
    schedule: {
      id: 's',
      name: 'Master & "rev 2"',
      startDate: '2027-02-01',
      finishDate: '2027-02-12',
    },
    activities: [
      act({}),
      act({
        id: 'a2',
        wbs: '1.2',
        name: 'Slab <pour>',
        start: '2027-02-08',
        finish: '2027-02-12',
        durationDays: 5,
      }),
      act({
        id: 'a3',
        wbs: '',
        name: 'Slab complete',
        kind: 'milestone',
        start: '2027-02-12',
        finish: '2027-02-12',
        durationDays: 0,
      }),
    ],
    dependencies: [
      {
        id: 'd1',
        predecessorId: 'a1',
        successorId: 'a2',
        type: 'FS',
        lagDays: 1,
        slackDays: 0,
        violated: false,
      },
      {
        id: 'd2',
        predecessorId: 'a2',
        successorId: 'a3',
        type: 'SS',
        lagDays: 0,
        slackDays: 0,
        violated: false,
      },
      {
        id: 'd3',
        predecessorId: 'gone',
        successorId: 'a3',
        type: 'FS',
        lagDays: 0,
        slackDays: 0,
        violated: false,
      },
    ],
    criticalCount: 0,
    violationCount: 0,
  }) as unknown as ScheduleDetail;

describe('buildMspXml', () => {
  const xml = buildMspXml(detail());

  it('writes a project summary row and one task per activity', () => {
    expect(xml).toContain('<Project xmlns="http://schemas.microsoft.com/project">');
    expect((xml.match(/<Task>/g) ?? []).length).toBe(4);
    expect(xml).toContain('<UID>0</UID>');
  });

  it('escapes names so the file stays well formed', () => {
    expect(xml).toContain('<Name>Master &amp; &quot;rev 2&quot;</Name>');
    expect(xml).toContain('<Name>Slab &lt;pour&gt;</Name>');
  });

  it('writes dates, duration in hours and the milestone flag', () => {
    expect(xml).toContain('<Start>2027-02-01T08:00:00</Start><Finish>2027-02-05T17:00:00</Finish>');
    expect(xml).toContain('<Duration>PT40H0M0S</Duration>');
    expect(xml).toContain('<Milestone>1</Milestone>');
    expect(xml).toContain('<PercentComplete>40</PercentComplete>');
  });

  it('writes links by UID with MS Project type codes and lag in tenths of a minute', () => {
    expect(xml).toContain(
      '<PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type><CrossProject>0</CrossProject><LinkLag>4800</LinkLag>',
    );
    expect(xml).toContain('<PredecessorUID>2</PredecessorUID><Type>3</Type>');
    // The link to an activity that is not on the programme is left out.
    expect((xml.match(/<PredecessorLink>/g) ?? []).length).toBe(2);
  });

  it('numbers a blank WBS by its row', () => {
    expect(xml).toContain('<WBS>3</WBS>');
  });
});

describe('mspFileName', () => {
  it('makes a safe file name', () => {
    expect(mspFileName('Master programme / rev 2')).toBe('master-programme-rev-2.xml');
    expect(mspFileName('???')).toBe('programme.xml');
  });
});
