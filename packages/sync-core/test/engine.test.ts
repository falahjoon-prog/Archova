import { describe, expect, it } from 'vitest';
import { DRAIN_WINDOW_MS, projectScope, SyncHttpError, type SyncEvent } from '../src';
import { addPhoto, createDefect, PROJECT_A, PROJECT_B, setup, updateDefect } from './helpers';

describe('push', () => {
  it('sends work created offline and the next pull brings back the server record', async () => {
    const { server, store, clock, engine } = setup();
    const entry = await createDefect(store, clock, { title: 'Cracked tile, level 2 ensuite' });
    expect(store.get('defect', entry.entityId)?.pending).toBe(true);
    expect((await engine.status()).pending).toBe(1);

    expect(await engine.sync()).toEqual({ ok: true });

    expect(server.records.get(`defect:${entry.entityId}`)?.data).toMatchObject({
      title: 'Cracked tile, level 2 ensuite',
    });
    const local = store.get('defect', entry.entityId)!;
    expect(local.pending).toBe(false);
    expect(local.version).toBe(1);
    const status = await engine.status();
    expect(status).toMatchObject({ phase: 'idle', pending: 0, needsAttention: 0 });
    expect(status.lastSuccessAt).toBe(clock.now());
  });

  it('sends in queue order, in batches of at most 100', async () => {
    const { server, store, clock, engine } = setup();
    const ids: string[] = [];
    for (let i = 0; i < 250; i++) {
      ids.push((await createDefect(store, clock, { title: `Defect ${i}` })).mutationId);
    }
    await engine.sync({ pull: false });
    expect(server.pushLog.map((p) => p.mutations.length)).toEqual([100, 100, 50]);
    expect(server.pushLog.flatMap((p) => p.mutations.map((m) => m.mutationId))).toEqual(ids);
    expect(server.pullLog).toHaveLength(0);
  });

  it('is safe to retry: a mutation the server already applied is not applied twice', async () => {
    const { server, store, clock, engine } = setup();
    const entry = await createDefect(store, clock, { title: 'Door sticks' });
    // The server applied it but the response was lost on the way back.
    await server.push(
      {
        mutations: [
          {
            mutationId: entry.mutationId,
            command: entry.command,
            entityId: entry.entityId,
            baseVersion: null,
            clientAt: entry.clientAt,
            payload: entry.payload,
          },
        ],
      },
      { drain: false },
    );
    await engine.sync();
    expect(server.records.get(`defect:${entry.entityId}`)?.version).toBe(1);
    expect((await engine.status()).pending).toBe(0);
  });

  it('keeps work and counts the attempt when the network fails', async () => {
    const { server, store, clock, engine } = setup();
    await createDefect(store, clock, { title: 'Scuffed skirting' });
    server.failNext(1);
    const outcome = await engine.sync();
    expect(outcome).toMatchObject({ ok: false, kind: 'retry' });
    const [entry] = await store.listOutbox();
    expect(entry).toMatchObject({ status: 'pending', attempts: 1 });
    expect((await engine.status()).phase).toBe('waiting_retry');

    expect(await engine.sync()).toEqual({ ok: true });
    expect(await store.listOutbox()).toHaveLength(0);
  });

  it('shows a conflict under Needs attention and reverts to the server copy', async () => {
    const { server, store, clock, engine } = setup();
    const created = await createDefect(store, clock, { title: 'Paint run' });
    await engine.sync();

    server.serverWrite({
      entityType: 'defect',
      id: created.entityId,
      projectId: PROJECT_A,
      module: 'defects',
      data: { projectId: PROJECT_A, title: 'Paint run, hallway' },
    });
    await updateDefect(store, clock, created.entityId, { title: 'Paint run, level 1' });
    await engine.sync({ pull: false });

    const [entry] = await store.listOutbox();
    expect(entry).toMatchObject({
      status: 'needs_attention',
      attention: { kind: 'conflict', server: { title: 'Paint run, hallway' } },
      // The user's input is kept so they can reapply it in one tap.
      payload: { title: 'Paint run, level 1' },
    });
    expect(store.get('defect', created.entityId)).toMatchObject({
      version: 2,
      pending: false,
      data: { title: 'Paint run, hallway' },
    });
    expect((await engine.status()).needsAttention).toBe(1);

    await engine.discard([entry!.mutationId]);
    expect((await engine.status()).needsAttention).toBe(0);
  });

  it('removes a refused new record and keeps the reason', async () => {
    const { store, clock, engine } = setup();
    const id = 'dfx_unknown';
    await store.write(
      { entityType: 'defect', id, data: { projectId: PROJECT_A } },
      {
        mutationId: 'm1',
        command: 'defects.archive',
        projectId: PROJECT_A,
        baseVersion: null,
        clientAt: clock.iso(),
        payload: {},
        dependsOn: [],
      },
    );
    await engine.sync({ pull: false });
    expect(store.get('defect', id)).toBeUndefined();
    expect(await store.listOutbox()).toMatchObject([
      {
        status: 'needs_attention',
        attention: { kind: 'rejected', problem: { code: 'unknown-command' } },
      },
    ]);
  });

  it('keeps a command queued and backs off while its file is still being scanned', async () => {
    const { server, store, clock, engine } = setup();
    const defect = await createDefect(store, clock, { title: 'Water stain' });
    const photo = await addPhoto(store, clock, defect.entityId);
    server.setFileProblem(photo.entityId, 'file.not_ready');

    const outcome = await engine.sync({ pull: false });
    expect(outcome).toMatchObject({ ok: false, kind: 'retry' });
    // The defect went through; the photo waits, still pending, with one attempt counted.
    expect(server.records.get(`defect:${defect.entityId}`)).toBeDefined();
    expect(await store.listOutbox()).toMatchObject([
      { mutationId: photo.mutationId, status: 'pending', attempts: 1 },
    ]);

    server.setFileProblem(photo.entityId, null);
    expect(await engine.sync({ pull: false })).toEqual({ ok: true });
    expect(await store.listOutbox()).toEqual([]);
  });

  it('sends a blocked file to needs attention for good', async () => {
    const { server, store, clock, engine } = setup();
    const defect = await createDefect(store, clock, { title: 'Water stain' });
    const photo = await addPhoto(store, clock, defect.entityId);
    server.setFileProblem(photo.entityId, 'file.blocked');

    expect(await engine.sync({ pull: false })).toEqual({ ok: true });
    expect(await store.listOutbox()).toMatchObject([
      {
        mutationId: photo.mutationId,
        status: 'needs_attention',
        attention: { kind: 'rejected', problem: { code: 'file.blocked' } },
      },
    ]);
  });

  it('sends a child only after its parent is applied', async () => {
    const { server, store, clock, engine } = setup();
    const defect = await createDefect(store, clock, { title: 'Missing grout' });
    await addPhoto(store, clock, defect.entityId, [defect.mutationId]);
    const unrelated = await createDefect(store, clock, { title: 'Loose handrail' });

    await engine.sync({ pull: false });

    expect(server.pushLog.map((p) => p.mutations.map((m) => m.command))).toEqual([
      ['defects.create'],
      ['photos.create', 'defects.create'],
    ]);
    expect(server.pushLog[1]!.mutations[1]!.entityId).toBe(unrelated.entityId);
    expect(await store.listOutbox()).toHaveLength(0);
  });

  it('waits for a held parent, then sends both', async () => {
    const { server, store, clock, engine } = setup();
    const photoId = 'pho_1';
    await store.enqueue(
      {
        mutationId: 'photo',
        command: 'photos.create',
        entityType: 'photo',
        entityId: photoId,
        projectId: PROJECT_A,
        baseVersion: null,
        clientAt: clock.iso(),
        payload: { projectId: PROJECT_A },
        dependsOn: [],
      },
      { held: true },
    );
    await store.enqueue({
      mutationId: 'ready',
      command: 'defects.update',
      entityType: 'defect',
      entityId: 'd1',
      projectId: PROJECT_A,
      baseVersion: 1,
      clientAt: clock.iso(),
      payload: { projectId: PROJECT_A },
      dependsOn: ['photo'],
    });
    const unrelated = await createDefect(store, clock, { title: 'Unrelated' });
    await engine.sync({ pull: false });
    expect(server.pushLog.flatMap((p) => p.mutations.map((m) => m.mutationId))).toEqual([
      unrelated.mutationId,
    ]);
    expect((await engine.status()).pending).toBe(2);

    await store.release('photo', { fileId: 'fil_1' });
    await engine.sync({ pull: false });
    expect(server.pushLog.slice(1).map((p) => p.mutations.map((m) => m.mutationId))).toEqual([
      ['photo'],
      ['ready'],
    ]);
  });

  it('does not send a child whose parent failed', async () => {
    const { server, store, clock, engine } = setup();
    await store.write(
      { entityType: 'defect', id: 'd1', data: { projectId: PROJECT_A } },
      {
        mutationId: 'parent',
        command: 'defects.update',
        projectId: PROJECT_A,
        baseVersion: 3,
        clientAt: clock.iso(),
        payload: { projectId: PROJECT_A, title: 'x' },
        dependsOn: [],
      },
    );
    const photo = await addPhoto(store, clock, 'd1', ['parent']);
    const grandchild = await addPhoto(store, clock, 'd1', [photo.mutationId]);

    await engine.sync({ pull: false });

    expect(server.pushLog.flatMap((p) => p.mutations.map((m) => m.mutationId))).toEqual(['parent']);
    const outbox = await store.listOutbox();
    expect(outbox.map((e) => [e.mutationId, e.status, e.attention?.kind])).toEqual([
      ['parent', 'needs_attention', 'rejected'],
      [photo.mutationId, 'needs_attention', 'dependency_failed'],
      [grandchild.mutationId, 'needs_attention', 'dependency_failed'],
    ]);
  });
});

