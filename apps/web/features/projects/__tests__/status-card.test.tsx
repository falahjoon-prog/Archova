// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mutate = vi.fn();
vi.mock('../hooks/useProjectMutations', () => ({
  useUpdateProject: () => ({ mutate, reset: vi.fn(), isPending: false, error: null }),
}));

import { ProjectStatusCard } from '../components/ProjectStatusCard';

const tile = {
  title: 'Project Status',
  doc: {
    blocks: [
      {
        type: 'paragraph' as const,
        lines: [[{ text: 'Scope: ', bold: true }, { text: 'High-rise tower' }]],
      },
    ],
  },
};

const renderCard = (props: Partial<Parameters<typeof ProjectStatusCard>[0]> = {}) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProjectStatusCard
        orgId="org_1"
        projectId="prj_1"
        version={4}
        tile={tile}
        canEdit
        {...props}
      />
    </QueryClientProvider>,
  );

beforeEach(() => mutate.mockReset());

describe('ProjectStatusCard', () => {
  it('shows the custom title and the written text', () => {
    renderCard();
    expect(screen.getByRole('heading', { name: 'Project Status' })).toBeTruthy();
    expect(screen.getByText('High-rise tower')).toBeTruthy();
  });

  it('falls back to the default title and an empty-state hint', () => {
    renderCard({ tile: null });
    expect(screen.getByRole('heading', { name: 'Project description' })).toBeTruthy();
    expect(screen.getByText(/Use Edit to write/)).toBeTruthy();
  });

  it('hides Edit from people who cannot change the project', () => {
    renderCard({ canEdit: false });
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('saves the title and text with the version it was read at', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(
      (screen.getByRole('switch', { name: 'Custom title?' }) as HTMLElement).getAttribute(
        'aria-checked',
      ),
    ).toBe('true');
    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'Where we are');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(mutate).toHaveBeenCalledTimes(1);
    const arg = mutate.mock.calls[0]?.[0];
    expect(arg.version).toBe(4);
    expect(arg.body.statusTile.title).toBe('Where we are');
    expect(arg.body.statusTile.doc.blocks).toEqual(tile.doc.blocks);
  });
});
