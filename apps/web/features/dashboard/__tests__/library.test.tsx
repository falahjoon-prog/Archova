// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TileLibrary } from '../components/TileLibrary';
import { registerTile } from '../lib/registry';

registerTile({
  type: 'test_chart',
  title: 'Cash flow chart',
  description: 'Money in and out by month.',
  category: 'cost',
  surfaces: ['portfolio'],
  size: { w: 6, h: 4 },
  render: () => <span>chart preview</span>,
});
registerTile({
  type: 'test_risk',
  title: 'Risk matrix',
  description: 'Likelihood against impact.',
  category: 'risk',
  surfaces: ['portfolio'],
  size: { w: 4, h: 4 },
  render: () => <span>risk preview</span>,
});

const ctx = { surface: 'portfolio' as const, orgId: 'o', orgSlug: 'o' };

describe('TileLibrary', () => {
  it('lists registered tiles by category, filters by search and adds one', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<TileLibrary surface="portfolio" ctx={ctx} onAdd={onAdd} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Add Cash flow chart' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Risk' }));
    expect(screen.queryByRole('button', { name: 'Add Cash flow chart' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'All categories' }));
    await user.type(screen.getByLabelText('Search tiles'), 'likelihood');
    expect(screen.queryByRole('button', { name: 'Add Cash flow chart' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add Risk matrix' }));
    expect(onAdd.mock.calls[0]![0]).toMatchObject({ type: 'test_risk' });
  });
});