describe('pull', () => {
  it('pages through the change feed and keeps a checkpoint per scope', async () => {
    const { server, store, engine } = setup({ engine: { pullLimit: 2 } });
    for (let i = 0; i < 5; i++) {
      server.serverWrite({
        entityType: 'defect',
        id: `d${i}`,
        projectId: PROJECT_A,
        module: 'defects',
        data: { projectId: PROJECT_A, title: `Defect ${i}` },
      });
    }
    await engine.sync();
    expect(server.pullLog.map((p) => p.since)).toEqual(['0', '2', '4']);
    expect([...store.records.keys()].sort()).toEqual([
      'defect:d0',
      'defect:d1',
      'defect:d2',
      'defect:d3',
      'defect:d4',
    ]);
    expect(await store.getCheckpoints([`project:${PROJECT_A}:defects`])).toEqual({
      [`project:${PROJECT_A}:defects`]: '5',
    });

    server.serverDelete('defect', 'd2');
    await engine.sync();
    expect(server.pullLog.at(-1)!.since).toBe('5');
    expect(store.get('defect', 'd2')).toBeUndefined();
  });

  it('starts a newly kept scope with its own full load', async () => {
    const { server, engine, setScopes } = setup({
      scopes: [projectScope(PROJECT_A, 'defects')],
    });
    server.serverWrite({
      entityType: 'defect',
      id: 'd1',
      projectId: PROJECT_A,
      module: 'defects',
      data: { projectId: PROJECT_A },
    });
    await engine.sync();
    setScopes([projectScope(PROJECT_A, 'defects'), projectScope(PROJECT_A, 'diary')]);
    await engine.sync();
    const last = server.pullLog.slice(-2).map((p) => [p.since, p.scopes.length]);
    expect(last).toEqual(
      expect.arrayContaining([
        ['1', 1],
        ['0', 1],
      ]),
    );
  });
});

