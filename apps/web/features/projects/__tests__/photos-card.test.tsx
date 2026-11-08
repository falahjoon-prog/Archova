// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const renderCard = (extra: Partial<Parameters<typeof PhotosCard>[0]> = {}) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PhotosCard projectId="prj_1" timeZone="Australia/Sydney" {...extra} />
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

  it('lets an editor pick a photo as the project photo, and others not', async () => {
    fetchProjectPhotos.mockResolvedValue([photo('fil_a', 'diary')]);
    const onUseAsHero = vi.fn();
    const user = userEvent.setup();
    renderCard({ onUseAsHero });
    await user.click(await screen.findByRole('button', { name: 'Open fil_a.jpg, Site diary' }));
    await user.click(screen.getByRole('button', { name: 'Use as project photo' }));
    expect(onUseAsHero).toHaveBeenCalledWith('fil_a');
  });

  it('offers no project-photo button without edit rights', async () => {
    fetchProjectPhotos.mockResolvedValue([photo('fil_a', 'diary')]);
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole('button', { name: 'Open fil_a.jpg, Site diary' }));
    expect(screen.queryByRole('button', { name: 'Use as project photo' })).toBeNull();
  });
});
