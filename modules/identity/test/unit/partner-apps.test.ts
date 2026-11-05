import { describe, expect, it } from 'vitest';
import {
  APP_SCOPES,
  TOKEN_OPERATIONS,
  requiredScope,
  unknownAppScopes,
} from '../../src/domain/api-scopes';
import { redirectProblem } from '../../src/application/partner-apps';

describe('partner app scopes (Sam, 2026-11-05)', () => {
  it('never offers money, estimating or webhook management to an app', () => {
    expect(APP_SCOPES.some((s) => /^(financials|estimating|webhooks)/.test(s))).toBe(false);
    expect(unknownAppScopes(['financials:read', 'webhooks:manage', 'rfis:read'])).toEqual([
      'financials:read',
      'webhooks:manage',
    ]);
  });

  it('only names scopes some public operation can use', () => {
    const used = new Set(TOKEN_OPERATIONS.map((o) => requiredScope(o, 'GET')?.split(':')[0]));
    for (const s of APP_SCOPES) expect(used.has(s.split(':')[0]), s).toBe(true);
  });
});

describe('redirect addresses', () => {
  it('accepts only exact absolute https URLs', () => {
    expect(redirectProblem('https://partner.example.com/cb')).toBeNull();
    expect(redirectProblem('https://partner.example.com/cb?x=1')).toBeNull();
    for (const bad of [
      'http://partner.example.com/cb',
      'https://partner.example.com/cb#f',
      'https://u:p@partner.example.com/cb',
      'com.partner:/cb',
      'javascript:alert(1)',
      '/relative',
    ])
      expect(redirectProblem(bad), bad).not.toBeNull();
  });
});
