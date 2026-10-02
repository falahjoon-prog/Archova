import { describe, expect, it } from 'vitest';
import type { SyncEngine } from '@archova/sync-core';
import type { UploadQueue } from '../lib/files/upload-queue';
import { createDeviceSync } from '../lib/sync/device-sync';

const uploads = (results: { retry: boolean }[]) =>
  ({
    drain: async () => ({ completed: 0, failed: 0, ...results.shift()! }),
  }) as unknown as UploadQueue;

describe('createDeviceSync', () => {
  it('drains files before running the engine', async () => {
    const order: string[] = [];
    const sync = createDeviceSync({
      uploads: {
        drain: async () => (order.push('files'), { completed: 1, failed: 0, retry: false }),
      } as unknown as UploadQueue,
      engine: { sync: async () => (order.push('engine'), { ok: true }) } as unknown as SyncEngine,
    });
    expect(await sync.sync()).toEqual({ ok: true });
    expect(order).toEqual(['files', 'engine']);
  });

  it('asks to retry when a file is waiting for signal, with growing backoff', async () => {
    const sync = createDeviceSync({
      uploads: uploads([{ retry: true }, { retry: true }, { retry: false }]),
      engine: null,
      now: () => 0,
      random: () => 0.5,
    });
    expect(await sync.sync()).toMatchObject({ ok: false, kind: 'retry', retryAt: 1_000 });
    expect(await sync.sync()).toMatchObject({ ok: false, kind: 'retry', retryAt: 2_000 });
    expect(await sync.sync()).toEqual({ ok: true });
  });

  it("reports the engine's failure first", async () => {
    const failure = { ok: false, kind: 'auth', retryAt: null, error: null } as const;
    const sync = createDeviceSync({
      uploads: uploads([{ retry: true }]),
      engine: { sync: async () => failure } as unknown as SyncEngine,
    });
    expect(await sync.sync()).toBe(failure);
  });
});
