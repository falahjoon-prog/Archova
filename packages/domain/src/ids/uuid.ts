// UUIDv7 (RFC 9562): 48-bit unix ms timestamp, version, 74 random bits.
// Pure TS: relies only on the Web Crypto global available in Node 22, browsers and Hermes (with polyfill).

declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T };

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

let lastMs = -1;
let counter = 0;

/**
 * Monotonic within a process (RFC 9562 §6.2 method 1): ids minted in the same millisecond use a 12-bit
 * counter in `rand_a`, so rows created in one transaction keep their creation order.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let ms = now;
  if (ms <= lastMs) {
    ms = lastMs;
    counter++;
    if (counter > 0xfff) {
      ms = ++lastMs;
      counter = bytes[7]! & 0x7f;
    }
  } else {
    counter = ((bytes[6]! & 0x07) << 8) | bytes[7]!; // random start, leaving headroom
  }
  lastMs = ms;
  const ts = BigInt(ms);
  for (let i = 0; i < 6; i++) {
    bytes[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
  }
  bytes[6] = 0x70 | ((counter >> 8) & 0x0f);
  bytes[7] = counter & 0xff;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

export function bytesToUuid(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out += '-';
    out += HEX[bytes[i]!];
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
