// Property test (mobile 02 §2.10): random interleavings of offline edits on two devices and the web converge
// to the server's state, and nothing a user did is silently lost.

import { uuidv7 } from '@archova/domain';
import { describe, expect, it } from 'vitest';
import { SyncEngine, SyncHttpError, projectScope } from '../src';
import { FakeSyncServer, MemorySyncStore } from '../src/testing';
import { COMMANDS, FakeClock, PROJECT_A } from './helpers';

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const scopes = [projectScope(PROJECT_A, 'defects'), projectScope(PROJECT_A, 'diary')];
const MODULE_OF: Record<string, string> = { defect: 'defects', diary_labour: 'diary' };

async function runScenario(seed: number) {
  const random = mulberry32(seed);
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)]!;
  const clock = new FakeClock();
  const server = new FakeSyncServer({ ...COMMANDS });
  const devices = [0, 1].map(() => {
    const store = new MemorySyncStore({ moduleOf: (t) => MODULE_OF[t]! });
    const engine = new SyncEngine({
      store,
      transport: server.transport(),
      scopes: () => scopes,
      clock,
      random,
      pushBatchSize: 1 + Math.floor(random() * 4),
    });
    return { store, engine };
  });
  const created: string[] = [];
  const attention = new Set<string>();

  const queue = async (
    store: MemorySyncStore,
    command: keyof typeof COMMANDS,
    id: string,
    data: Record<string, unknown>,
    fields: Record<string, unknown>,
  ) => {
    const record = store.get(COMMANDS[command].entityType, id);
    const entry = await store.write(
      { entityType: COMMANDS[command].entityType, id, data },
      {
        mutationId: uuidv7(clock.now()),
        command,
        projectId: PROJECT_A,
        baseVersion:
          command.endsWith('create') || command.endsWith('Labour')
            ? null
            : (record?.version ?? null),
        clientAt: clock.iso(),
        payload: { projectId: PROJECT_A, ...fields },
        dependsOn: [],
      },
    );
    created.push(entry.mutationId);
  };

  for (let step = 0; step < 60; step++) {
    clock.advance(1_000);
    const { store, engine } = pick(devices);
    const defects = [...store.records.values()].filter((r) => r.entityType === 'defect');
    const roll = random();
    if (roll < 0.2) {
      const id = uuidv7(clock.now());
      const fields = { title: `Defect ${step}` };
      await queue(store, 'defects.create', id, { projectId: PROJECT_A, ...fields }, fields);
    } else if (roll < 0.45 && defects.length > 0) {
      const target = pick(defects);
      const fields = { title: `Edit ${step}` };
      await queue(
        store,
        'defects.update',
        target.id,
        { ...(target.data as object), ...fields },
        fields,
      );
    } else if (roll < 0.6) {
      const fields = {
        trade: pick(['Carpentry', 'Electrical', 'Plumbing']),
        workers: 1 + (step % 5),
      };
      await queue(
        store,
        'diary.addLabour',
        uuidv7(clock.now()),
        { projectId: PROJECT_A, ...fields },
        fields,
      );
    } else if (roll < 0.7) {
      const all = [...server.records.values()].filter((r) => r.entityType === 'defect' && r.data);
      if (all.length > 0) {
        const target = pick(all);
        server.serverWrite({ ...target, data: { ...target.data, title: `Web ${step}` } });
      }
    } else if (roll < 0.8) {
      server.failNext(1, random() < 0.5 ? new SyncHttpError(0) : new SyncHttpError(503));
      await engine.sync({ pull: random() < 0.5 });
    } else {
      await engine.sync({ pull: random() < 0.7 });
    }
  }

  // Back on site-office wifi: everyone syncs, resolves "Needs attention" by discarding, and syncs again.
  server.clearFailures();
  for (let round = 0; round < 3; round++) {
    for (const { store, engine } of devices) {
      expect(await engine.sync()).toEqual({ ok: true });
      const flagged = await store.listOutbox({ status: 'needs_attention' });
      for (const e of flagged) attention.add(e.mutationId);
      await engine.discard(flagged.map((e) => e.mutationId));
    }
  }

  const expected = new Map(
    [...server.records.values()]
      .filter((r) => r.data !== null)
      .map((r) => [`${r.entityType}:${r.id}`, { version: r.version, data: r.data }]),
  );
  for (const { store } of devices) {
    expect(await store.listOutbox()).toEqual([]);
    const actual = new Map(
      [...store.records.entries()].map(([k, r]) => [k, { version: r.version, data: r.data }]),
    );
    expect(actual).toEqual(expected);
  }
  // Every change a user made was either applied or shown to them; none vanished.
  for (const id of created) {
    const applied = server.applied.get(id)?.status === 'applied';
    expect(applied || attention.has(id), `mutation ${id} was lost`).toBe(true);
  }
}

describe('convergence', () => {
  it.each(Array.from({ length: 40 }, (_, i) => i + 1))('seed %i', async (seed) => {
    await runScenario(seed);
  });
});
