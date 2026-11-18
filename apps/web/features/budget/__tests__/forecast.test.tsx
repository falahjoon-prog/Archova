// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject } from '@/test/render';
import { monthsBetween, spread, toCents } from '../lib/forecast';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { ForecastPanel } = await import('../components/ForecastPanel');
const P = '/v1/orgs/{orgId}/projects/{projectId}';

describe('spreading a total over months', () => {
  it('lists months inclusive and rejects bad or reversed ranges', () => {
    expect(monthsBetween('2026-11', '2027-02')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
    expect(monthsBetween('2027-02', '2026-11')).toBeNull();
    expect(monthsBetween('2026-13', '2027-01')).toBeNull();
  });

  it('always adds back to the total, whatever the curve', () => {
    const months = monthsBetween('2026-11', '2027-07')!;
    for (const curve of ['even', 'front', 'back', 's'] as const) {
      const out = spread(10000001, months, curve);
      expect(Object.values(out).reduce((n, v) => n + toCents(v), 0)).toBe(10000001);
    }
    const front = spread(100000, ['2026-11', '2026-12', '2027-01'], 'front');
    expect(toCents(front['2026-11']!)).toBeGreaterThan(toCents(front['2027-01']!));
  });
});

const line = {
  lineId: 'bln_1',
  code: '03-100',
  codeDescription: 'Concrete',
  description: '',
  original: '1200.00',
  approvedChanges: '0.00',
  revised: '1200.00',
  approved: '1000.00',
  pending: '200.00',
  nonCommitted: '0.00',
  projected: '1200.00',
  variance: '0.00',
  entries: {},
  scheduled: '0.00',
  unscheduled: '1200.00',
};

describe('ForecastPanel', () => {
  beforeEach(() => {
    fake.reset();
    fake.on('GET', `${P}/budget/forecast`, () => ({ hasBudget: true, months: [], lines: [line] }));
    fake.on('PUT', `${P}/budget/forecast`, () => ({ hasBudget: true, months: [], lines: [line] }));
  });

  it('spreads the selected line over the range and saves only what changed', async () => {
    const user = userEvent.setup();
    renderInProject(<ForecastPanel canManage />);
    await user.click(await screen.findByRole('checkbox', { name: /Select 03-100/ }));
    await enterText(user, screen.getByLabelText('Start month'), '2026-11');
    await enterText(user, screen.getByLabelText('End month'), '2027-02');
    await user.click(screen.getByRole('button', { name: /Apply to 1 selected/ }));
    expect(
      ((await screen.findByLabelText('03-100 Concrete Nov 2026')) as HTMLInputElement).value,
    ).toBe('300.00');
    await user.click(screen.getByRole('button', { name: 'Save forecast' }));
    await waitFor(() => expect(fake.callsTo('PUT', `${P}/budget/forecast`)).toHaveLength(1));
    expect(fake.callsTo('PUT', `${P}/budget/forecast`)[0]!.init).toMatchObject({
      body: {
        lines: [
          {
            lineId: 'bln_1',
            entries: {
              '2026-11': '300.00',
              '2026-12': '300.00',
              '2027-01': '300.00',
              '2027-02': '300.00',
            },
          },
        ],
      },
    });
  });

  it('asks for a valid range before spreading', async () => {
    const user = userEvent.setup();
    renderInProject(<ForecastPanel canManage />);
    await user.click(await screen.findByRole('checkbox', { name: /Select 03-100/ }));
    await user.click(screen.getByRole('button', { name: /Apply to 1 selected/ }));
    expect(await screen.findByText(/start and end month/)).toBeTruthy();
    expect(fake.callsTo('PUT', `${P}/budget/forecast`)).toHaveLength(0);
  });
});
