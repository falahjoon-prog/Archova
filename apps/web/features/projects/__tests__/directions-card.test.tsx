// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EffectivePermissions } from '@archova/domain/permissions';
import type { ProjectLocation } from '../data/locations';

const list = vi.fn();
vi.mock('../data/locations', () => ({
  createLocationsApi: () => ({ list: (...a: unknown[]) => list(...a) }),
}));
vi.mock('@/shared/providers/CurrentOrgProvider', () => ({
  useCurrentOrg: () => ({ orgId: 'org_1', orgSlug: 'harbour-line' }),
}));

import { DirectionsCard } from '../components/DirectionsCard';

const loc = (over: Partial<ProjectLocation>): ProjectLocation => ({
  id: 'plc_1',
  name: 'Site office',
  kind: 'site_office',
  address: '1 Smith St, Sydney NSW',
  point: null,
  directionsUrl: 'https://www.google.com/maps/dir/?api=1&destination=1%20Smith%20St',
  accessNote: 'Sign in at reception.',
  contactName: null,
  contactPhone: null,
  usedFor: ['visitors'],
  isDefault: true,
  version: 1,
  ...over,
});

const renderCard = (permissions?: EffectivePermissions) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DirectionsCard projectId="prj_1" permissions={permissions} />
    </QueryClientProvider>,
  );

describe('DirectionsCard', () => {
  it('shows a Get Directions link and the access note for each location', async () => {
    list.mockResolvedValue([
      loc({}),
      loc({
        id: 'plc_2',
        name: 'Gate 2',
        kind: 'gate',
        usedFor: ['deliveries'],
        isDefault: false,
        accessNote: 'Code 4821#',
      }),
    ]);
    renderCard();
    expect(await screen.findByText('Code 4821#')).toBeTruthy();
    const links = screen.getAllByRole('link', { name: /Get Directions/ });
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute('target')).toBe('_blank');
    expect(links[0]?.getAttribute('rel')).toContain('noopener');
  });

  it('explains the empty state and offers no add button without permission', async () => {
    list.mockResolvedValue([]);
    renderCard();
    expect(await screen.findByText(/No locations yet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add location/ })).toBeNull();
  });

  it('has Nova suggest the delivery gate for a concrete truck', async () => {
    list.mockResolvedValue([
      loc({}),
      loc({ id: 'plc_2', name: 'Gate 2', kind: 'gate', usedFor: ['deliveries'], isDefault: false }),
    ]);
    renderCard();
    await screen.findByText('Who is arriving?');
    fireEvent.change(screen.getByLabelText('Trade or role'), {
      target: { value: 'Concrete pump driver' },
    });
    expect(await screen.findByText('Nova suggests Gate 2.')).toBeTruthy();
  });
});
