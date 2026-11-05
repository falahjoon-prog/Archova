import { describe, expect, it, vi } from 'vitest';
vi.mock('../features/incidents/screens/IncidentReportScreen', () => ({}));
import { migrate, SqliteSyncStore } from '../lib/db';
import { listIncidents, reportIncident } from '../features/incidents';
import { nodeSqlDriver } from './support/node-sql';

const at = '2026-11-05T01:00:00.000Z';

async function setup() {
  const db = await nodeSqlDriver().open('inc.db');
  await migrate(db);
  return new SqliteSyncStore(db, { moduleOf: () => 'safety' });
}

describe('incident reporting offline', () => {
  it('stores the report on the device and queues the command', async () => {
    const store = await setup();
    const r = await reportIncident(store, {
      projectId: 'prj_1',
      title: '  Ladder slipped  ',
      type: 'near_miss',
      occurredAt: at,
      location: ' Level 2 ',
      people: [{ personName: ' Sam ', role: 'witness' }],
      mutationId: 'm1',
      clientAt: at,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [shown] = await listIncidents(store, 'prj_1');
    expect(shown).toMatchObject({ title: 'Ladder slipped', location: 'Level 2', pending: true });
    const [queued] = await store.listOutbox();
    expect(queued).toMatchObject({
      command: 'safety.reportIncident',
      entityId: r.value.id,
      baseVersion: null,
      payload: {
        projectId: 'prj_1',
        title: 'Ladder slipped',
        type: 'near_miss',
        location: 'Level 2',
        people: [{ personName: 'Sam', role: 'witness' }],
      },
    });
  });

  it('refuses an empty title or a time in the future without queueing anything', async () => {
    const store = await setup();
    const base = { projectId: 'prj_1', type: 'injury' as const, mutationId: 'm', clientAt: at };
    expect(await reportIncident(store, { ...base, title: ' ', occurredAt: at })).toEqual({
      ok: false,
      code: 'incident.title_required',
    });
    expect(
      await reportIncident(store, { ...base, title: 'x', occurredAt: '2026-11-06T01:00:00.000Z' }),
    ).toEqual({ ok: false, code: 'incident.in_future' });
    expect(await store.listOutbox()).toHaveLength(0);
  });
});
