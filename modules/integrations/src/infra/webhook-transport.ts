import { request } from 'node:https';
import { lookup } from 'node:dns';
import { isPublicAddress } from '../domain/webhooks/url-safety';

export interface WebhookRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs?: number;
}

/** What came back, or why nothing did. Never the response body: an endpoint's reply is not ours to store. */
export interface WebhookResult {
  status: number | null;
  error: string | null;
}

export interface WebhookTransport {
  send(req: WebhookRequest): Promise<WebhookResult>;
}

const TIMEOUT_MS = 10_000;

type AllCallback = (
  err: Error | null,
  addresses: Array<{ address: string; family: number }>,
) => void;

/**
 * HTTPS POST that refuses to connect to a non-public address. The check runs inside the socket's own lookup, on the
 * address it is about to use, so there is no gap between "resolved" and "connected" for a rebinding attack. Redirects
 * are never followed.
 */
export function createHttpsTransport(): WebhookTransport {
  return {
    send(req) {
      return new Promise<WebhookResult>((resolve) => {
        let done = false;
        const finish = (r: WebhookResult) => {
          if (!done) {
            done = true;
            resolve(r);
          }
        };
        try {
          const u = new URL(req.url);
          const r = request(
            {
              protocol: 'https:',
              hostname: u.hostname,
              port: 443,
              path: `${u.pathname}${u.search}`,
              method: 'POST',
              headers: { ...req.headers, 'content-length': String(Buffer.byteLength(req.body)) },
              timeout: req.timeoutMs ?? TIMEOUT_MS,
              lookup: (hostname, opts, cb) =>
                lookup(hostname, { all: true }, (err, addresses) => {
                  if (err) return cb(err, '', 4);
                  const bad = addresses.find((a) => !isPublicAddress(a.address));
                  if (bad || addresses.length === 0)
                    return cb(new Error('blocked: not a public address'), '', 4);
                  // Node may ask for every address (autoSelectFamily); answer in the shape it asked for.
                  if (opts.all) return (cb as unknown as AllCallback)(null, addresses);
                  const first = addresses[0]!;
                  cb(null, first.address, first.family);
                }),
            },
            (res) => {
              res.resume();
              res.on('end', () => finish({ status: res.statusCode ?? null, error: null }));
              res.on('error', (e) => finish({ status: res.statusCode ?? null, error: e.message }));
            },
          );
          r.on('timeout', () => {
            r.destroy();
            finish({ status: null, error: 'timeout' });
          });
          r.on('error', (e) => finish({ status: null, error: e.message.slice(0, 200) }));
          r.end(req.body);
        } catch (e) {
          finish({ status: null, error: (e as Error).message.slice(0, 200) });
        }
      });
    },
  };
}
