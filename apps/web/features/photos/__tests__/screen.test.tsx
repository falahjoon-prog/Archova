// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nav, renderInProject } from '@/test/render';
import * as api from '../data/api';
import { PhotosScreen } from '../screens/PhotosScreen';
import type { SitePhoto } from '../lib/types';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);
vi.mock('../data/api');

const photo = (over: Partial<SitePhoto> = {}): SitePhoto => ({
  file: {
    id: 'fil_1',
    projectId: 'prj_test',
    module: 'photos',
    filename: 'slab-edge.jpg',
    mime: 'image/jpeg',
    sizeBytes: 10,
    sha256: 'x',
    status: 'ready',
    capture: null,
    createdAt: '2026-11-05T01:00:00Z',
  },
  url: 'https://files.test/1.jpg',
  expiresAt: '2026-11-07T02:00:00Z',
  category: 'unclassified',
  filing: null,
  needsReview: true,
  suggestion: null,
  ...over,
});

const albums = {
  auto: [
    { category: 'safety_risk', count: 0, needsReview: 0, cover: null },
    { category: 'punch_list', count: 3, needsReview: 0, cover: null },
    { category: 'unclassified', count: 2, needsReview: 2, cover: null },
  ],
  own: [{ id: 'alb_1', name: 'Level 3 fitout', count: 4, createdAt: '2026-11-01T00:00:00Z' }],
} as Awaited<ReturnType<typeof api.fetchAlbums>>;

beforeEach(() => {
  nav.search = '';
  vi.mocked(api.fetchAlbums).mockResolvedValue(albums);
  vi.mocked(api.browsePhotos).mockResolvedValue({ data: [photo()], next: null });
});
afterEach(cleanup);

describe('PhotosScreen', () => {
  it('shows auto albums, project albums and the Nova unfiled flag', async () => {
    renderInProject(<PhotosScreen />);
    const list = await screen.findByRole('list', { name: 'Albums' });
    expect(within(list).getByRole('button', { name: /Punch list, 3 photos/ })).toBeTruthy();
    expect(within(list).getByRole('button', { name: /Level 3 fitout, 4 photos/ })).toBeTruthy();
    expect(screen.getByText(/2 photos have been unfiled for over a day/)).toBeTruthy();
  });

  it('opens an unfiled photo and files it from Nova’s suggestion', async () => {
    nav.search = 'view=feed';
    vi.mocked(api.browsePhotos).mockResolvedValue({
      data: [
        photo({
          suggestion: {
            category: 'punch_list',
            refKind: 'defect',
            refId: 'dfx_1',
            basedOnFileId: 'fil_2',
            reason: 'same_place',
          },
        }),
      ],
      next: null,
    });
    vi.mocked(api.filePhoto).mockResolvedValue({
      fileId: 'fil_1',
      category: 'punch_list',
      refKind: 'defect',
      refId: 'dfx_1',
      source: 'nova',
    });
    const user = userEvent.setup();
    renderInProject(<PhotosScreen />);
    await user.click(await screen.findByRole('button', { name: /Open slab-edge.jpg/ }));
    expect(screen.getByText(/Nova suggests Punch list, on a punch item/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'File it there' }));
    expect(api.filePhoto).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'fil_1',
      expect.objectContaining({ category: 'punch_list', refId: 'dfx_1', fromSuggestion: true }),
    );
  });

  it('shows an empty state when an album has no photos', async () => {
    nav.search = 'view=feed&album=safety_risk';
    vi.mocked(api.browsePhotos).mockResolvedValue({ data: [], next: null });
    renderInProject(<PhotosScreen />);
    expect(await screen.findByText(/No photos in Safety risk yet/)).toBeTruthy();
  });
});
