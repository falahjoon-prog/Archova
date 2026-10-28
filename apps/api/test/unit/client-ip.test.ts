import { describe, expect, it } from 'vitest';
import { clientIp } from '../../src/util';

const req = (xff: string | string[] | undefined, peer = '10.0.0.9') =>
  ({ headers: { 'x-forwarded-for': xff }, socket: { remoteAddress: peer } }) as never;

describe('clientIp', () => {
  it('is the socket peer with no trusted hops, whatever the header says', () => {
    expect(clientIp(req('1.2.3.4'), 0)).toBe('10.0.0.9');
  });

  it('takes the Nth entry from the right, so a forged leftmost entry changes nothing', () => {
    // CloudFront saw the client, the ALB saw CloudFront: "client, cloudfront".
    expect(clientIp(req('203.0.113.7, 130.176.0.1'), 2)).toBe('203.0.113.7');
    expect(clientIp(req('6.6.6.6, 203.0.113.7, 130.176.0.1'), 2)).toBe('203.0.113.7');
    expect(clientIp(req(['6.6.6.6', '203.0.113.7, 130.176.0.1']), 2)).toBe('203.0.113.7');
  });

  it('falls back to the peer when the chain is short, missing or not an address', () => {
    expect(clientIp(req('130.176.0.1'), 2)).toBe('10.0.0.9');
    expect(clientIp(req(undefined), 2)).toBe('10.0.0.9');
    expect(clientIp(req('not-an-ip, 130.176.0.1'), 2)).toBe('10.0.0.9');
  });
});
