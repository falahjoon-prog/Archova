// Behaviour every SyncStore must share, run against MemorySyncStore here and the encrypted SQLite store in
// apps/mobile. The test functions are passed in so this package does not depend on a test runner.

import type { NewOutboxEntry, SyncStore } from '../store';

export interface StoreUnderTest {
  store: SyncStore;
  /** A feature's optimistic write plus its outbox entry, in one local transaction. */
  write(
    record: { entityType: string; id: string; data: unknown },
    entry: Omit<NewOutboxEntry, 'entityType' | 'entityId'>,
  ): Promise<unknown>;
  get(
    entityType: string,
    id: string,
  ): Promise<{ version: number | null; data: unknown; pending: boolean } | undefined>;
  keys(): Promise<string[]>;
}

/** `moduleOf` used by the store under test must map defect → defects and diary_labour → diary. */
export interface ConformanceRunner {
  describe(name: string, fn: () => void): void;
  it(name: string, fn: () => Promise<void>): void;
  expect: (value: unknown) => {
    toEqual(expected: unknown): void;
    toMatchObject(expected: object): void;
    toBeUndefined(): void;
  };
}

const entry = (mutationId: string, extra: Partial<NewOutboxEntry> = {}) => ({
  mutationId,
  command: 'defects.update',
  projectId: 'prj_a',
  baseVersion: 1 as number | null,
  clientAt: '2026-10-02T09:00:00.000Z',
  payload: { n: mutationId },
  dependsOn: [] as string[],
  ...extra,
});

const pull = (changes: unknown[], scopeKeys: string[], nextSince: string) =>
  ({ changes, scopeKeys, nextSince }) as Parameters<SyncStore['applyPull']>[0];

