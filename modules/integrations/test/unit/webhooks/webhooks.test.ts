import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PUBLIC_EVENT_TYPES, isPublicEventType } from '../../../src/domain/webhooks/events';
import { GIVE_UP_AFTER_MS, retryDelayS, shouldAbandon } from '../../../src/domain/webhooks/retry';
import {
  newWebhookSecret,
  signWebhook,
  webhookHeaders,
} from '../../../src/domain/webhooks/signing';
import { isPublicAddress, webhookUrlProblem } from '../../../src/domain/webhooks/url-safety';

describe('signing (Standard Webhooks)', () => {
  it('signs id.timestamp.body with the decoded secret', () => {
    const secret = newWebhookSecret();
    expect(secret).toMatch(/^whsec_/);
    const key = Buffer.from(secret.slice(6), 'base64');
    expect(key).toHaveLength(32);
    const sig = signWebhook(secret, 'msg_1', 1_700_000_000, '{"a":1}');
    const want = createHmac('sha256', key).update('msg_1.1700000000.{"a":1}').digest('base64');
    expect(sig).toBe(`v1,${want}`);
  });

  it('puts the id, timestamp in seconds and signature in the headers', () => {
    const secret = newWebhookSecret();
    const h = webhookHeaders(secret, 'msg_1', new Date(1_700_000_000_500), '{}');
    expect(h['webhook-id']).toBe('msg_1');
    expect(h['webhook-timestamp']).toBe('1700000000');
    expect(h['webhook-signature']).toBe(signWebhook(secret, 'msg_1', 1_700_000_000, '{}'));
  });
});

describe('retry schedule', () => {
  it('backs off 30 s to 6 h, then every 6 h', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 30].map(retryDelayS)).toEqual([
      30, 120, 600, 1800, 3600, 10_800, 21_600, 21_600, 21_600,
    ]);
  });
  it('gives up 72 hours after the event', () => {
    const at = new Date('2026-10-30T00:00:00Z');
    expect(shouldAbandon(at, new Date(at.getTime() + GIVE_UP_AFTER_MS - 1))).toBe(false);
    expect(shouldAbandon(at, new Date(at.getTime() + GIVE_UP_AFTER_MS))).toBe(true);
  });
});

describe('endpoint safety', () => {
  it.each([
    'http://example.com/hook',
    'https://localhost/hook',
    'https://127.0.0.1/hook',
    'https://10.0.0.5/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/hook',
    'https://[::ffff:7f00:1]/hook',
    'https://[::ffff:a9fe:a9fe]/hook',
    'https://[::ffff:127.0.0.1]/hook',
    'https://[::7f00:1]/hook',
    'https://[64:ff9b::7f00:1]/hook',
    'https://[2002:7f00:1::]/hook',
    'https://example.com./hook',
    'https://user:pass@example.com/hook',
    'ftp://example.com/hook',
    'not a url',
  ])('refuses %s', (url) => {
    expect(webhookUrlProblem(url)).toEqual(expect.any(String));
  });
  it('accepts a public https URL', () => {
    expect(webhookUrlProblem('https://hooks.example.com/archova?x=1')).toBeNull();
  });
  it('classifies addresses', () => {
    for (const a of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.1.1',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fe80::1',
      'fd00::1',
      '::ffff:10.0.0.1',
    ])
      expect(isPublicAddress(a), a).toBe(false);
    for (const a of [
      '8.8.8.8',
      '52.63.1.1',
      '2606:4700::1111',
      '::ffff:8.8.8.8',
      '::ffff:808:808',
      '2a00:1450:4001::1',
    ])
      expect(isPublicAddress(a), a).toBe(true);
  });
});

describe('public event types', () => {
  it('are versioned and never include the test type', () => {
    expect(PUBLIC_EVENT_TYPES.every((t) => /\.v\d+$/.test(t))).toBe(true);
    expect(isPublicEventType('webhook.test.v1')).toBe(false);
    expect(isPublicEventType('identity.session.created.v1')).toBe(false);
  });
});
