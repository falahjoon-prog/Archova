import { describe, expect, it } from 'vitest';
import { operations } from '@archova/contracts';
import {
  requiredScope,
  scopeAllows,
  TOKEN_OPERATIONS,
  TOKEN_SCOPES,
  unknownScopes,
} from '../../src/domain/api-scopes';

describe('api scopes', () => {
  it('maps allowed operations to read and write scopes', () => {
    expect(requiredScope('listRfis', 'GET')).toBe('rfis:read');
    expect(requiredScope('createRfi', 'POST')).toBe('rfis:write');
    expect(requiredScope('getFile', 'GET')).toBe('documents:read');
    expect(requiredScope('completeUpload', 'POST')).toBe('documents:write');
  });

  it('refuses everything not on the allowlist, including platform admin operations', () => {
    for (const id of [
      'addProjectMember',
      'removeProjectMember',
      'createSupportAccessGrant',
      'revokeSupportAccessGrant',
      'getSupportAccess',
      'createOrg',
      'getMe',
      'createApiToken',
      'listApiTokens',
      'revokeApiToken',
      'nonsense',
    ])
      expect(requiredScope(id, 'POST')).toBeNull();
  });

  it('only lists operations that exist, are not internal, and belong to a public module', () => {
    const ops = operations as Record<string, { internal: boolean; module: string | null }>;
    for (const id of TOKEN_OPERATIONS) {
      expect(ops[id], id).toBeDefined();
      expect(ops[id]!.internal, id).toBe(false);
      expect([
        'ai',
        'billing',
        'identity',
        'access',
        'sync',
        'workforce',
        'integrations',
      ]).not.toContain(ops[id]!.module);
    }
  });

  it('lets write include read but never the other way round', () => {
    expect(scopeAllows(['rfis:write'], 'rfis:read')).toBe(true);
    expect(scopeAllows(['rfis:read'], 'rfis:write')).toBe(false);
    expect(scopeAllows(['rfis:write'], 'defects:read')).toBe(false);
  });

  it('never offers financials:write to a personal token', () => {
    expect(TOKEN_SCOPES).toContain('financials:read');
    expect(TOKEN_SCOPES).not.toContain('financials:write');
    expect(unknownScopes(['rfis:read', 'financials:write', 'x'])).toEqual([
      'financials:write',
      'x',
    ]);
  });
});
