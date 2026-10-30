import { createHmac, randomBytes } from 'node:crypto';

// Standard Webhooks (https://www.standardwebhooks.com): `webhook-id`, `webhook-timestamp` (seconds) and
// `webhook-signature` = `v1,` + base64(HMAC-SHA256(secret, `${id}.${timestamp}.${body}`)). The secret is
// `whsec_` + base64 of 32 random bytes; the HMAC key is those bytes.
export const SECRET_PREFIX = 'whsec_';

export const newWebhookSecret = () => `${SECRET_PREFIX}${randomBytes(32).toString('base64')}`;

const keyOf = (secret: string) => Buffer.from(secret.slice(SECRET_PREFIX.length), 'base64');

export function signWebhook(secret: string, id: string, timestampS: number, body: string): string {
  const mac = createHmac('sha256', keyOf(secret))
    .update(`${id}.${timestampS}.${body}`)
    .digest('base64');
  return `v1,${mac}`;
}

export function webhookHeaders(secret: string, id: string, now: Date, body: string) {
  const ts = Math.floor(now.getTime() / 1000);
  return {
    'content-type': 'application/json',
    'user-agent': 'Archova-Webhooks/1',
    'webhook-id': id,
    'webhook-timestamp': String(ts),
    'webhook-signature': signWebhook(secret, id, ts, body),
  };
}
