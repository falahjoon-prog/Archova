// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectPhoto } from '../data/photos';

const fetchProjectPhotos = vi.fn();
vi.mock('../data/photos', () => ({
  fetchProjectPhotos: (...a: unknown[]) => fetchProjectPhotos(...a),
}));
vi.mock('@/shared/providers/CurrentOrgProvider', () => ({
  useCurrentOrg: () => ({ orgId: 'org_1', orgSlug: 'harbour-line' }),
}));

import { PhotosCard } from '../components/PhotosCard';

const photo = (id: string, module: string): ProjectPhoto =>
  ({
    file: { id, module, filename: `${id}.jpg`, createdAt: '2026-11-05T01:00:00Z', capture: null },
    url: `https://files.test/${id}`,
    expiresAt: '2026-11-05T01:05:00Z',
  }) as ProjectPhoto;

const renderCard = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PhotosCard projectId="prj_1" timeZone="Australia/Sydney" />
    </QueryClientProvider>,
  );

describe('PhotosCard', () => {
  it('shows at most six photos, each labelled with where it came from', async () => {
    fetchProjectPhotos.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => photo(`fil_${i}`, i === 0 ? 'diary' : 'defects')),
    );
    renderCard();
    expect(await screen.findAllByRole('button')).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Open fil_0.jpg, Site diary' })).toBeTruthy();
  });

  it('explains the empty state', async () => {
    fetchProjectPhotos.mockResolvedValue([]);
    renderCard();
    expect(await screen.findByText(/No photos yet/)).toBeTruthy();
  });
});
