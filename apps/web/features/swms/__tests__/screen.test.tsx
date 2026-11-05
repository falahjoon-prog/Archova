// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, nav, renderInProject } from '@/test/render';
import { resetSwmsPreview, swmsPreview } from '../data/source';
import { SwmsScreen } from '../screens/SwmsScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

beforeEach(() => {
  resetSwmsPreview();
  nav.search = '';
});

describe('SwmsScreen', () => {
  it('lists SWMS and submits a new one', async () => {
    const user = userEvent.setup();
    renderInProject(<SwmsScreen />);
    const table = await screen.findByRole('table', { name: 'SWMS' });
    expect(within(table).getByText('SWMS-0001')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Submit SWMS/ }));
    await enterText(user, screen.getByLabelText('Title'), 'Crane lift, roof plant');
    await user.click(screen.getByRole('checkbox', { name: CATEGORY_MOBILE }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit SWMS' }),
    );
    expect(await screen.findByText('SWMS-0003')).toBeTruthy();
    const added = (await swmsPreview.list('prj_test', {})).find(
      (s) => s.numberLabel === 'SWMS-0003',
    );
    expect(added!.categories).toEqual(['mobile_plant']);
  });

  it('blocks accepting while content is missing, then reviews and accepts a complete one', async () => {
    const user = userEvent.setup();
    nav.search = 'id=sws_0002';
    const gaps = renderInProject(<SwmsScreen />);
    expect(await screen.findByText('Describe the high-risk work.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Mark reviewed' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark reviewed' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Accept' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/still missing/)).toBeTruthy();
    expect(
      (within(dialog).getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    gaps.unmount();

    nav.search = 'id=sws_0001';
    renderInProject(<SwmsScreen />);
    await user.click(await screen.findByRole('button', { name: 'Mark reviewed' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark reviewed' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Accept' }));
    const accept = within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Accept',
    }) as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
    await user.click(screen.getByRole('checkbox'));
    await user.click(accept);
    await waitFor(async () =>
      expect((await swmsPreview.get('prj_test', 'sws_0001')).swms.status).toBe('accepted'),
    );
    await enterText(user, await screen.findByLabelText('Worker name'), 'Sam Lee');
    await user.click(screen.getByRole('button', { name: /Record that they/ }));
    expect(await screen.findByText('Sam Lee')).toBeTruthy();
  });
});

const CATEGORY_MOBILE = 'Powered mobile plant movement';
