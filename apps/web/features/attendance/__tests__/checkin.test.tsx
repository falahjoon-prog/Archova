// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nav, renderInProject } from '@/test/render';
import { buildCheckInLink, checkInMessage, parseGateCode } from '../lib/checkin';
import { CheckInScreen } from '../screens/CheckInScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

const CODE = 'gqr_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF';

beforeEach(() => {
  nav.search = '';
  window.location.hash = '';
});

describe('check-in link', () => {
  it('round-trips the gate code through the link and accepts a bare code', () => {
    const link = buildCheckInLink(
      'https://app.archova.com.au',
      '/acme/projects/p/attendance/check-in',
      CODE,
    );
    expect(
      link.startsWith('https://app.archova.com.au/acme/projects/p/attendance/check-in#code='),
    ).toBe(true);
    expect(parseGateCode(link)).toBe(CODE);
    expect(parseGateCode(CODE)).toBe(CODE);
    expect(parseGateCode('https://example.com')).toBeNull();
  });

  it('words each outcome', () => {
    expect(checkInMessage({ outcome: 'accepted', eligibility: null }).title).toMatch(/checked in/);
    const blocked = checkInMessage({
      outcome: 'blocked',
      eligibility: { reasons: [{ code: 'induction.missing', blocking: true }] },
    });
    expect(blocked.tone).toBe('danger');
    expect(blocked.detail).toBe('Site induction not done');
  });
});

describe('CheckInScreen', () => {
  it('checks in with the code from the link', async () => {
    window.location.hash = `#code=${CODE}`;
    const user = userEvent.setup();
    renderInProject(<CheckInScreen />);
    await user.click(await screen.findByRole('button', { name: 'Check in' }));
    expect(await screen.findByText('You’re checked in')).toBeTruthy();
  });

  it('asks for the code when the page is opened without one', async () => {
    renderInProject(<CheckInScreen />);
    const button = await screen.findByRole('button', { name: 'Check in' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('checks out', async () => {
    const user = userEvent.setup();
    renderInProject(<CheckInScreen />);
    await user.click(await screen.findByRole('button', { name: 'Check out' }));
    expect(await screen.findByText('You’re checked out')).toBeTruthy();
  });
});
