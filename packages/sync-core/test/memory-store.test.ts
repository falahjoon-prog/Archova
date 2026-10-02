import { describe, expect, it } from 'vitest';
import { MemorySyncStore } from '../src';

const entry = (mutationId: string, entityId: string, extra = {}) => ({
  mutationId,
  command: 'defects.update',
  projectId: 'prj_a',
  baseVersion: 1,
  clientAt: '2026-10-02T09:00:00.000Z',
  payload: {},
  dependsOn: [],
  ...extra,
});

describe('MemorySyncStore', () => {
  it('never overwrites unsent local work with a pulled copy, but remembers the server copy', async () => {
    const store = new MemorySyncStore();
    await store.applyPull({
      changes: [{ entityType: 'defect', id: 'd1', op: 'upsert', version: 1, data: { title: 'A' } }],
      scopeKeys: ['project:prj_a:defects'],
      nextSince: '1',
    });
    await store.write(
      { entityType: 'defect', id: 'd1', data: { title: 'Local' } },
      entry('m1', 'd1'),
    );
    await store.applyPull({
      changes: [
        { entityType: 'defect', id: 'd1', op: 'upsert', version: 2, data: { title: 'Web' } },
      ],
      scopeKeys: ['project:prj_a:defects'],
      nextSince: '2',
    });
    expect(store.get('defect', 'd1')).toMatchObject({ data: { title: 'Local' }, pending: true });

    await store.recordPushResults([
      { mutationId: 'm1', status: 'rejected', problem: { code: 'forbidden' } },
    ]);
    expect(store.get('defect', 'd1')).toMatchObject({
      data: { title: 'Web' },
      version: 2,
      pending: false,
    });
  });

  it('keeps the local copy when a refused change has later work queued on the same record', async () => {
    const store = new MemorySyncStore();
    await store.write(
      { entityType: 'defect', id: 'd1', data: { title: 'New' } },
      entry('m1', 'd1'),
    );
    await store.write(
      { entityType: 'defect', id: 'd1', data: { title: 'Newer' } },
      entry('m2', 'd1'),
    );
    await store.recordPushResults([
      { mutationId: 'm1', status: 'rejected', problem: { code: 'x' } },
    ]);
    expect(store.get('defect', 'd1')).toMatchObject({ data: { title: 'Newer' }, pending: true });
  });

  it('purges one module of a project, its work and its checkpoint', async () => {
    const store = new MemorySyncStore({ moduleOf: (t) => (t === 'defect' ? 'defects' : 'diary') });
    await store.applyPull({
      changes: [
        { entityType: 'defect', id: 'd1', op: 'upsert', version: 1, data: { projectId: 'prj_a' } },
        {
          entityType: 'diary_labour',
          id: 'l1',
          op: 'upsert',
          version: 1,
          data: { projectId: 'prj_a' },
        },
        { entityType: 'defect', id: 'd2', op: 'upsert', version: 1, data: { projectId: 'prj_b' } },
      ],
      scopeKeys: ['project:prj_a:defects', 'project:prj_a:diary', 'project:prj_b:defects'],
      nextSince: '3',
    });
    await store.enqueue({ ...entry('m1', 'd1'), entityType: 'defect', entityId: 'd1' });
    expect(await store.purgeScope({ projectId: 'prj_a', module: 'defects' })).toEqual({
      defect: 1,
    });
    expect([...store.records.keys()].sort()).toEqual(['defect:d2', 'diary_labour:l1']);
    expect(
      await store.getCheckpoints([
        'project:prj_a:defects',
        'project:prj_a:diary',
        'project:prj_b:defects',
      ]),
    ).toEqual({ 'project:prj_a:diary': '3', 'project:prj_b:defects': '3' });
    expect(await store.listOutbox()).toEqual([]);
  });
});
