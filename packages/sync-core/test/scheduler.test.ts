import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncScheduler, type SyncEngine, type SyncOutcome, type Timers } from '../src';

const timers: Timers = {
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

function fakeEngine(outcomes: SyncOutcome[] = []) {
  const calls: { pull: boolean; at: number }[] = [];
  const engine = {
    sync: vi.fn(async (options: { pull?: boolean }) => {
      calls.push({ pull: options.pull !== false, at: Date.now() });
      return outcomes.shift() ?? { ok: true };
    }),
  };
  return { engine: engine as unknown as SyncEngine, calls };
}

const t0 = Date.parse('2026-10-02T09:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(t0);
});
afterEach(() => vi.useRealTimers());

describe('SyncScheduler', () => {
  it('syncs on start and coalesces a burst of local writes into one push', async () => {
    const { engine, calls } = fakeEngine();
    const scheduler = new SyncScheduler(engine, timers, { pollIntervalMs: null });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toEqual([{ pull: true, at: t0 + 1_000 }]);

    for (let i = 0; i < 5; i++) {
      scheduler.request('local_write');
      await vi.advanceTimersByTimeAsync(500);
    }
    await vi.advanceTimersByTimeAsync(3_000);
    expect(calls.slice(1)).toEqual([{ pull: false, at: t0 + 4_000 }]);
  });

  it('runs again after the current run when asked mid-run', async () => {
    let release!: () => void;
    const engine = {
      sync: vi.fn(
        () =>
          new Promise<SyncOutcome>((resolve) => {
            release = () => resolve({ ok: true });
          }),
      ),
    } as unknown as SyncEngine;
    const scheduler = new SyncScheduler(engine, timers, { pollIntervalMs: null });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1_000);
    scheduler.request('hint');
    scheduler.request('hint');
    expect(engine.sync).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(engine.sync).toHaveBeenCalledTimes(2);
  });

  it('waits out the backoff unless the network comes back', async () => {
    const retryAt = t0 + 1_000 + 60_000;
    const { engine, calls } = fakeEngine([
      { ok: false, kind: 'retry', retryAt, error: null },
      { ok: false, kind: 'retry', retryAt: t0 + 10 * 60_000, error: null },
    ]);
    const scheduler = new SyncScheduler(engine, timers, { pollIntervalMs: null });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1_000);
    scheduler.request('local_write');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls.map((c) => c.at)).toEqual([t0 + 1_000, retryAt]);
    // The second failure backs off ten minutes, but connectivity returning retries now.
    scheduler.request('connectivity');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(3);
  });

  it('stops after an auth failure until the user acts', async () => {
    const { engine, calls } = fakeEngine([{ ok: false, kind: 'auth', retryAt: null, error: null }]);
    const scheduler = new SyncScheduler(engine, timers, { pollIntervalMs: 60_000 });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1_000);
    scheduler.request('hint');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(calls).toHaveLength(1);
    scheduler.request('manual');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(2);
  });

  it('polls as a fallback, and stop() cancels everything', async () => {
    const { engine, calls } = fakeEngine();
    const scheduler = new SyncScheduler(engine, timers, { pollIntervalMs: 5 * 60_000 });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1_000 + 2 * 5 * 60_000);
    expect(calls).toHaveLength(3);
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(calls).toHaveLength(3);
  });
});