describe('lost access', () => {
  it('purges a revoked project at once when nothing is waiting to be sent', async () => {
    const { server, store, engine, setScopes } = setup({
      scopes: [projectScope(PROJECT_A, 'defects'), projectScope(PROJECT_B, 'defects')],
    });
    for (const projectId of [PROJECT_A, PROJECT_B]) {
      server.serverWrite({
        entityType: 'defect',
        id: `d-${projectId}`,
        projectId,
        module: 'defects',
        data: { projectId },
      });
    }
    await engine.sync();
    expect(store.records.size).toBe(2);

    const events: SyncEvent[] = [];
    engine.subscribe((e) => events.push(e));
    server.revoke({ projectId: PROJECT_B, module: null });
    await engine.sync();

    expect([...store.records.keys()]).toEqual([`defect:d-${PROJECT_A}`]);
    expect(events).toContainEqual({
      type: 'purged',
      scope: { projectId: PROJECT_B, module: null },
      discarded: {},
    });
    // Not requested again even though the app still lists it.
    setScopes([projectScope(PROJECT_A, 'defects'), projectScope(PROJECT_B, 'defects')]);
    await engine.sync();
    expect(server.pullLog.at(-1)!.scopes).toEqual([projectScope(PROJECT_A, 'defects')]);
  });

  it('sends a project drain with the grant that came with the revocation, and keeps the first', async () => {
    const { server, store, clock, engine } = setup();
    await engine.sync();
    server.failNext(1, new SyncHttpError(503));
    await createDefect(store, clock, { title: 'Written before removal' });
    await engine.sync();

    const grant = (token: string) => ({
      token,
      expiresAt: '2026-11-02T00:00:00Z',
      orgId: 'org_1',
      projectId: PROJECT_A,
      module: null,
    });
    server.revoke({ projectId: PROJECT_A, module: null, drainGrant: grant('first') });
    await engine.sync();

    const drainPush = server.pushLog.find((p) => p.drain);
    expect(drainPush?.grant?.token).toBe('first');
    expect(drainPush?.mutations.map((m) => m.projectId)).toEqual([PROJECT_A]);
  });

  it('keeps the first grant when a second arrives for a drain under way', async () => {
    const { store, clock, engine } = setup();
    await createDefect(store, clock, { title: 'One' });
    const grant = (token: string) => ({
      token,
      expiresAt: '2026-11-02T00:00:00Z',
      orgId: 'org_1',
      projectId: null,
      module: null,
    });
    await engine.beginOrgDrain(null, grant('first'));
    await engine.beginOrgDrain(null, grant('second'));
    expect(engine.getDrains()[0]?.grant?.token).toBe('first');
  });

  it('drains unsent work in a revoked project, then purges it', async () => {
    const { server, store, clock, engine } = setup();
    await engine.sync();
    server.failNext(1, new SyncHttpError(503));
    await createDefect(store, clock, { title: 'Written before removal' });
    await engine.sync(); // push fails; work stays queued

    server.revoke({ projectId: PROJECT_A, module: null });
    const events: SyncEvent[] = [];
    engine.subscribe((e) => events.push(e));
    // Normal push is refused for the revoked project, the pull reveals the revocation, and the drain sends.
    await engine.sync();

    const drainPush = server.pushLog.find((p) => p.drain);
    expect(drainPush?.mutations.map((m) => m.command)).toEqual(['defects.create']);
    expect(server.lateSubmissions).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'purged', scope: { projectId: PROJECT_A, module: null } }),
    );
    expect(store.records.size).toBe(0);
    expect(engine.getDrains()).toEqual([]);
  });

  it('holds drained work for review and blocks new edits while it drains', async () => {
    const { server, store, clock, engine } = setup();
    await createDefect(store, clock, { title: 'Before' });
    clock.advance(60_000);
    const revokedAt = clock.iso();
    clock.advance(60_000);
    await createDefect(store, clock, { title: 'After' });
    server.endAccess(revokedAt);

    await engine.beginOrgDrain(revokedAt);
    expect(engine.canEdit(PROJECT_A, 'defects')).toBe(false);
    expect((await engine.status()).phase).toBe('draining');

    const events: SyncEvent[] = [];
    engine.subscribe((e) => events.push(e));
    expect(await engine.sync()).toEqual({ ok: true });

    // Only work queued before access ended is sent, with the drain grant, and nothing is pulled.
    expect(server.pushLog).toEqual([
      {
        drain: true,
        mutations: [
          expect.objectContaining({ payload: expect.objectContaining({ title: 'Before' }) }),
        ],
      },
    ]);
    expect(server.pullLog).toHaveLength(0);
    expect(server.lateSubmissions).toHaveLength(1);
    expect(events).toContainEqual({ type: 'purged', scope: null, discarded: { defect: 1 } });
    expect(store.records.size).toBe(0);
    expect((await engine.status()).phase).toBe('wiped');
    expect(await engine.sync()).toMatchObject({ ok: false, kind: 'wiped' });
  });

  it('wipes after 72 hours even if the drain could not send', async () => {
    const { server, store, clock, engine } = setup();
    await createDefect(store, clock, { title: 'Stuck' });
    await engine.beginOrgDrain(null);
    server.failNext(1);
    expect(await engine.sync()).toMatchObject({ ok: false, kind: 'retry' });
    expect(await store.listOutbox()).toHaveLength(1);

    clock.advance(DRAIN_WINDOW_MS);
    const events: SyncEvent[] = [];
    engine.subscribe((e) => events.push(e));
    await engine.sync();
    expect(events).toContainEqual({ type: 'purged', scope: null, discarded: { defect: 1 } });
    expect(await store.listOutbox()).toHaveLength(0);
  });

  it('"sign out and wipe now" skips the drain and reports what was discarded', async () => {
    const { server, store, clock, engine } = setup();
    await createDefect(store, clock, { title: 'One' });
    const d = await createDefect(store, clock, { title: 'Two' });
    await addPhoto(store, clock, d.entityId);
    expect(await engine.wipeNow()).toEqual({ defect: 2, photo: 1 });
    expect(server.pushLog).toHaveLength(0);
    expect(store.records.size).toBe(0);
    expect(engine.canEdit(PROJECT_A)).toBe(false);
  });
});

