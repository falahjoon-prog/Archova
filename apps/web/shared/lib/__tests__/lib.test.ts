import { describe, expect, it } from 'vitest';
import { ApiError } from '@archova/api-client';
import { NETWORK_ERROR_MESSAGE, toErrorView } from '../errors';
import { parseForm, withoutEmpty } from '../forms';
import { needsFullNavigation, safeNextPath } from '../safe-next';

describe('safeNextPath', () => {
  it('keeps same-origin paths with their query', () => {
    expect(safeNextPath('/acme/projects?tab=open', '/orgs')).toBe('/acme/projects?tab=open');
    expect(safeNextPath('/v1/oauth/authorize?client_id=x', '/orgs')).toBe(
      '/v1/oauth/authorize?client_id=x',
    );
  });

  it.each([
    undefined,
    '',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    '/a\nb',
  ])('falls back for %j', (next) => {
    expect(safeNextPath(next, '/orgs')).toBe('/orgs');
  });

  it('sends API paths through a full page load', () => {
    expect(needsFullNavigation('/v1/oauth/authorize')).toBe(true);
    expect(needsFullNavigation('/acme/projects')).toBe(false);
  });
});

describe('toErrorView', () => {
  it('shows the RFC 9457 detail, field errors and trace id', () => {
    const error = new ApiError(422, {
      type: 'about:blank',
      title: 'Validation failed',
      status: 422,
      code: 'validation_failed',
      detail: 'Check the highlighted fields.',
      traceId: 'trace-123',
      errors: [{ path: '/body/email', message: 'Enter a valid email address.' }],
    });
    expect(toErrorView(error)).toEqual({
      message: 'Check the highlighted fields.',
      fieldErrors: { email: 'Enter a valid email address.' },
      traceId: 'trace-123',
      status: 422,
      code: 'validation_failed',
    });
  });

  it('falls back to the title, and explains network failures', () => {
    expect(
      toErrorView(
        new ApiError(409, { type: 'x', title: 'Conflict', status: 409, code: 'conflict' }),
      ).message,
    ).toBe('Conflict');
    expect(toErrorView(new TypeError('Failed to fetch')).message).toBe(NETWORK_ERROR_MESSAGE);
  });
});

describe('parseForm', () => {
  const schema = {
    safeParse: (v: unknown) =>
      (v as { name?: string }).name
        ? ({ success: true, data: v as { name: string } } as const)
        : ({
            success: false,
            error: { issues: [{ path: ['name'], message: 'Required' }] },
          } as const),
  };

  it('returns friendly per-field messages', () => {
    expect(parseForm(schema, {}, { name: 'Enter a name.' })).toEqual({
      ok: false,
      fieldErrors: { name: 'Enter a name.' },
    });
    expect(parseForm(schema, { name: 'Tower A' })).toEqual({ ok: true, data: { name: 'Tower A' } });
  });

  it('drops empty optional values', () => {
    expect(withoutEmpty({ name: 'Tower A', number: '', state: undefined })).toEqual({
      name: 'Tower A',
    });
  });
});
