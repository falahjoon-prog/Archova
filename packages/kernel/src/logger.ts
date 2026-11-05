import { pino, type Logger } from 'pino';

// Structured logs with requestId, orgId, userId. Never log tokens, cookies, file contents or full payloads.
export function createLogger(name: string, level = process.env.LOG_LEVEL ?? 'info'): Logger {
  return pino({
    name,
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.token',
        '*.refresh_token',
        '*.access_token',
        '*.code_verifier',
        // A drain grant (X38) rides in an error body: never in a log line or an error report.
        '*.drainGrant',
        '*.drainGrant.token',
        'err.extra',
      ],
      censor: '[redacted]',
    },
  });
}

export type { Logger };
