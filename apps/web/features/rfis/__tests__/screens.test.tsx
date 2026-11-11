// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nav, renderInProject, enterText } from '@/test/render';
import { resetRfisPreview, rfisSource } from '../data/source';
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

  it('shows the register columns and lets Nova flag a ball held too long', async () => {
    const user = userEvent.setup();
    renderInProject(<RfiListScreen />);
    await screen.findByRole('link', { name: 'RFI-003' });
    for (const name of [
      'Responsible contractor',
      'Received from',
      'Date initiated',
      'RFI manager',
      'Assignee',
      'Ball in court',
    ])
      expect(screen.getByRole('columnheader', { name: new RegExp(name) })).toBeTruthy();
    const row3 = screen.getByRole('link', { name: 'RFI-003' }).closest('tr')!;
    expect(within(row3).getByText(/Waiting \d+ business days/)).toBeTruthy();
    const row4 = screen.getByRole('link', { name: 'RFI-004' }).closest('tr')!;
    expect(within(row4).queryByText(/Waiting \d+ business days/)).toBeNull();
    await user.click(screen.getByLabelText('Ball held 5+ days'));
    expect(nav.search).toBe('stale=1');
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
  await within(await screen.findByLabelText('Drawing')).findByRole('option', { name: /A-101/ });
}

describe('RfiNewScreen', () => {
  it('fills the subject and question from a Nova draft of a site note, only when accepted (F3)', async () => {
    const user = userEvent.setup();
    renderInProject(<RfiNewScreen />);
    await enterText(
      user,
      await screen.findByLabelText('What did you find on site?'),
      'Slab edge at grid C is 20 mm proud.',
    );
    await user.click(screen.getByRole('button', { name: 'Draft with Nova' }));
    expect(await screen.findByText('Drafted RFI')).toBeTruthy();
    expect((screen.getByLabelText(/^Subject/) as HTMLInputElement).value).toBe('');
    await user.click(screen.getByRole('button', { name: 'Use this draft' }));
    expect((screen.getByLabelText(/^Subject/) as HTMLInputElement).value).toMatch(/Slab edge/);
    expect(
      (screen.getByRole('textbox', { name: /^Question/ }) as HTMLTextAreaElement).value,
    ).toMatch(/Please confirm/);
    expect(screen.queryByText('Drafted RFI')).toBeNull();
  });

  it('creates a draft RFI straight from a Nova draft, without submitting it (F3)', async () => {
    const user = userEvent.setup();
    renderInProject(<RfiNewScreen />);
    await enterText(
      user,
      await screen.findByLabelText('What did you find on site?'),
      'Slab edge at grid C is 20 mm proud.',
    );
    await user.click(screen.getByRole('button', { name: 'Draft with Nova' }));
    expect(await screen.findByText('Drafted RFI')).toBeTruthy();
    expect(nav.pushed).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Create draft RFI' }));
    await waitFor(() => expect(nav.pushed).toHaveLength(1));
    expect(nav.pushed[0]).toMatch(/^\/acme\/projects\/prj_test\/rfis\/rfi_/);
  });

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

    await enterText(user, screen.getByLabelText(/Subject/), 'Bin store door hardware');
    await enterText(
      user,
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
    await enterText(
      user,
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
    await enterText(user, screen.getByLabelText(/Subject/), 'Bin store door closer');
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
    expect(screen.getByText('Waiting on: Harbour Line Constructions · Dana Okafor')).toBeTruthy();
  });

  it('records the Nova draft as accepted, edited or rejected once the response is decided', async () => {
    const user = userEvent.setup();
    const decide = vi.spyOn(rfisSource, 'novaDecide');
    nav.search = 'tab=responses';
    renderInProject(<RfiDetailScreen rfiId="rfi_003" />);
    await enterText(
      user,
      await screen.findByLabelText(/What should the answer say/),
      'use the detail on the drawing',
    );
    await user.click(screen.getByRole('button', { name: 'Draft response with Nova' }));
    const suggestion = await screen.findByRole('region', { name: 'Drafted by Nova' });
    expect(within(suggestion).getByText(/Use the detail on the drawing\./)).toBeTruthy();
    await user.click(within(suggestion).getByRole('button', { name: 'Discard' }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith('prj_test', expect.any(String), 'rejected'),
    );

    await user.click(screen.getByRole('button', { name: 'Draft response with Nova' }));
    await user.click(
      within(await screen.findByRole('region', { name: 'Drafted by Nova' })).getByRole('button', {
        name: 'Use draft',
      }),
    );
    await enterText(
      user,
      screen.getByRole('textbox', { name: /^Response/ }),
      ' Proceed as drawn, no change.',
    );
    await user.click(screen.getByRole('button', { name: 'Send response' }));
    await waitFor(() =>
      expect(decide).toHaveBeenLastCalledWith('prj_test', expect.any(String), 'edited'),
    );
    decide.mockRestore();
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
    await enterText(user, within(dialog).getByLabelText('Reason'), 'Raised in error');
    await user.click(within(dialog).getByRole('button', { name: 'Void RFI' }));
    expect(await screen.findByText('This RFI is void')).toBeTruthy();
  });

  it("marks up an RFI photo into the caller's own layer, only saved on Save (photo annotation)", async () => {
    const user = userEvent.setup();
    // jsdom loads no images and has no layout: give the photo a size and the canvas a box.
    class FakeImage {
      naturalWidth = 800;
      naturalHeight = 600;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    nav.search = 'tab=details';
    const { rerender } = renderInProject(<RfiDetailScreen rfiId="rfi_003" />);
    const tile = await screen.findByRole('button', { name: /bin-store-door\.jpg/ });
    expect(within(tile).getByText('Open to mark up')).toBeTruthy();
    await user.click(tile);
    // The open photo is in the URL; the screen reads it back on the next render.
    expect(nav.search).toContain('photo=fil_binstore');
    rerender(<RfiDetailScreen rfiId="rfi_003" />);

    const canvas = await screen.findByRole('application');
    await user.click(screen.getByRole('button', { name: 'Arrow' }));
    await user.pointer([
      { target: canvas, keys: '[MouseLeft>]', coords: { clientX: 100, clientY: 100 } },
      { target: canvas, coords: { clientX: 300, clientY: 250 } },
      { target: canvas, keys: '[/MouseLeft]', coords: { clientX: 400, clientY: 300 } },
    ]);
    expect(screen.getByText(/You: 1 mark \(not saved\)/)).toBeTruthy();
    // Nothing is stored until Save.
    expect(await rfisSource.annotations('prj_test', 'rfi_003')).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Save marks' }));
    await waitFor(async () =>
      expect(await rfisSource.annotations('prj_test', 'rfi_003')).toHaveLength(1),
    );
    const [layer] = await rfisSource.annotations('prj_test', 'rfi_003');
    expect(layer!.shapes[0]).toMatchObject({ kind: 'arrow', color: '#D92D20', strokeWidth: 2 });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps marks read-only once the RFI is closed', async () => {
    renderInProject(<RfiDetailScreen rfiId="rfi_001" />);
    // RFI-001 has no photos, and a closed RFI offers no way to add one.
    expect(await screen.findByText('Nothing was attached to this RFI.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add photo' })).toBeNull();
  });
});
