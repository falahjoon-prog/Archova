// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

import { ExternalSignInButtons } from '../components/ExternalSignInButtons';
import { externalErrorMessage, externalErrorProvider } from '../lib/external-errors';

const renderButton = (next?: string) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ExternalSignInButtons {...(next ? { next } : {})} />
    </QueryClientProvider>,
  );

beforeEach(() => fake.reset());

describe('Continue with Google / Microsoft', () => {
  it('links to the API start route, carrying the page to return to', async () => {
    fake.on('GET', '/v1/auth/providers', () => ({ google: true, microsoft: false }));
    renderButton('/orgs/acme');
    const link = await screen.findByRole('link', { name: /continue with google/i });
    expect(link.getAttribute('href')).toBe('/v1/auth/google/start?next=%2Forgs%2Facme');
  });

  it('shows nothing when Google is not switched on', async () => {
    fake.on('GET', '/v1/auth/providers', () => ({ google: false, microsoft: false }));
    renderButton();
    await vi.waitFor(() => expect(fake.callsTo('GET', '/v1/auth/providers')).toHaveLength(1));
    expect(screen.queryByRole('link', { name: /google/i })).toBeNull();
  });

  it('shows Microsoft on its own, linking to its start route', async () => {
    fake.on('GET', '/v1/auth/providers', () => ({ google: false, microsoft: true }));
    renderButton();
    const link = await screen.findByRole('link', { name: /continue with microsoft/i });
    expect(link.getAttribute('href')).toBe('/v1/auth/microsoft/start');
    expect(screen.queryByRole('link', { name: /google/i })).toBeNull();
  });

  it('turns only our own error codes into sentences', () => {
    expect(externalErrorMessage('google_cancelled')).toMatch(/cancelled/i);
    expect(externalErrorMessage('microsoft_failed')).toMatch(/Microsoft/);
    expect(externalErrorProvider('microsoft_failed')).toBe('Microsoft');
    expect(externalErrorMessage('<script>')).toBeUndefined();
    expect(externalErrorMessage(undefined)).toBeUndefined();
  });
});
