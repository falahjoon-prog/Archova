// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nav, renderInProject, enterText } from '@/test/render';
import { defectsSource, resetDefectsPreview } from '../data/source';
import { DefectDetailScreen } from '../screens/DefectDetailScreen';
import { DefectListScreen } from '../screens/DefectListScreen';
import { DefectNewScreen } from '../screens/DefectNewScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T23:00:00Z'));
});
afterAll(() => vi.useRealTimers());

beforeEach(() => {
  resetDefectsPreview();
  nav.search = '';
  nav.pushed = [];
});

describe('DefectListScreen', () => {
  it('lists defects with company, stage and overdue state', async () => {
    renderInProject(<DefectListScreen />);
    const row = (await screen.findByRole('link', { name: 'DEF-0003' })).closest('tr')!;
    expect(within(row).getByText('Brightwire Electrical')).toBeTruthy();
    expect(within(row).getByText(/Overdue/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '1 defect is ready for inspection' })).toBeTruthy();
  });

  it('bulk assigns selected defects to a company', async () => {
    const user = userEvent.setup();
    renderInProject(<DefectListScreen />);
    await user.click(await screen.findByLabelText('Select DEF-0002'));
    await user.click(screen.getByLabelText('Select DEF-0003'));
    const bar = screen.getByRole('region', { name: 'Bulk actions' });
    await user.selectOptions(within(bar).getByLabelText('Assign to'), 'cmp_dry');
    await user.click(within(bar).getByRole('button', { name: 'Apply to 2' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull());
    const [d2, d3] = await Promise.all([
      defectsSource.get('prj_test', 'dft_0002'),
      defectsSource.get('prj_test', 'dft_0003'),
    ]);
    expect([d2.assigneeCompanyId, d3.assigneeCompanyId]).toEqual(['cmp_dry', 'cmp_dry']);
  });
});

describe('DefectNewScreen', () => {
  it('applies Nova’s trade and company only when accepted, then saves', async () => {
    const user = userEvent.setup();
    renderInProject(<DefectNewScreen />);
    await enterText(
      user,
      screen.getByLabelText("What's wrong"),
      'Scuffed paint on the corridor wall',
    );
    await user.click(screen.getByRole('button', { name: 'Suggest title and trade' }));
    const suggestion = await screen.findByRole('region', { name: 'Drafted by Nova' });
    expect((screen.getByLabelText(/Responsible company/) as HTMLSelectElement).value).toBe('');
    await user.click(within(suggestion).getByRole('button', { name: 'Use these' }));
    expect((screen.getByLabelText(/Responsible company/) as HTMLSelectElement).value).toBe(
      'cmp_paint',
    );
    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe(
      'Scuffed paint on the corridor wall',
    );

    await user.click(screen.getByRole('button', { name: 'Save defect' }));
    expect(screen.getByText('Choose a location or a drawing.')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText(/Location/), 'loc_level_1_corridor');
    await user.click(screen.getByRole('button', { name: 'Save defect' }));
    await waitFor(() => expect(nav.pushed).toHaveLength(1));
    const created = (await defectsSource.list('prj_test', { q: 'Scuffed paint' }))[0]!;
    expect(created).toMatchObject({
      number: 7,
      source: 'ai_suggested',
      assigneeCompanyId: 'cmp_paint',
    });
  });
});

describe('DefectDetailScreen', () => {
  it('closes a defect that is ready for inspection', async () => {
    const user = userEvent.setup();
    renderInProject(<DefectDetailScreen defectId="dft_0001" />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Paint touch-up, retail 1 east wall' }),
    ).toBeTruthy();
    expect(screen.getByText('Assigned to: Coastline Painting')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close defect' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Close defect' }));
    await waitFor(() => expect(screen.getAllByText('Closed').length).toBeGreaterThan(0));
  });

  it('asks for an after photo before marking ready (DEF-AC5)', async () => {
    const user = userEvent.setup();
    renderInProject(<DefectDetailScreen defectId="dft_0002" />);
    await user.click(await screen.findByRole('button', { name: 'Mark ready for inspection' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Mark ready' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('after');
    await user.upload(
      within(dialog).getByLabelText('After photos'),
      new File(['x'], 'lobby-after.jpg', { type: 'image/jpeg' }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Mark ready' }));
    await waitFor(() =>
      expect(screen.getAllByText('Ready for inspection').length).toBeGreaterThan(0),
    );
    expect(screen.getByText('lobby-after.jpg')).toBeTruthy();
  });
});
