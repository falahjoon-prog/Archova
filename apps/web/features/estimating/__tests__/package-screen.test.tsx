// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nav, renderInProject, enterText } from '@/test/render';
import { resetQuotesPreview } from '../data/quotes-source';
import { PackageScreen } from '../screens/PackageScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T23:00:00Z'));
});
afterAll(() => vi.useRealTimers());

beforeEach(() => {
  resetQuotesPreview();
  nav.search = '';
  nav.pushed = [];
});

describe('PackageScreen', () => {
  it('shows the levelled table with flags, and the pending quote outside it', async () => {
    renderInProject(<PackageScreen packageId="pkg_1" />);
    const table = await screen.findByRole('table', { name: /Quote comparison/ });
    expect(within(table).getByText('Ironbark Tiling')).toBeTruthy();
    expect(within(table).queryByText('Granite & Grout')).toBeNull();
    expect(within(table).getByText('Excluded')).toBeTruthy();
    expect(within(table).getByText('Validity expired')).toBeTruthy();
    expect(within(table).getByText('$29,360.00')).toBeTruthy();
    expect(screen.getByRole('button', { name: '1 quote is waiting for review' })).toBeTruthy();
  });

  it('opens the source of a value in the quote (EST-AC5)', async () => {
    const user = userEvent.setup();
    renderInProject(<PackageScreen packageId="pkg_1" />);
    const table = await screen.findByRole('table', { name: /Quote comparison/ });
    await user.click(within(table).getAllByRole('button', { name: 'Source p.2' })[0]!);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/page 2/)).toBeTruthy();
  });

  it('normalises with an allowance and needs a reason to pick the dearer quote', async () => {
    const user = userEvent.setup();
    nav.search = 'normalise=1';
    renderInProject(<PackageScreen packageId="pkg_1" />);
    const allowance = await screen.findByLabelText(/Allowance for Harbour Tile Co: Waterproofing/);
    await user.type(allowance, '3000');
    await user.tab();
    expect(await screen.findByText('$34,950.00')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Select Harbour Tile Co' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText("This isn't the lowest like-for-like quote")).toBeTruthy();
    const confirm = within(dialog).getByRole('button', {
      name: 'Select preferred quote',
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await enterText(user, within(dialog).getByLabelText('Reason'), 'Earlier start on site');
    await user.click(confirm);
    expect(await screen.findByText('Selected Harbour Tile Co')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Select Ironbark Tiling' })).toBeNull();
  });

  it('reviews and confirms a quote Nova read, with corrections kept', async () => {
    const user = userEvent.setup();
    nav.search = 'tab=quotes';
    renderInProject(<PackageScreen packageId="pkg_1" />);
    const amount = await screen.findByLabelText('Amount for Amenities floors');
    await user.clear(amount);
    await user.type(amount, '4000');
    await user.tab();
    expect(await screen.findByText(/Corrected. Nova read \$3,950.00/)).toBeTruthy();
    expect(screen.getByText(/Not priced:/).closest('p')!.textContent).toContain('Tiled skirting');
    await user.click(screen.getByRole('button', { name: 'Confirm quote' }));
    await waitFor(() => expect(screen.getAllByText('Confirmed').length).toBe(3));
  });

  it('declines a quote that is ready to review, taking it out of the queue', async () => {
    const user = userEvent.setup();
    nav.search = 'tab=quotes';
    renderInProject(<PackageScreen packageId="pkg_1" />);
    await user.click(await screen.findByRole('button', { name: 'Decline quote' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm quote' })).toBeNull());
    expect(screen.getAllByText('Declined').length).toBeGreaterThan(0);
  });

  it('holds a draft back from tender until it has scope and an invite', async () => {
    renderInProject(<PackageScreen packageId="pkg_2" />);
    const send = (await screen.findByRole('button', {
      name: 'Send out to tender',
    })) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(screen.getByText(/Add scope lines and invite at least one subcontractor/)).toBeTruthy();
  });

  it('closes and reopens a tender that is out', async () => {
    const user = userEvent.setup();
    renderInProject(<PackageScreen packageId="pkg_1" />);
    await user.click(await screen.findByRole('button', { name: 'Close tender' }));
    await user.click(await screen.findByRole('button', { name: 'Reopen tender' }));
    expect(await screen.findByRole('button', { name: 'Close tender' })).toBeTruthy();
  });
});
