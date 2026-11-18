// A cookie-session client for the public API, the way the browser uses it (Origin and CSRF headers, Idempotency-Key
// on POST, retry on 429). Used by the demo seed scripts.
import { randomUUID } from 'node:crypto';

export class Session {
  constructor(private readonly origin: string) {}

  private cookies = new Map<string, string>();
  private csrf: string | null = null;
  /** ETag of the last response, for If-Match on the next update. */
  etag: string | null = null;

  async call<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ): Promise<{ status: number; json: T }> {
    const headers: Record<string, string> = { accept: 'application/json', ...extra };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET') {
      headers.origin = this.origin;
      if (this.csrf) headers['x-csrf-token'] = this.csrf;
    }
    if (method === 'POST' && !headers['idempotency-key']) headers['idempotency-key'] = randomUUID();
    let res: Response;
    // Rate limits (Nova today, the WAF later) answer 429 with Retry-After; wait and send the same request again,
    // with the same Idempotency-Key.
    for (let attempt = 0; ; attempt++) {
      if (this.cookies.size)
        headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
      res = await fetch(`${this.origin}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status !== 429 || attempt >= 4) break;
      const wait = Math.min(Number(res.headers.get('retry-after')) || 5, 60);
      console.log(`${method} ${path} rate limited; retrying in ${wait}s`);
      await res.text();
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair!.indexOf('=');
      const name = pair!.slice(0, i).trim();
      const value = pair!.slice(i + 1).trim();
      if (value === '' || /max-age=0/i.test(c)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    this.etag = res.headers.get('etag');
    const text = await res.text();
    const json = (text ? JSON.parse(text) : {}) as T & { csrfToken?: string };
    if (json && typeof json === 'object' && json.csrfToken) this.csrf = json.csrfToken;
    return { status: res.status, json };
  }

  async ok<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    extra?: Record<string, string>,
  ): Promise<T> {
    const r = await this.call<T>(method, path, body, extra);
    if (r.status >= 300)
      throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  }
}
