import { describe, expect, it, vi } from 'vitest';
import { encodeId, type InjuryRecord } from '@archova/domain';
import type { TenantScope } from '@archova/kernel';
import { createIncidentAnalyticsService } from '../../src/application/incident-analytics';
import type { ReportingDeps } from '../../src/application/sources';

const scope = {} as TenantScope;
const A = '0190a000-0000-7000-8000-000000000001';
const B = '0190a000-0000-7000-8000-000000000002';
const NOW = new Date('2026-11-06T02:00:00Z');

const row = (projectId: string, over: Partial<InjuryRecord> = {}): InjuryRecord => ({
  incidentId: '0190a000-0000-7000-8000-0000000000f1',
  projectId,
  ref: 'INC-0001',
  occurredAt: '2026-10-30T01:00:00Z',
  localDate: '2026-10-30',
  personName: 'Sam',
  companyId: null,
  notifiable: false,
  bodyPart: 'hand',
  injuryType: 'laceration',
  harmSource: 'hitting_objects',
  outcome: 'lost_time',
  daysLost: 2,
  ...over,
});

function build(opts: { restricted?: string; hours?: Record<string, number | null> } = {}) {
  const injuryRows = vi.fn(async (_s: TenantScope, id: string) =>
    id === opts.restricted
      ? { restricted: true, rows: [], lastInjuryOn: null, lastIncidentOn: null }
      : {
          restricted: false,
          rows: [row(id), row(id, { bodyPart: 'knee', outcome: 'first_aid', daysLost: 0 })],
          lastInjuryOn: '2026-10-30',
          lastIncidentOn: '2026-11-01',
        },
  );
  const hoursWorked = vi.fn(async (_s: TenantScope, id: string) =>
    opts.hours && id in opts.hours ? (opts.hours[id] as number | null) : 500_000,
  );
  const deps = {
    platform: {
      listProjects: async () => ({
        data: [
          { id: A, name: 'Alpha', number: null, status: 'active' },
          { id: B, name: 'Bravo', number: null, status: 'active' },
        ],
        nextCursor: null,
      }),
    },
    safety: { injuryRows },
    workforce: { hoursWorked },
    now: () => NOW,
  } as unknown as ReportingDeps & { now: () => Date };
  return { svc: createIncidentAnalyticsService(deps), injuryRows, hoursWorked };
}

describe('incident analytics', () => {
  it('adds up projects, computes rates and the days without', async () => {
    const { svc } = build();
    const r = await svc.get(scope, {});
    expect(r.summary).toMatchObject({
      injuries: 4,
      lostTimeInjuries: 2,
      hoursWorked: 1_000_000,
      ltifr: 2,
      trifr: 2,
    });
    expect(r.daysWithoutInjury).toBe(7);
    expect(r.daysWithoutIncident).toBe(5);
    expect(r.rows[0]).toMatchObject({ projectName: 'Alpha', ref: 'INC-0001' });
  });

  it('leaves out a project the caller may not see health information on', async () => {
    const { svc } = build({ restricted: B });
    const r = await svc.get(scope, {});
    expect(r.projectsRestricted).toBe(1);
    expect(r.summary.injuries).toBe(2);
    expect(r.summary.hoursWorked).toBe(500_000);
  });

  it('has no rates when any covered project has no readable hours', async () => {
    const { svc } = build({ hours: { [B]: null } });
    const r = await svc.get(scope, {});
    expect(r.summary).toMatchObject({ hoursWorked: null, ltifr: null, trifr: null });
  });

  it('narrows to one project and one body part', async () => {
    const { svc, injuryRows } = build();
    const r = await svc.get(scope, { projectId: encodeId('project', B), bodyPart: 'knee' });
    expect(injuryRows).toHaveBeenCalledTimes(1);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.bodyPart).toBe('knee');
  });

  it('rejects a bad range and a bad body part', async () => {
    const { svc } = build();
    await expect(svc.get(scope, { from: '2026-11-01', to: '2026-10-01' })).rejects.toThrow();
    await expect(svc.get(scope, { bodyPart: 'elbowish' })).rejects.toThrow();
  });
});
