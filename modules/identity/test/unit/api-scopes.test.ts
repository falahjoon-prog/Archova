import { describe, expect, it } from 'vitest';
import {
  requiredScope,
  scopeAllows,
  TOKEN_SCOPES,
  unknownScopes,
} from '../../src/domain/api-scopes';

describe('api scopes', () => {
  it('maps modules to read and write scopes, and hides the rest', () => {
    expect(requiredScope('rfis', 'GET')).toBe('rfis:read');
    expect(requiredScope('platform', 'POST')).toBe('projects:write');
    expect(requiredScope('files', 'PUT')).toBe('documents:write');
    for (const m of [
      'identity',
      'billing',
      'ai',
      'access',
      'sync',
      'workforce',
      'integrations',
      null,
    ])
      expect(requiredScope(m, 'GET')).toBeNull();
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