describe('failures', () => {
  it('honours Retry-After and backs off further on repeated failures', async () => {
    const { server, store, clock, engine } = setup();
    await createDefect(store, clock, { title: 'x' });
    server.failNext(1, new SyncHttpError(429, { retryAfterMs: 30_000 }));
    const first = await engine.sync();
    expect(first).toMatchObject({ ok: false, kind: 'retry', retryAt: clock.now() + 30_000 });

    server.failNext(3, new SyncHttpError(503));
    const delays: number[] = [];
    for (let i = 0; i < 3; i++) {
      const outcome = await engine.sync();
      if (!outcome.ok) delays.push(outcome.retryAt! - clock.now());
    }
    // random() is 0.5, so each delay is half the ceiling, which doubles each time.
    expect(delays).toEqual([2_000, 4_000, 8_000]);
  });

  it('stops for sign-in on 401 and for an update on 426, keeping the work', async () => {
    const { server, store, clock, engine } = setup();
    await createDefect(store, clock, { title: 'x' });
    server.failNext(1, new SyncHttpError(401));
    expect(await engine.sync()).toMatchObject({ ok: false, kind: 'auth', retryAt: null });
    expect((await engine.status()).phase).toBe('auth_required');

    server.failNext(1, new SyncHttpError(426, { code: 'app.upgrade_required' }));
    expect(await engine.sync()).toMatchObject({ ok: false, kind: 'upgrade' });
    expect((await engine.status()).phase).toBe('upgrade_required');
    expect(await engine.sync()).toMatchObject({ ok: false, kind: 'upgrade' });
    expect(await store.listOutbox()).toHaveLength(1);
  });

  it('shares one run between concurrent callers', async () => {
    const { server, engine } = setup();
    const [a, b] = await Promise.all([engine.sync(), engine.sync()]);
    expect(a).toEqual(b);
    expect(server.pullLog).toHaveLength(1);
  });
});
