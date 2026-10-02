// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nav, renderInProject } from '@/test/render';
import { resetRfisPreview } from '../data/source';
import { RfiDetailScreen } from '../screens/RfiDetailScreen';
import { RfiListScreen } from '../screens/RfiListScreen';
import { RfiNewScreen } from '../screens/RfiNewScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

beforeAll(() => {
  // Thursday 2 Oct 2026, 10:00 in Sydney.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T23:00:00Z'));
});
afterAll(() => vi.useRealTimers());

beforeEach(() => {
  resetRfisPreview();
  nav.search = '';
  nav.pushed = [];
});

describe('RfiListScreen', () => {
  it('shows ball in court and the overdue chip on every row (RFI-AC4)', async () => {
    renderInProject(<RfiListScreen />);
    const link = await screen.findByRole('link', { name: 'RFI-003' });
    expect(link.getAttribute('href')).toBe('/acme/projects/prj_test/rfis/rfi_003');
    const row = link.closest('tr')!;
    expect(within(row).getByText('Waiting on: Fold Architects · Mei Lin')).toBeTruthy();
    expect(within(row).getByText(/Overdue 3 business days/)).toBeTruthy();
    const rfi4 = screen.getByRole('link', { name: 'RFI-004' }).closest('tr')!;
    expect(within(rfi4).getByText('(5 business days)')).toBeTruthy();
  });

  it('keeps filters in the URL', async () => {
    const user = userEvent.setup();
    renderInProject(<RfiListScreen />);
    await screen.findByRole('link', { name: 'RFI-003' });
    await user.click(screen.getByLabelText('Overdue only'));
    expect(nav.search).toBe('overdue=1');
  });
});

/**
 * Renders the form and waits for the drawing picker to load, so typing doesn't race the first data render on a
 * busy CI runner (a keystroke was lost there once).
 */
async function renderNewRfi() {
  renderInProject(<RfiNewScreen />);
  await screen.findByRole('option', { name: /A-101/ });
}

describe('RfiNewScreen', () => {
  it('defaults the due date to 5 business days and blocks submit until required fields are set', async () => {
    const user = userEvent.setup();
    await renderNewRfi();
    const due = screen.getByLabelText(/Due date/) as HTMLInputElement;
    expect(due.value).toBe('2026-10-09');
    expect(screen.getByText('5 business days from today')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Submit RFI' }));
    expect(screen.getByText('Add a subject.')).toBeTruthy();
    expect(screen.getByText('Choose who should answer.')).toBeTruthy();
    expect(nav.pushed).toEqual([]);

    await user.type(screen.getByLabelText(/Subject/), 'Bin store door hardware');
    await user.type(
      screen.getByRole('textbox', { name: /^Question/ }),
      'Which closer is specified',
    );
    await user.selectOptions(screen.getByLabelText(/Assignee/), 'usr_arch');
    await user.click(screen.getByRole('button', { name: 'Submit RFI' }));
    await waitFor(() => expect(nav.pushed).toHaveLength(1));
    expect(nav.pushed[0]).toMatch(/^\/acme\/projects\/prj_test\/rfis\/rfi_/);
  });

  it('only changes the question when the Nova wording is accepted', async () => {
    const user = userEvent.setup();
    await renderNewRfi();
    await user.type(
      screen.getByRole('textbox', { name: /^Question/ }),
      'which closer is specified',
    );
    await user.click(screen.getByRole('button', { name: 'Improve question' }));
    const suggestion = await screen.findByRole('region', { name: 'Drafted by Nova' });
    expect((screen.getByRole('textbox', { name: /^Question/ }) as HTMLTextAreaElement).value).toBe(
      'which closer is specified',
    );
    await user.click(within(suggestion).getByRole('button', { name: 'Use this wording' }));
    expect(
      (screen.getByRole('textbox', { name: /^Question/ }) as HTMLTextAreaElement).value,
    ).toMatch(/^Please confirm:/);
  });

  it('finds similar RFIs before submitting (RFI-US3)', async () => {
    const user = userEvent.setup();
    await renderNewRfi();
    await user.type(screen.getByLabelText(/Subject/), 'Bin store door closer');
    await user.click(screen.getByRole('button', { name: 'Check for similar RFIs' }));
    expect(await screen.findByText('Similar RFIs on this project')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'RFI-003' })).toBeTruthy();
  });
});

describe('RfiDetailScreen', () => {
  it('shows the ball in court and sends Respond to the Responses tab', async () => {
    const user = userEvent.setup();
    renderInProject(<RfiDetailScreen rfiId="rfi_003" />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Bin store door swing' }),
    ).toBeTruthy();
    expect(screen.getByText('Waiting on: Fold Architects · Mei Lin')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Respond' }));
    // The tab lives in the URL; re-render picks it up from the mocked router.
    expect(nav.search).toBe('tab=responses');
  });

  it('drafts a response with Nova that only fills the box when used', async () => {
    const user = userEvent.setup();
    nav.search = 'tab=responses';
    renderInProject(<RfiDetailScreen rfiId="rfi_003" />);
    await user.click(await screen.findByRole('button', { name: 'Draft response with Nova' }));
    const suggestion = await screen.findByRole('region', { name: 'Drafted by Nova' });
    expect(within(suggestion).getByRole('link', { name: 'A-101 Rev C' }).getAttribute('href')).toBe(
      '/acme/projects/prj_test/drawings/sht_a101?rev=rev_a101_c',
    );
    const box = screen.getByLabelText('Response') as HTMLTextAreaElement;
    expect(box.value).toBe('');
    await user.click(within(suggestion).getByRole('button', { name: 'Use draft' }));
    expect(box.value).toMatch(/A-101 Rev C/);
    await user.click(screen.getByRole('button', { name: 'Send response' }));
    expect(await screen.findByText('Started from a Nova draft')).toBeTruthy();
    expect(screen.getAllByText('Answered').length).toBeGreaterThan(0);
    expect(screen.getByText('Waiting on: Harbourline Constructions · Dana Okafor')).toBeTruthy();
  });

  it('closes an answered RFI with the chosen official response (RFI-AC7)', async () => {
    const user = userEvent.setup();
    renderInProject(<RfiDetailScreen rfiId="rfi_002" />);
    await user.click(await screen.findByRole('button', { name: 'Close RFI' }));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByRole('radio') as HTMLInputElement).checked).toBe(true);
    await user.click(within(dialog).getByRole('button', { name: 'Close with official response' }));
    await waitFor(() => expect(screen.getAllByText('Closed').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeTruthy();
  });

  it('needs a reason to void', async () => {
    const user = userEvent.setup();
    renderInProject(<RfiDetailScreen rfiId="rfi_004" />);
    await user.click(await screen.findByRole('button', { name: 'Void' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Void RFI' }));
    expect(within(dialog).getByText('Give a reason for voiding.')).toBeTruthy();
    await user.type(within(dialog).getByLabelText('Reason'), 'Raised in error');
    await user.click(within(dialog).getByRole('button', { name: 'Void RFI' }));
    expect(await screen.findByText('This RFI is void')).toBeTruthy();
  });
});
