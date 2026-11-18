// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { ProductionPanel } = await import('../components/ProductionPanel');

const P = '/v1/orgs/{orgId}/projects/{projectId}';
const item = {
  id: 'pit_1',
  name: 'Panels installed',
  uom: 'panels',
  trade: 'Solar',
  location: 'Block A',
  plannedQuantity: 1000,
  plannedStart: '2026-10-01',
  plannedFinish: '2026-12-01',
  archived: false,
};

beforeEach(() => {
  fake.reset();
  fake.on('GET', `${P}/production/report`, () => ({
    asOf: '2026-11-07',
    items: [
      { item, actual: 300, pctComplete: 0.3, plannedToDate: 450, variance: -150, status: 'behind' },
    ],
    curves: [
      {
        uom: 'panels',
        points: [
          { date: '2026-10-11', planned: 160, actual: 120 },
          { date: '2026-11-07', planned: 450, actual: 300 },
          { date: '2026-12-01', planned: 1000, actual: null },
        ],
      },
    ],
    byTrade: [{ name: 'Solar', uom: 'panels', planned: 1000, actual: 300 }],
    byLocation: [{ name: 'Block A', uom: 'panels', planned: 1000, actual: 300 }],
    flags: [
      {
        kind: 'crew',
        name: 'Crew 2',
        uom: 'panels',
        recentRate: 6,
        baselineRate: 10,
        dropPct: 0.4,
      },
    ],
  }));
});

describe('ProductionPanel', () => {
  it('shows progress against plan, the curve table and Nova’s rate-drop flag', async () => {
    renderInProject(<ProductionPanel canManage />);
    expect(await screen.findByText('Panels installed')).toBeTruthy();
    expect(screen.getByText('Behind plan')).toBeTruthy();
    expect(screen.getByText(/Crew Crew 2 is installing 6 panels a working day/)).toBeTruthy();
    expect(screen.getByText(/40.0% down on its 10 average/)).toBeTruthy();
    expect(screen.getByRole('img', { name: /300 installed of 1,000 planned/ })).toBeTruthy();
    expect(
      screen.getByRole('table', { name: 'Planned and installed panels by week' }),
    ).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Installed by trade' })).toBeTruthy();
  });

  it('asks for the report again when a trade is chosen and hides setup from non-managers', async () => {
    const user = userEvent.setup();
    renderInProject(<ProductionPanel canManage={false} />);
    await screen.findByText('Panels installed');
    await user.selectOptions(screen.getByLabelText('Trade'), 'Solar');
    await waitFor(() =>
      expect(
        fake
          .callsTo('GET', `${P}/production/report`)
          .some((c) => JSON.stringify(c.init).includes('Solar')),
      ).toBe(true),
    );
    expect(screen.queryByRole('button', { name: 'Add production item' })).toBeNull();
  });

  it('validates then creates a production item', async () => {
    fake.on('POST', `${P}/production/items`, () => item);
    const user = userEvent.setup();
    renderInProject(<ProductionPanel canManage />);
    await user.click(await screen.findByRole('button', { name: 'Add production item' }));
    await user.click(screen.getByRole('button', { name: 'Save item' }));
    expect(await screen.findByText(/Name what is being installed/)).toBeTruthy();
    await enterText(user, screen.getByLabelText(/^Name/), 'LF of conduit');
    await enterText(user, screen.getByLabelText(/^Unit/), 'LF');
    await enterText(user, screen.getByLabelText(/^Planned quantity/), '2500');
    await enterText(user, screen.getByLabelText(/^Planned finish/), '2026-12-15');
    await user.click(screen.getByRole('button', { name: 'Save item' }));
    await waitFor(() => expect(fake.callsTo('POST', `${P}/production/items`)).toHaveLength(1));
    expect(fake.callsTo('POST', `${P}/production/items`)[0]!.init.body).toMatchObject({
      name: 'LF of conduit',
      uom: 'LF',
      plannedQuantity: 2500,
      plannedFinish: '2026-12-15',
    });
  });

  it('logs quantity with a crew and refuses a correction without a note', async () => {
    fake.on('GET', `${P}/production/items/{itemId}/entries`, () => ({ data: [] }));
    fake.on('POST', `${P}/production/items/{itemId}/entries`, () => ({
      entry: {},
      quantityInstalled: 312,
    }));
    const user = userEvent.setup();
    renderInProject(<ProductionPanel canManage={false} />);
    await user.click(await screen.findByRole('button', { name: 'Log quantity Panels installed' }));
    await enterText(user, screen.getByLabelText(/^Quantity installed/), '-5');
    await user.click(screen.getByRole('button', { name: 'Log quantity' }));
    expect(await screen.findByText(/Say why the quantity is being taken off/)).toBeTruthy();
    expect(fake.callsTo('POST', `${P}/production/items/{itemId}/entries`)).toHaveLength(0);
    await user.clear(screen.getByLabelText(/^Quantity installed/));
    await enterText(user, screen.getByLabelText(/^Quantity installed/), '12');
    await enterText(user, screen.getByLabelText(/^Crew/), 'Crew 2');
    await user.click(screen.getByRole('button', { name: 'Log quantity' }));
    await waitFor(() =>
      expect(fake.callsTo('POST', `${P}/production/items/{itemId}/entries`)).toHaveLength(1),
    );
    expect(
      fake.callsTo('POST', `${P}/production/items/{itemId}/entries`)[0]!.init.body,
    ).toMatchObject({ quantity: 12, crew: 'Crew 2' });
  });
});
