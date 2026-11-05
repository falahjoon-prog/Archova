import { describe, expect, it, vi } from 'vitest';
vi.mock('../features/incidents/screens/IncidentReportScreen', () => ({}));
import { migrate, SqliteSyncStore } from '../lib/db';
import {
  attachIncidentPhoto,
  getIncident,
  listIncidents,
  reportIncident,
} from '../features/incidents';
import { nodeSqlDriver } from './support/node-sql';

const at = '2026-11-05T01:00:00.000Z';

async function setup() {
  const db = await nodeSqlDriver().open('inc.db');
  await migrate(db);
  return { store: new SqliteSyncStore(db, { moduleOf: () => 'safety' }), db };
}

describe('incident reporting offline', () => {
  it('stores the report on the device and queues the command', async () => {
    const { store } = await setup();
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
    const { store } = await setup();
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

  it('keeps injury details only for an injured person, as short answers', async () => {
    const { store } = await setup();
    const r = await reportIncident(store, {
      projectId: 'prj_1',
      title: 'Fall',
      type: 'injury',
      occurredAt: at,
      people: [
        {
          personName: 'Alex',
          role: 'injured',
          injury: { nature: ' Sprain ', bodyPart: '', treatment: 'Ice' },
        },
        { personName: 'Sam', role: 'witness', injury: { nature: 'ignored' } },
      ],
      mutationId: 'm1',
      clientAt: at,
    });
    expect(r.ok).toBe(true);
    const [queued] = await store.listOutbox();
    expect((queued?.payload as { people: unknown }).people).toEqual([
      { personName: 'Alex', role: 'injured', injury: { nature: 'Sprain', treatment: 'Ice' } },
      { personName: 'Sam', role: 'witness' },
    ]);
  });

  it('queues a photo after the report it belongs to and shows it at once', async () => {
    const { store, db } = await setup();
    const r = await reportIncident(store, {
      projectId: 'prj_1',
      title: 'Spill',
      type: 'environmental',
      occurredAt: at,
      mutationId: 'm1',
      clientAt: at,
    });
    if (!r.ok) throw new Error('report failed');
    const added: unknown[] = [];
    const held = await getIncident(store, r.value.id);
    await attachIncidentPhoto(
      {
        db,
        store,
        uploads: { addIn: async (_tx: unknown, row: unknown) => void added.push(row) },
      } as never,
      {
        incident: held!,
        photoId: 'p1',
        mutationId: 'm2',
        capture: {} as never,
        file: {
          localUri: 'file:///p1.jpg',
          thumbnailUri: 'file:///p1-t.jpg',
          filename: 'p1.jpg',
          mime: 'image/jpeg',
          sizeBytes: 10,
          sha256: 'abc',
        },
        clientAt: at,
      },
    );
    const outbox = await store.listOutbox();
    expect(outbox.map((e) => e.command)).toEqual([
      'safety.reportIncident',
      'safety.attachIncidentPhoto',
    ]);
    expect(outbox[1]?.dependsOn).toEqual(['m1']);
    expect(added).toHaveLength(1);
    const [shown] = await listIncidents(store, 'prj_1');
    expect(shown?.localPhotos).toEqual([{ photoId: 'p1', thumbnailUri: 'file:///p1-t.jpg' }]);
  });
});
