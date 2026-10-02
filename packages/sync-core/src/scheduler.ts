// When sync runs (mobile 02 §2.6). Triggers are coalesced: a burst of local writes or hints becomes one
// run, a run in progress is never doubled, and failures wait out the engine's backoff.

import type { SyncOutcome, SyncRunOptions } from './engine';

/** What the scheduler runs: the engine, or the app's wrapper that also drains its file queue. */
export interface Syncable {
  sync(options?: SyncRunOptions): Promise<SyncOutcome>;
}

export type SyncTrigger =
  | 'app_open'
  | 'foreground'
  | 'connectivity'
  /** A local write queued work: push only, after a short debounce. */
  | 'local_write'
  /** A realtime or silent-push hint that the project changed. */
  | 'hint'
  | 'background'
  | 'poll'
  /** The user tapped "Sync now", or signed in again after an auth failure. */
  | 'manual';

export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

export interface SyncSchedulerOptions {
  localWriteDebounceMs?: number;
  triggerDebounceMs?: number;
  /** Fallback poll when neither the socket nor silent push is available; null turns it off. */
  pollIntervalMs?: number | null;
}

/** Triggers that skip a pending backoff: the user is waiting, or the network just came back. */
const URGENT: ReadonlySet<SyncTrigger> = new Set([
  'app_open',
  'foreground',
  'connectivity',
  'manual',
]);

export class SyncScheduler {
  private readonly localWriteDebounceMs: number;
  private readonly triggerDebounceMs: number;
  private pollIntervalMs: number | null;

  private timer: unknown = null;
  private dueAt: number | null = null;
  private wantPull = false;
  private backoffUntil: number | null = null;
  private running = false;
  private rerun = false;
  private stopped = true;
  /** Auth, upgrade or wipe: wait for an explicit trigger rather than retrying. */
  private halted = false;

  constructor(
    private readonly engine: Syncable,
    private readonly timers: Timers,
    options: SyncSchedulerOptions = {},
  ) {
    this.localWriteDebounceMs = options.localWriteDebounceMs ?? 3_000;
    this.triggerDebounceMs = options.triggerDebounceMs ?? 1_000;
    this.pollIntervalMs =
      options.pollIntervalMs === undefined ? 5 * 60_000 : options.pollIntervalMs;
  }

  start(): void {
    this.stopped = false;
    this.request('app_open');
  }

  stop(): void {
    this.stopped = true;
    this.clear();
  }

  /** Turn the fallback poll on or off as hint channels connect and drop. */
  setPollInterval(ms: number | null): void {
    this.pollIntervalMs = ms;
  }

  request(trigger: SyncTrigger): void {
    if (this.stopped) return;
    if (trigger === 'manual') this.halted = false;
    if (this.halted) return;
    if (trigger !== 'local_write') this.wantPull = true;
    if (this.running) {
      this.rerun = true;
      return;
    }
    const now = this.timers.now();
    let at = now + (trigger === 'local_write' ? this.localWriteDebounceMs : this.triggerDebounceMs);
    if (this.backoffUntil !== null) {
      if (URGENT.has(trigger)) this.backoffUntil = null;
      else at = Math.max(at, this.backoffUntil);
    }
    this.schedule(at);
  }

  private schedule(at: number) {
    if (this.dueAt !== null && this.dueAt <= at) return;
    this.clear();
    this.dueAt = at;
    this.timer = this.timers.setTimeout(
      () => {
        this.timer = null;
        this.dueAt = null;
        void this.fire();
      },
      Math.max(0, at - this.timers.now()),
    );
  }

  private clear() {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
    this.dueAt = null;
  }

  private async fire(): Promise<void> {
    if (this.stopped) return;
    this.running = true;
    const pull = this.wantPull;
    this.wantPull = false;
    let outcome: SyncOutcome;
    try {
      outcome = await this.engine.sync({ pull });
    } finally {
      this.running = false;
    }
    if (this.stopped) return;

    if (!outcome.ok && outcome.retryAt === null) {
      this.halted = true;
      return;
    }
    if (!outcome.ok) {
      this.wantPull = this.wantPull || pull;
      this.backoffUntil = outcome.retryAt;
      this.schedule(outcome.retryAt!);
      return;
    }
    this.backoffUntil = null;
    if (this.rerun) {
      this.rerun = false;
      this.schedule(this.timers.now() + this.triggerDebounceMs);
      return;
    }
    if (this.pollIntervalMs !== null) {
      this.wantPull = true;
      this.schedule(this.timers.now() + this.pollIntervalMs);
    }
  }
}
