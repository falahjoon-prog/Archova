// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, nav, renderInProject } from '@/test/render';
import { environmentPreview, resetEnvironmentPreview } from '../data/source';
import { EnvironmentScreen } from '../screens/EnvironmentScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

beforeEach(() => {
  resetEnvironmentPreview();
  nav.search = '';
});

describe('EnvironmentScreen', () => {
  it('shows compliance figures and Nova flags over the register', async () => {
    renderInProject(<EnvironmentScreen />);
    const flags = await screen.findByLabelText('Nova flags');
    expect(within(flags).getByText(/flagged non-compliant \(EMC-0002\)/)).toBeTruthy();
    expect(within(flags).getByText(/1 sign-off overdue/)).toBeTruthy();
    expect(within(flags).getByText(/1 document expires within 30 days/)).toBeTruthy();
    expect(await screen.findByText('25%')).toBeTruthy();
  });

  it('lists conditions and filters by status', async () => {
    const first = renderInProject(<EnvironmentScreen />);
    const table = await screen.findByRole('table', { name: 'Environmental conditions' });
    expect(within(table).getByText('EMC-0001')).toBeTruthy();
    expect(within(table).getByText(/Overdue/)).toBeTruthy();
    first.unmount();
    nav.search = 'status=compliant';
    renderInProject(<EnvironmentScreen />);
    expect(await screen.findByText('EMC-0003')).toBeTruthy();
    expect(screen.queryByText('EMC-0001')).toBeNull();
  });

  it('needs a reason to flag non-compliance, and a note or evidence to sign off', async () => {
    const user = userEvent.setup();
    renderInProject(<EnvironmentScreen />);
    await user.click(await screen.findByRole('button', { name: 'Flag non-compliance EMC-0001' }));
    const flag = screen.getByRole('button', { name: 'Flag non-compliance' }) as HTMLButtonElement;
    expect(flag.disabled).toBe(true);
    await enterText(user, screen.getByLabelText('Reason'), 'Haul road dry, no water cart');
    await user.click(flag);
    await waitFor(async () =>
      expect(
        (await environmentPreview.listConditions('prj_test', {})).find(
          (c) => c.numberLabel === 'EMC-0001',
        )!.status,
      ).toBe('non_compliant'),
    );

    await user.click(await screen.findByRole('button', { name: 'Sign off EMC-0002' }));
    const sign = screen.getByRole('button', { name: 'Sign off' }) as HTMLButtonElement;
    expect(sign.disabled).toBe(true);
    await enterText(user, screen.getByLabelText(/What was checked/), 'Retested, within limits');
    await user.click(sign);
    await waitFor(async () =>
      expect(
        (await environmentPreview.listConditions('prj_test', {})).find(
          (c) => c.numberLabel === 'EMC-0002',
        )!.status,
      ).toBe('compliant'),
    );
  });

  it('shows the sign-off history', async () => {
    const user = userEvent.setup();
    renderInProject(<EnvironmentScreen />);
    await user.click(await screen.findByRole('button', { name: 'History of EMC-0003' }));
    expect(await screen.findByText(/Noise logger readings within limits/)).toBeTruthy();
  });

  it('loads the standard conditions once', async () => {
    const user = userEvent.setup();
    renderInProject(<EnvironmentScreen />);
    await user.click(await screen.findByRole('button', { name: 'Load standard conditions' }));
    expect(await screen.findByText('Sediment and erosion controls inspected')).toBeTruthy();
    expect((await environmentPreview.applyStarterPack('prj_test')).created).toBe(0);
  });

  it('lists documents with their expiry state', async () => {
    nav.search = 'tab=documents';
    renderInProject(<EnvironmentScreen />);
    const table = await screen.findByRole('table', { name: 'Environmental documents' });
    expect(within(table).getByText('EPA works approval')).toBeTruthy();
    expect(within(table).getByText('Expiring soon')).toBeTruthy();
  });

  it('shows monitoring points with the latest reading and a rising warning', async () => {
    nav.search = 'tab=monitoring';
    renderInProject(<EnvironmentScreen />);
    const table = await screen.findByRole('table', { name: 'Monitoring points' });
    expect(within(table).getByText('Dust monitor, north boundary')).toBeTruthy();
    expect(within(table).getByText('Rising')).toBeTruthy();
    const flags = await screen.findByLabelText('Nova flags');
    expect(within(flags).getByText(/1 monitoring breach is waiting/)).toBeTruthy();
  });

  it('flags the linked condition when a logged reading breaches, and the breach needs a response', async () => {
    const user = userEvent.setup();
    nav.search = 'tab=monitoring';
    renderInProject(<EnvironmentScreen />);
    await user.click(
      await screen.findByRole('button', { name: 'Log a reading for Noise logger, Smith St' }),
    );
    const save = screen.getByRole('button', { name: 'Log reading' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await enterText(user, screen.getByLabelText(/Reading \(dB\(A\)\)/), '82');
    await user.click(save);
    await waitFor(async () =>
      expect(
        (await environmentPreview.listConditions('prj_test', {})).find(
          (c) => c.numberLabel === 'EMC-0003',
        )!.status,
      ).toBe('non_compliant'),
    );

    await user.click(
      await screen.findByRole('button', {
        name: 'Respond to the breach at Noise logger, Smith St',
      }),
    );
    const record = screen.getByRole('button', { name: 'Record response' }) as HTMLButtonElement;
    expect(record.disabled).toBe(true);
    await enterText(user, screen.getByLabelText('Corrective action'), 'Works paused for the hour');
    await user.click(record);
    await waitFor(async () =>
      expect(
        (await environmentPreview.listReadings('prj_test', { status: 'breach', open: true }))
          .length,
      ).toBe(1),
    );
  });
});
