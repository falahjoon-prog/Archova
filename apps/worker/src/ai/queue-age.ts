// How far behind the ai-worker's event queue is. A re-stamp or drop that waits is stale access or stale text that
// stays searchable, so Jeff alerts on `oldestMs` for `subscribers-ai` (over 5 minutes). Logged once a minute with ids
// and counts only; a line at warn level when the oldest job is over the threshold.

/** The part of a BullMQ queue this reads. */
export interface AgeQueue {
  name: string;
  getJobCounts(...types: Array<'waiting' | 'delayed' | 'active'>): Promise<Record<string, number>>;
  getJobs(
    types: Array<'waiting' | 'delayed'>,
    start: number,
    end: number,
    asc: boolean,
  ): Promise<Array<{ timestamp: number }>>;
}

export interface QueueAge {
  queue: string;
  waiting: number;
  /** Failed attempts waiting for their retry. */
  retrying: number;
  active: number;
  /** Age of the oldest job still waiting or retrying, 0 when there is none. */
  oldestMs: number;
}

export const LAG_ALERT_MS = 5 * 60_000;

export async function measureQueue(queue: AgeQueue, now: number): Promise<QueueAge> {
  const counts = await queue.getJobCounts('waiting', 'delayed', 'active');
  const oldest = await queue.getJobs(['waiting', 'delayed'], 0, 0, true);
  const created = oldest.map((j) => j.timestamp);
  return {
    queue: queue.name,
    waiting: counts.waiting ?? 0,
    retrying: counts.delayed ?? 0,
    active: counts.active ?? 0,
    oldestMs: created.length ? Math.max(0, now - Math.min(...created)) : 0,
  };
}

export interface QueueAgeLog {
  info: (o: object, msg: string) => void;
  warn: (o: object, msg: string) => void;
}

/** Starts the once-a-minute report; the returned function stops it. Never throws: a failed read is logged and skipped. */
export function watchQueueAge(
  queue: AgeQueue,
  log: QueueAgeLog,
  opts: { everyMs?: number; now?: () => number } = {},
): () => void {
  const now = opts.now ?? Date.now;
  const tick = async () => {
    try {
      const age = await measureQueue(queue, now());
      (age.oldestMs > LAG_ALERT_MS ? log.warn : log.info)(
        age,
        age.oldestMs > LAG_ALERT_MS ? 'ai queue is behind' : 'ai queue age',
      );
    } catch (err) {
      log.warn(
        { queue: queue.name, error: err instanceof Error ? err.name : 'unknown' },
        'ai queue age unreadable',
      );
    }
  };
  const timer = setInterval(() => void tick(), opts.everyMs ?? 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
