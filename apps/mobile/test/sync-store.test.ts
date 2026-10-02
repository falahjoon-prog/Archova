import { syncStoreConformance } from '@archova/sync-core/testing';
import { describe, expect, it } from 'vitest';
import { migrate, SqliteSyncStore, type SqlDatabase } from '../lib/db';
import { nodeSqlDriver } from './support/node-sql';

const MODULE_OF: Record<string, string> = { defect: 'defects', diary_labour: 'diary' };

async function freshDb(): Promise<SqlDatabase> {
  const db = await nodeSqlDriver().open('test.db');
  await migrate(db);
  return db;
}

syncStoreConformance(
  'SqliteSyncStore',
  async () => {
    const store = new SqliteSyncStore(await freshDb(), { moduleOf: (t) => MODULE_OF[t]! });
    return {
      store,
      write: (record, entry) => store.write(record, entry),
      get: (entityType, id) => store.get(entityType, id),
      keys: () => store.keys(),
    };
  },
  { describe, it, expect },
);

describe('SqliteSyncStore', () => {
  it('rolls back the optimistic write when queuing fails, so nothing is half-saved', async () => {
    const store = new SqliteSyncStore(await freshDb(), { moduleOf: () => 'defects' });
    const entry = {
      mutationId: 'm1',
      command: 'defects.create',
      projectId: 'prj_a',
      baseVersion: null,
      clientAt: '2026-10-02T09:00:00.000Z',
      payload: {},
      dependsOn: [],
    };
    await store.write({ entityType: 'defect', id: 'd1', data: {} }, entry);
    // Same mutation id again violates the outbox's unique key.
    await expect(
      store.write({ entityType: 'defect', id: 'd2', data: {} }, entry),
    ).rejects.toThrow();
    expect(await store.keys()).toEqual(['defect:d1']);
    expect(await store.listOutbox()).toHaveLength(1);
  });
});

describe('migrate', () => {
  it('is re-runnable and refuses a database from a newer build', async () => {
    const db = await freshDb();
    await migrate(db);
    expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 1 });
    await db.execAsync('PRAGMA user_version = 99');
    await expect(migrate(db)).rejects.toThrow(/newer/);
  });
});

describe('SqliteSyncStore with the engine', () => {
  it('syncs work queued offline and purges a revoked project', async () => {
    const { FakeSyncServer } = await import('@archova/sync-core/testing');
    const { SyncEngine, projectScope } = await import('@archova/sync-core');
    const server = new FakeSyncServer({
      'defects.create': { entityType: 'defect', module: 'defects', kind: 'create' },
    });
    const store = new SqliteSyncStore(await freshDb(), { moduleOf: () => 'defects' });
    const engine = new SyncEngine({
      store,
      transport: server.transport(),
      scopes: () => [projectScope('prj_a', 'defects')],
    });
    await store.write(
      { entityType: 'defect', id: 'd1', data: { projectId: 'prj_a', title: 'Chipped bench' } },
      {
        mutationId: 'm1',
        command: 'defects.create',
        projectId: 'prj_a',
        baseVersion: null,
        clientAt: '2026-10-02T09:00:00.000Z',
        payload: { projectId: 'prj_a', title: 'Chipped bench' },
        dependsOn: [],
      },
    );
    expect(await engine.sync()).toEqual({ ok: true });
    expect(await store.get('defect', 'd1')).toEqual({
      version: 1,
      pending: false,
      data: { projectId: 'prj_a', title: 'Chipped bench' },
    });

    server.revoke({ projectId: 'prj_a', module: null });
    await engine.sync();
    expect(await store.keys()).toEqual([]);
  });
});
