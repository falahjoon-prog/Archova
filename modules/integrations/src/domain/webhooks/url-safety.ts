import { isIP } from 'node:net';

// Webhook endpoints must be public HTTPS hosts (integrations/06 §5, SSRF rules). The URL is checked when a
// subscription is made; the address each connection actually uses is checked again at connect time (see
// `infra/webhook-transport.ts`), so a hostname that later resolves to a private address, or flips between lookups
// (DNS rebinding), still cannot reach the inside of our network.

export type UrlProblem = string | null;

export function webhookUrlProblem(raw: string): UrlProblem {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'Not a valid URL.';
  }
  if (u.hostname.endsWith('.')) return 'Use a host name without a trailing dot.';
  if (u.protocol !== 'https:') return 'Webhook URLs must use https.';
  if (u.username || u.password) return 'Webhook URLs cannot contain credentials.';
  if (u.port && u.port !== '443') return 'Webhook URLs must use the default https port.';
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host.includes('.') && isIP(host) === 0) return 'Use a public host name.';
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  )
    return 'Use a public host name.';
  if (isIP(host) !== 0 && !isPublicAddress(host)) return 'That address is not public.';
  return null;
}

/** Eight 16-bit groups of an IPv6 literal, or null when it is not a plain one (zone ids are refused). */
function ipv6Words(ip: string): number[] | null {
  if (ip.includes('%')) return null;
  let x = ip.toLowerCase();
  const dotted = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(x);
  if (dotted) {
    const o = [dotted[2], dotted[3], dotted[4], dotted[5]].map(Number);
    if (o.some((n) => n > 255)) return null;
    x = `${dotted[1]}${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`;
  }
  const halves = x.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array<string>(Math.max(fill, 0)).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  const words = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return words.some(Number.isNaN) ? null : words;
}

const v4 = (ip: string) => ip.split('.').map(Number) as [number, number, number, number];

/** True only for globally routable unicast addresses. Anything unparseable is refused. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const [a, b, c] = v4(ip);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a === 169 && b === 254) return false; // link-local, cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 0 && c === 0) return false;
    if (a === 192 && b === 0 && c === 2) return false;
    if (a === 192 && b === 168) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    if (a >= 224) return false; // multicast, reserved, broadcast
    return true;
  }
  if (family === 6) {
    const w = ipv6Words(ip);
    if (!w) return false;
    // ::ffff:0:0/96 (mapped) and ::/96 (compatible) carry an IPv4 address in the last 32 bits: judge that address.
    // The URL parser writes ::ffff:127.0.0.1 as ::ffff:7f00:1, so the dotted form is not the only one to catch.
    const embedded = `${w[6]! >> 8}.${w[6]! & 255}.${w[7]! >> 8}.${w[7]! & 255}`;
    if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0))
      return isPublicAddress(embedded);
    // Only global unicast, 2000::/3, and not the ranges inside it that tunnel to or from other address space.
    if ((w[0]! & 0xe000) !== 0x2000) return false;
    if (w[0] === 0x2002) return false; // 6to4
    if (w[0] === 0x2001 && (w[1] === 0 || w[1] === 0xdb8)) return false; // Teredo, documentation
    if (w[0] === 0x3fff) return false; // documentation
    return true;
  }
  return false;
}
