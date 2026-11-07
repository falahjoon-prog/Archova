import { ProviderRequestError, type AccountingProviderName } from './types';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// Reads a JSON response, turning failures into ProviderRequestError. 429 and 5xx are retryable; the rest are not.
export async function readJson(provider: AccountingProviderName, res: Response): Promise<unknown> {
  if (res.ok) return res.status === 204 ? null : res.json();
  const body = (await res.text().catch(() => '')).slice(0, 300);
  throw new ProviderRequestError(
    provider,
    res.status,
    res.status === 429 || res.status >= 500,
    `${provider} ${res.status}: ${body}`,
  );
}

// Token bucket: `perMinute` calls with at most `concurrency` in flight (Xero budget 50/min, concurrency 2;
// integrations/02 §4). The clock is injected so tests do not sleep.
export class RateLimiter {
  private readonly stamps: number[] = [];
  private inFlight = 0;
  constructor(
    private readonly perMinute: number,
    private readonly concurrency: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    for (;;) {
      const t = this.now();
      while (this.stamps.length > 0 && (this.stamps[0] as number) <= t - 60_000)
        this.stamps.shift();
      if (this.inFlight < this.concurrency && this.stamps.length < this.perMinute) break;
      const wait =
        this.stamps.length >= this.perMinute ? (this.stamps[0] as number) + 60_000 - t : 50;
      await this.sleep(Math.max(wait, 1));
    }
    this.stamps.push(this.now());
    this.inFlight++;
    try {
      return await fn();
    } finally {
      this.inFlight--;
    }
  }
}
