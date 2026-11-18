// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BookmarksCard } from '../components/BookmarksCard';

const useBookmarks = vi.fn();
vi.mock('../hooks/useBookmarks', () => ({
  useBookmarks: (...a: unknown[]) => useBookmarks(...a),
  useRemoveBookmark: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/shared/providers/CurrentOrgProvider', () => ({
  useCurrentOrg: () => ({ orgSlug: 'harbour-line', orgId: 'org_1' }),
}));

describe('BookmarksCard', () => {
  beforeEach(() => useBookmarks.mockReset());

  it('shows an empty state when the project has no bookmarks', () => {
    useBookmarks.mockReturnValue({ isPending: false, isError: false, data: [] });
    render(<BookmarksCard projectId="prj_1" />);
    expect(screen.getByText('No bookmarks yet')).toBeTruthy();
    expect(useBookmarks).toHaveBeenCalledWith('prj_1');
  });

  it('links each bookmark to its record and caps the list', () => {
    const data = Array.from({ length: 8 }, (_, i) => ({
      id: `bkm_${i}`,
      entityType: 'rfi',
      entityId: `rfi_${i}`,
      projectId: 'prj_1',
      title: `RFI ${i}`,
      subtitle: null,
      createdAt: '2026-11-06T00:00:00Z',
    }));
    useBookmarks.mockReturnValue({ isPending: false, isError: false, data });
    render(<BookmarksCard projectId="prj_1" />);
    expect(screen.getByRole('link', { name: 'RFI 0' }).getAttribute('href')).toContain(
      'harbour-line',
    );
    expect(screen.queryByText('RFI 7')).toBeNull();
    expect(screen.getByText('and 2 more on this project')).toBeTruthy();
  });
});
