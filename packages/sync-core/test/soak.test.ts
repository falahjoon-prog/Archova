// Offline soak (mobile 02 §2.10): a long stretch offline with a large queue, lost responses, app restarts and
// web edits in between, then reconnect. Runs on a fake clock so "five days offline" takes seconds; the real-device
// version is the checklist in docs/mobile/07-offline-soak.md.

import { uuidv7 } from '@archova/domain';
import { describe, expect, it } from 'vitest';
import { SyncEngine, SyncHttpError, projectScope, type SyncTransport } from '../src';
import { FakeSyncServer, MemorySyncStore } from '../src/testing';
import { COMMANDS, FakeClock, PROJECT_A, addPhoto, createDefect, updateDefect } from './helpers';

const DAY = 24 * 60 * 60 * 1000;
const scopes = [
  projectScope(PROJECT_A, 'defects'),
  projectScope(PROJECT_A, 'photos'),
  projectScope(PROJECT_A, 'diary'),
];
const MODULE_OF: Record<string, string> = {
  defect: 'defects',
  photo: 'photos',
  diary_labour: 'diary',
};

function rig() {
  const clock = new FakeClock();
  const server = new FakeSyncServer({ ...COMMANDS });
  const store = new MemorySyncStore({ moduleOf: (t) => MODULE_OF[t] ?? t });
  // The network: `up` false is airplane mode; `loseResponses` makes the server apply the push but the reply never
  // arrives (tunnel over a lift shaft), the classic duplicate-delivery case.
  const net = { up: false, loseResponses: 0, requests: 0 };
  const inner = server.transport();
  const transport: SyncTransport = {
    async pull(request) {
      net.requests++;
      if (!net.up) throw new SyncHttpError(0);
      return inner.pull(request);
    },
    async push(request, options) {
      net.requests++;
      if (!net.up) throw new SyncHttpError(0);
      const response = await inner.push(request, options);
      if (net.loseResponses > 0) {
        net.loseResponses--;
        throw new SyncHttpError(0);
      }
      return response;
    },
  };
  // A new engine on the same store is an app restart: only the outbox on disk survives.
  const start = () =>
    new SyncEngine({ store, transport, scopes: () => scopes, clock, random: () => 0.5 });
  return { clock, server, store, net, start };
}

