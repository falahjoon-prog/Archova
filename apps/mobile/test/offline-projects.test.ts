import { describe, expect, it } from 'vitest';
import { migrate, SqliteSyncStore } from '../lib/db';
import { attentionReason, commandLabel } from '../lib/sync/attention';
import { OfflineProjects } from '../lib/sync/offline-projects';
import { nodeSqlDriver } from './support/node-sql';

async function setup() {
  const db = await nodeSqlDriver().open('offline.db');
  await migrate(db);
  const store = new SqliteSyncStore(db, { moduleOf: () => 'defects' });
  return {
    db,
    store,
    offline: new OfflineProjects(db, store, () => new Date('2026-11-05T00:00:00Z')),
  };
}

const entry = (mutationId: string, projectId: string) => ({
  mutationId,
  command: 'defects.create',
  projectId,
  baseVersion: null,
  clientAt: '2026-11-05T00:00:00.000Z',
  payload: {},
  dependsOn: [],
});

describe('OfflineProjects', () => {
  it('removes a synced project, drops its data and excludes it from sync', async () => {
    const { store, offline } = await setup();
    await store.applyPull({
      changes: [
        {
          op: 'upsert',
          entityType: 'defect',
          id: 'd1',
          version: 1,
          data: { projectId: 'p1' },
        },
      ],
      scopeKeys: ['project:p1:defects'],
      nextSince: '5',
    });
    expect(await offline.recordCount('p1')).toBe(1);
    expect(await offline.remove('p1')).toEqual({ ok: true });
    expect(await offline.recordCount('p1')).toBe(0);
    expect([...(await offline.excludedIds())]).toEqual(['p1']);
    expect(await store.getCheckpoints(['project:p1:defects'])).toEqual({});
  });

  it('refuses to remove a project that has unsynced work, and keeps the work', async () => {
    const { store, offline } = await setup();
    await store.write(
      { entityType: 'defect', id: 'd2', data: { projectId: 'p2' } },
      entry('m1', 'p2'),
    );
    expect(await offline.remove('p2')).toEqual({ ok: false, unsynced: 1 });
    expect((await offline.excludedIds()).size).toBe(0);
    expect(await store.listOutbox()).toHaveLength(1);
  });

  it('keeps a project again by clearing the exclusion', async () => {
    const { offline } = await setup();
    await offline.remove('p3');
    await offline.keep('p3');
    expect((await offline.excludedIds()).size).toBe(0);
  });
});

describe('attention text', () => {
  it('describes conflicts, rejections and unknown commands', () => {
    const base = {
      ...entry('m', 'p'),
      entityType: 'defect',
      entityId: 'd',
      seq: 1,
      status: 'needs_attention',
      attempts: 0,
    } as const;
    expect(attentionReason({ ...base, attention: { kind: 'conflict', server: {} } })).toMatch(
      /Someone else/,
    );
    expect(
      attentionReason({
        ...base,
        attention: { kind: 'rejected', problem: { code: 'module_not_licensed' } },
      }),
    ).toMatch(/licensed/);
    expect(commandLabel('rfis.respond')).toBe('Rfis change');
    expect(commandLabel('diary.upsertLabour')).toBe('Site diary change');
  });
});
