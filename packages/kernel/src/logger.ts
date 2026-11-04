import { pino, type DestinationStream, type Logger } from 'pino';

const SECRET_PATTERNS: [RegExp, string][] = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]'],
  [/\bpk_live_[A-Za-z0-9_-]+/g, 'pk_live_[redacted]'],
  [/\bwhsec_[A-Za-z0-9+/=_-]+/g, 'whsec_[redacted]'],
];

/** Removes bearer tokens, personal access tokens and webhook secrets from free text (messages, errors, URLs). */
export function scrubSecrets(text: string): string {
  let out = text;
  for (const [re, to] of SECRET_PATTERNS) out = out.replace(re, to);
  return out;
}

const MAX_DEPTH = 4;
function scrubValue(v: unknown, depth: number): unknown {
  if (typeof v === 'string') return scrubSecrets(v);
  if (v instanceof Error) {
    // Errors keep their own class; copy so the original (thrown elsewhere) is untouched.
    const copy = Object.create(Object.getPrototypeOf(v)) as Error;
    Object.defineProperties(copy, Object.getOwnPropertyDescriptors(v));
    copy.message = scrubSecrets(v.message);
    if (v.stack) copy.stack = scrubSecrets(v.stack);
    return copy;
  }
  if (depth >= MAX_DEPTH || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => scrubValue(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) out[k] = scrubValue(x, depth + 1);
  return out;
}

// Structured logs with requestId, orgId, userId. Never log tokens, cookies, file contents or full payloads.
export function createLogger(
  name: string,
  level = process.env.LOG_LEVEL ?? 'info',
  destination?: DestinationStream,
): Logger {
  return pino(
    {
      name,
      level,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-api-key"]',
          'res.headers["set-cookie"]',
          '*.password',
          '*.token',
          '*.secret',
          '*.refresh_token',
          '*.access_token',
          '*.code_verifier',
        ],
        censor: '[redacted]',
      },
      // Tokens can also turn up inside a message, an error or a URL; scrub those before they are written.
      hooks: {
        logMethod(args, method) {
          method.apply(this, args.map((a) => scrubValue(a, 0)) as Parameters<typeof method>);
        },
      },
    },
    destination,
  );
}

export type { Logger };
