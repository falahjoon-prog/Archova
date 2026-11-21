import { describe, expect, it } from 'vitest';
import {
  findGaps,
  packLines,
  weeksWithoutTalk,
  type EvidencePack,
  type EvidenceSources,
  type Section,
} from '../../src/domain/evidence-pack';

const sec = <T>(rows: T[], extra: Partial<Section<T>> = {}): Section<T> => ({
  restricted: false,
  truncated: false,
  rows,
  ...extra,
});
const empty = (): EvidenceSources => ({
  incidents: sec([]),
  actions: sec([]),
  pretasks: sec([]),
  toolbox: sec([]),
  inductions: sec([]),
  inspections: sec([]),
});
const range = { from: '2026-11-01', to: '2026-11-21' };
const incident = (o = {}) => ({
  ref: 'INC-0001',
  title: 'Fall from ladder',
  type: 'injury',
  severity: 'high',
  occurredAt: '2026-11-03T01:00:00.000Z',
  location: null,
  status: 'closed' as const,
  isNotifiable: false,
  notifiableClass: null,
  regulatorNotifiedAt: null,
  writtenNoticeRequestedAt: null,
  hasRootCause: true,
  closedAt: '2026-11-10T00:00:00.000Z',
  ...o,
});

describe('findGaps', () => {
  it('says so when nothing was recorded in the dates', () => {
    const g = findGaps(empty(), range, '2026-11-21');
    expect(g[0]).toMatchObject({ section: 'pack', severity: 'high' });
  });

  it('flags a notifiable incident with no regulator time as high and sorts it first', () => {
    const s = empty();
    s.incidents = sec([
      incident({ status: 'investigating', isNotifiable: true, notifiableClass: 'death' }),
    ]);
    const g = findGaps(s, range, '2026-11-21');
    expect(g[0]).toMatchObject({ section: 'incidents', severity: 'high' });
    expect(g[0]!.message).toContain('INC-0001');
    expect(g.some((x) => x.message.includes('still investigating'))).toBe(true);
  });

  it('flags overdue unverified actions and pre-task plans with uncontrolled hazards or unsigned crew', () => {
    const s = empty();
    s.actions = sec([
      {
        incidentRef: 'INC-0001',
        number: 1,
        title: 'Fix rail',
        dueDate: '2026-11-05',
        status: 'done',
        completedAt: null,
        verifiedAt: null,
      },
    ]);
    s.pretasks = sec([
      {
        ref: 'PTP-0001',
        taskTitle: 'Pour',
        workDate: '2026-11-04',
        location: null,
        supervisorName: 'Sam',
        status: 'open',
        hazards: 2,
        hazardsWithoutControls: 1,
        crew: 3,
        signed: 2,
        notCurrentlyInducted: 1,
        reviewed: false,
      },
    ]);
    const msgs = findGaps(s, range, '2026-11-21').map((g) => g.message);
    expect(msgs).toContain('INC-0001 action 1 is overdue (due 2026-11-05) and not verified.');
    expect(msgs).toContain('PTP-0001 has 1 hazard with no controls.');
    expect(msgs).toContain('PTP-0001: 1 of 3 crew did not sign.');
    expect(msgs).toContain('PTP-0001: 1 crew member had no current site induction when signing.');
    expect(msgs).toContain('PTP-0001 (2026-11-04) was never closed.');
  });

  it('reports restricted and truncated sections instead of hiding them', () => {
    const s = empty();
    s.incidents = sec([], { restricted: true });
    s.toolbox = sec([], { truncated: true });
    s.inspections = sec([
      {
        ref: 'INS-0001',
        title: 'Walk',
        status: 'closed',
        scheduledFor: null,
        completedOn: '2026-11-02',
        pass: 3,
        fail: 0,
      },
    ]);
    const g = findGaps(s, range, '2026-11-21');
    expect(g.some((x) => x.section === 'incidents' && x.severity === 'high')).toBe(true);
    expect(g.some((x) => x.section === 'toolbox' && x.message.includes('row limit'))).toBe(true);
    // A restricted section is not counted as "no records".
    expect(g.some((x) => x.section === 'pack')).toBe(false);
  });

  it('finds weeks with no toolbox talk only for ranges of two weeks or more', () => {
    expect(weeksWithoutTalk('2026-11-01', '2026-11-10', [])).toEqual([]);
    expect(weeksWithoutTalk('2026-11-01', '2026-11-21', ['2026-11-09'])).toEqual([
      '2026-11-01',
      '2026-11-15',
    ]);
  });

  it('flags expired inductions and incomplete inspections', () => {
    const s = empty();
    s.inductions = sec([
      {
        workerName: 'Lee',
        completedOn: '2025-10-01',
        quizScore: 90,
        expiresOn: '2026-10-01',
        method: 'self',
      },
    ]);
    s.inspections = sec([
      {
        ref: 'INS-0001',
        title: 'Scaffold',
        status: 'scheduled',
        scheduledFor: '2026-11-02',
        completedOn: null,
        pass: 0,
        fail: 0,
      },
    ]);
    const msgs = findGaps(s, range, '2026-11-21').map((g) => g.message);
    expect(msgs).toContain("Lee's induction expired on 2026-10-01.");
    expect(msgs).toContain('INS-0001 was scheduled for 2026-11-02 and is not complete.');
  });
});

describe('packLines', () => {
  it('lists every section, the gaps, and never claims compliance', () => {
    const s = empty();
    s.incidents = sec([incident()]);
    const pack: EvidencePack = {
      project: { name: 'Harbour Tower', number: 'P-12', timeZone: 'Australia/Sydney' },
      from: range.from,
      to: range.to,
      generatedOn: '2026-11-21',
      ...s,
      inductions: sec([], { restricted: true }),
      gaps: findGaps(s, range, '2026-11-21'),
    };
    const text = packLines(pack)
      .map((l) => l.text)
      .join('\n');
    expect(text).toContain('Harbour Tower (P-12)');
    expect(text).toContain('INC-0001');
    expect(text).toContain('Site inductions: not included (no access)');
    expect(text).toContain('does not say the site complied');
    expect(text).not.toMatch(/\bcompliant\b|\bverified compliant/i);
  });
});