export function syncStoreConformance(
  name: string,
  create: () => Promise<StoreUnderTest>,
  { describe, it, expect }: ConformanceRunner,
) {
  describe(`${name} conformance`, () => {
    it('queues in order and filters by status', async () => {
      const t = await create();
      await t.write({ entityType: 'defect', id: 'd1', data: { a: 1 } }, entry('m1'));
      await t.write(
        { entityType: 'defect', id: 'd2', data: { a: 2 } },
        entry('m2', { dependsOn: ['m1'] }),
      );
      const all = await t.store.listOutbox();
      expect(all.map((e) => [e.mutationId, e.status, e.attempts, e.dependsOn])).toEqual([
        ['m1', 'pending', 0, []],
        ['m2', 'pending', 0, ['m1']],
      ]);
      expect(all[0]).toMatchObject({ entityType: 'defect', entityId: 'd1', payload: { n: 'm1' } });
      expect(all[1]!.seq > all[0]!.seq).toEqual(true);
      await t.store.recordAttempt(['m2']);
      expect((await t.store.listOutbox()).map((e) => e.attempts)).toEqual([0, 1]);
      expect(await t.store.listOutbox({ status: 'needs_attention' })).toEqual([]);
      expect(await t.get('defect', 'd1')).toMatchObject({
        data: { a: 1 },
        pending: true,
        version: null,
      });
    });

    it('applies a result, clears pending and rebases a later edit of the same record', async () => {
      const t = await create();
      await t.write(
        { entityType: 'defect', id: 'd1', data: { t: 'new' } },
        entry('m1', { command: 'defects.create', baseVersion: null }),
      );
      await t.write(
        { entityType: 'defect', id: 'd1', data: { t: 'edited' } },
        entry('m2', { baseVersion: null }),
      );
      await t.store.recordPushResults([{ mutationId: 'm1', status: 'applied', version: 1 }]);
      expect((await t.store.listOutbox()).map((e) => [e.mutationId, e.baseVersion])).toEqual([
        ['m2', 1],
      ]);
      expect(await t.get('defect', 'd1')).toMatchObject({ version: 1, pending: true });
      await t.store.recordPushResults([{ mutationId: 'm2', status: 'applied', version: 2 }]);
      expect(await t.get('defect', 'd1')).toMatchObject({
        data: { t: 'edited' },
        version: 2,
        pending: false,
      });
      expect(await t.store.listOutbox()).toEqual([]);
    });

    it('takes the server copy on conflict and keeps the user input', async () => {
      const t = await create();
      await t.store.applyPull(
        pull(
          [{ entityType: 'defect', id: 'd1', op: 'upsert', version: 1, data: { t: 'a' } }],
          ['k'],
          '1',
        ),
      );
      await t.write({ entityType: 'defect', id: 'd1', data: { t: 'mine' } }, entry('m1'));
      await t.store.recordPushResults([
        { mutationId: 'm1', status: 'conflict', version: 3, server: { t: 'theirs' } },
      ]);
      expect(await t.get('defect', 'd1')).toMatchObject({
        data: { t: 'theirs' },
        version: 3,
        pending: false,
      });
      expect(await t.store.listOutbox()).toMatchObject([
        {
          status: 'needs_attention',
          attention: { kind: 'conflict', server: { t: 'theirs' } },
          payload: { n: 'm1' },
        },
      ]);
    });

    it('reverts a refusal to the latest server copy, or removes a record the server never had', async () => {
      const t = await create();
      await t.store.applyPull(
        pull(
          [{ entityType: 'defect', id: 'd1', op: 'upsert', version: 1, data: { t: 'A' } }],
          ['k'],
          '1',
        ),
      );
      await t.write({ entityType: 'defect', id: 'd1', data: { t: 'Local' } }, entry('m1'));
      await t.store.applyPull(
        pull(
          [{ entityType: 'defect', id: 'd1', op: 'upsert', version: 2, data: { t: 'Web' } }],
          ['k'],
          '2',
        ),
      );
      // Unsent work wins on screen until it is answered.
      expect(await t.get('defect', 'd1')).toMatchObject({ data: { t: 'Local' }, pending: true });
      await t.write(
        { entityType: 'defect', id: 'd9', data: {} },
        entry('m2', { baseVersion: null }),
      );
      await t.store.recordPushResults([
        { mutationId: 'm1', status: 'rejected', problem: { code: 'forbidden' } },
        { mutationId: 'm2', status: 'rejected', problem: { code: 'not-found' } },
      ]);
      expect(await t.get('defect', 'd1')).toMatchObject({
        data: { t: 'Web' },
        version: 2,
        pending: false,
      });
      expect(await t.get('defect', 'd9')).toBeUndefined();
      expect(await t.store.listOutbox({ status: 'needs_attention' })).toMatchObject([
        { mutationId: 'm1', attention: { kind: 'rejected', problem: { code: 'forbidden' } } },
        { mutationId: 'm2', attention: { kind: 'rejected', problem: { code: 'not-found' } } },
      ]);
    });

    it('keeps the local copy when a refused change has later work queued on the same record', async () => {
      const t = await create();
      await t.write({ entityType: 'defect', id: 'd1', data: { t: 'New' } }, entry('m1'));
      await t.write({ entityType: 'defect', id: 'd1', data: { t: 'Newer' } }, entry('m2'));
      await t.store.recordPushResults([
        { mutationId: 'm1', status: 'rejected', problem: { code: 'x' } },
      ]);
      expect(await t.get('defect', 'd1')).toMatchObject({ data: { t: 'Newer' }, pending: true });
    });

    it('holds drained work as pending review and marks failed children', async () => {
      const t = await create();
      await t.write({ entityType: 'defect', id: 'd1', data: {} }, entry('m1'));
      await t.write(
        { entityType: 'defect', id: 'd2', data: {} },
        entry('m2', { baseVersion: null }),
      );
      await t.store.recordPushResults([{ mutationId: 'm1', status: 'pending_review' }]);
      await t.store.markNeedsAttention([
        { mutationId: 'm2', reason: { kind: 'dependency_failed', parentMutationId: 'm0' } },
      ]);
      expect(
        (await t.store.listOutbox()).map((e) => [e.mutationId, e.status, e.attention]),
      ).toEqual([
        ['m1', 'pending_review', undefined],
        ['m2', 'needs_attention', { kind: 'dependency_failed', parentMutationId: 'm0' }],
      ]);
      expect(await t.get('defect', 'd1')).toMatchObject({ pending: true });
      expect(await t.get('defect', 'd2')).toBeUndefined();
      await t.store.removeEntries(['m2']);
      expect((await t.store.listOutbox()).map((e) => e.mutationId)).toEqual(['m1']);
    });

    it('holds an entry until it is released with its file id', async () => {
      const t = await create();
      await t.store.enqueue(
        {
          ...entry('m1', { command: 'photos.create', baseVersion: null }),
          entityType: 'photo',
          entityId: 'p1',
        },
        { held: true },
      );
      expect(await t.store.listOutbox()).toMatchObject([{ mutationId: 'm1', status: 'held' }]);
      expect(await t.store.listOutbox({ status: 'pending' })).toEqual([]);
      await t.store.release('m1', { fileId: 'fil_1' });
      expect(await t.store.listOutbox()).toMatchObject([
        { mutationId: 'm1', status: 'pending', payload: { n: 'm1', fileId: 'fil_1' } },
      ]);
    });

    it('tracks checkpoints and applies deletes', async () => {
      const t = await create();
      expect(await t.store.getCheckpoints(['a', 'b'])).toEqual({});
      await t.store.applyPull(
        pull(
          [
            { entityType: 'defect', id: 'd1', op: 'upsert', version: 1, data: {} },
            { entityType: 'defect', id: 'd2', op: 'upsert', version: 1, data: {} },
          ],
          ['a'],
          '7',
        ),
      );
      await t.store.applyPull(
        pull([{ entityType: 'defect', id: 'd1', op: 'delete', version: 2 }], ['a', 'b'], '9'),
      );
      expect(await t.store.getCheckpoints(['a', 'b', 'c'])).toEqual({ a: '9', b: '9' });
      expect(await t.keys()).toEqual(['defect:d2']);
    });

    it('purges one module of a project with its work and checkpoint, and wipes everything', async () => {
      const t = await create();
      await t.store.applyPull(
        pull(
          [
            {
              entityType: 'defect',
              id: 'd1',
              op: 'upsert',
              version: 1,
              data: { projectId: 'prj_a' },
            },
            {
              entityType: 'diary_labour',
              id: 'l1',
              op: 'upsert',
              version: 1,
              data: { projectId: 'prj_a' },
            },
            {
              entityType: 'defect',
              id: 'd2',
              op: 'upsert',
              version: 1,
              data: { projectId: 'prj_b' },
            },
          ],
          ['project:prj_a:defects', 'project:prj_a:diary', 'project:prj_b:defects'],
          '3',
        ),
      );
      await t.write({ entityType: 'defect', id: 'd1', data: { projectId: 'prj_a' } }, entry('m1'));
      expect(await t.store.purgeScope({ projectId: 'prj_a', module: 'defects' })).toEqual({
        defect: 1,
      });
      expect(await t.keys()).toEqual(['defect:d2', 'diary_labour:l1']);
      expect(
        await t.store.getCheckpoints([
          'project:prj_a:defects',
          'project:prj_a:diary',
          'project:prj_b:defects',
        ]),
      ).toEqual({ 'project:prj_a:diary': '3', 'project:prj_b:defects': '3' });
      expect(await t.store.listOutbox()).toEqual([]);

      await t.write(
        { entityType: 'diary_labour', id: 'l2', data: { projectId: 'prj_b' } },
        entry('m2', { command: 'diary.addLabour', projectId: 'prj_b', baseVersion: null }),
      );
      expect(await t.store.wipe()).toEqual({ diary_labour: 1 });
      expect(await t.keys()).toEqual([]);
      expect(await t.store.getCheckpoints(['project:prj_a:diary'])).toEqual({});
    });
  });
}
