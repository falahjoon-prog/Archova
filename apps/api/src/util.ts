import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

export function safeEqualStrings(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * The caller's address for rate limits and audit (X-Forwarded-For is never trusted wholesale).
 *
 * `hops` is how many proxies of ours sit in front of the API and each append the address they saw (CloudFront then the
 * ALB: 2). The client is the `hops`-th entry from the right, which a caller cannot choose: anything it adds to
 * X-Forwarded-For lands to the left. With 0 hops, or a header that is shorter than that or not an address, it is the
 * socket peer. Unlike `trustProxy`, this does not touch how the host is read.
 */
export function clientIp(req: Pick<FastifyRequest, 'headers' | 'socket'>, hops: number): string {
  const peer = req.socket.remoteAddress ?? '';
  if (hops <= 0) return peer;
  const header = req.headers['x-forwarded-for'];
  const chain = (Array.isArray(header) ? header.join(',') : (header ?? ''))
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const picked = chain[chain.length - hops];
  return picked && isIP(picked) ? picked : peer;
}