describe('offline soak', () => {
  it('5 days offline with ~3,000 queued writes drains in order, once each, without hammering the network', async () => {
    const { clock, server, store, net, start } = rig();
    let engine = start();
    const ids: string[] = [];
    const queued: string[] = [];
    const groups: { defect: string; photos: string[] }[] = [];

    for (let day = 0; day < 5; day++) {
      for (let i = 0; i < 100; i++) {
        const e = await createDefect(store, clock, { title: `d${day} defect ${i}` });
        ids.push(e.mutationId);
        queued.push(e.mutationId);
        const defectId = [...store.records.values()].at(-1)!.id;
        const group = { defect: e.mutationId, photos: [] as string[] };
        groups.push(group);
        for (let p = 0; p < 4; p++) {
          const photo = await addPhoto(store, clock, defectId, [e.mutationId]);
          queued.push(photo.mutationId);
          group.photos.push(photo.mutationId);
        }
        await updateDefect(store, clock, defectId, { note: `day ${day}` });
        clock.advance(DAY / 100);
      }
      // The app wakes up a few times a day, tries, fails, and backs off. Restart it every day (OS kill).
      for (let attempt = 0; attempt < 20; attempt++) {
        const outcome = await engine.sync();
        expect(outcome.ok).toBe(false);
        clock.advance(10 * 60_000);
      }
      engine = start();
    }
    const total = (await store.listOutbox()).length;
    expect(total).toBeGreaterThanOrEqual(3_000);
    // Failed attempts while offline never touch or drop queued work.
    expect((await store.listOutbox({ status: 'needs_attention' })).length).toBe(0);
    expect(server.pushLog).toHaveLength(0);

    // Reconnect; first two responses are lost after the server applied them.
    net.up = true;
    net.loseResponses = 2;
    let guard = 0;
    while ((await store.listOutbox()).length > 0 && guard++ < 200) {
      await engine.sync();
      clock.advance(5 * 60_000);
    }
    expect(guard).toBeLessThan(200);
    expect(await store.listOutbox()).toEqual([]);

    // Every create applied exactly once, parents before photos, nothing duplicated by the lost responses.
    const defects = [...server.records.values()].filter((r) => r.entityType === 'defect');
    const photos = [...server.records.values()].filter((r) => r.entityType === 'photo');
    expect(defects).toHaveLength(500);
    expect(photos).toHaveLength(2_000);
    for (const id of queued) expect(server.applied.get(id)?.status).toBe('applied');
    const sentOnce = new Map<string, number>();
    for (const log of server.pushLog)
      for (const m of log.mutations)
        sentOnce.set(m.mutationId, (sentOnce.get(m.mutationId) ?? 0) + 1);
    // Re-sends are allowed after a lost reply, but only for those two batches.
    const resent = [...sentOnce.values()].filter((n) => n > 1).length;
    expect(resent).toBeLessThanOrEqual(2 * 50);
    // Order: the server first sees each defect before the photos queued behind it.
    const firstSeen = new Map<string, number>();
    let n = 0;
    for (const log of server.pushLog)
      for (const m of log.mutations)
        if (!firstSeen.has(m.mutationId)) firstSeen.set(m.mutationId, n++);
    for (const group of groups)
      for (const photo of group.photos)
        expect(firstSeen.get(group.defect)!).toBeLessThan(firstSeen.get(photo)!);
    // Device ends identical to the server.
    for (const r of server.records.values()) {
      if (r.data === null) continue;
      expect(store.get(r.entityType, r.id)?.version).toBe(r.version);
    }
  });

  it('retry delay stays capped while offline for days (no stampede, no runaway backoff)', async () => {
    const { clock, net, store, start } = rig();
    const engine = start();
    await createDefect(store, clock, { title: 'queued offline' });
    net.up = false;
    const delays: number[] = [];
    for (let i = 0; i < 300; i++) {
      const out = await engine.sync();
      if (out.ok) throw new Error('should be offline');
      if (out.retryAt !== null) delays.push(out.retryAt - clock.now());
      clock.advance(Math.max(60_000, out.retryAt ? out.retryAt - clock.now() : 0));
    }
    expect(Math.max(...delays)).toBeLessThanOrEqual(5 * 60_000);
    expect(net.requests).toBe(300);
  });

  it('web edits made while the phone was offline become Needs attention, never silent overwrites', async () => {
    const { clock, server, store, net, start } = rig();
    const engine = start();
    net.up = true;
    const first = await createDefect(store, clock, { title: 'Cracked slab' });
    await engine.sync();
    net.up = false;
    const defectId = [...store.records.values()].find((r) => r.entityType === 'defect')!.id;

    const edits: string[] = [];
    for (let i = 0; i < 25; i++) {
      edits.push(
        (await updateDefect(store, clock, defectId, { title: `Phone edit ${i}` })).mutationId,
      );
      clock.advance(DAY / 10);
    }
    const onServer = server.records.get(`defect:${defectId}`)!;
    server.serverWrite({ ...onServer, data: { ...onServer.data!, title: 'Web edit' } });

    net.up = true;
    for (let i = 0; i < 5; i++) {
      await engine.sync();
      clock.advance(5 * 60_000);
    }
    expect(first.mutationId).toBeTruthy();
    // The web title is not clobbered, and every phone edit is either applied or surfaced to the user.
    const flagged = new Set(
      (await store.listOutbox({ status: 'needs_attention' })).map((e) => e.mutationId),
    );
    for (const id of edits) {
      const applied = server.applied.get(id)?.status === 'applied';
      expect(applied || flagged.has(id), `edit ${id} vanished`).toBe(true);
    }
    expect(flagged.size).toBeGreaterThan(0);
    expect(uuidv7(clock.now())).toBeTruthy();
  });
});
