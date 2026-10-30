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
    const x = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (x === '::' || x === '::1') return false;
    const first = parseInt(x.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return false; // unique local
    if ((first & 0xffc0) === 0xfe80) return false; // link-local
    if ((first & 0xff00) === 0xff00) return false; // multicast
    if (x.startsWith('2001:db8')) return false; // documentation
    if (x.startsWith('64:ff9b')) return false; // NAT64 can reach IPv4 private space
    return true;
  }
  return false;
}
