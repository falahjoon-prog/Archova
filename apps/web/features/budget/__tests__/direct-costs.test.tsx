// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject } from '@/test/render';
import type { DirectCost } from '../data/api';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { DirectCostsPanel } = await import('../components/DirectCostsPanel');

const P = '/v1/orgs/{orgId}/projects/{projectId}';
const cost = (over: Partial<DirectCost> = {}): DirectCost => ({
  id: 'dcs_1',
  number: 1,
  budgetLineId: 'bln_1',
  category: 'materials',
  description: 'Formwork timber',
  supplier: 'Timber Co',
  reference: 'INV-204',
  incurredOn: '2026-10-01',
  amount: '1200.50',
  gst: '120.05',
  status: 'recorded',
  voidReason: null,
  voidedAt: null,
  createdAt: '2026-10-02T00:00:00Z',
  ...over,
});

beforeEach(() => {
  fake.reset();
  fake.on('GET', `${P}/budget`, () => ({
    id: 'bud_1',
    status: 'locked',
    lockedAt: '2026-10-01T00:00:00Z',
    lines: [
      {
        id: 'bln_1',
        costCodeId: 'ccd_1',
        code: '03-100',
        codeDescription: 'Concrete',
        description: '',
        original: '50000.00',
        approvedChanges: '0.00',
        revised: '50000.00',
        committed: '0.00',
        actual: '1200.50',
        forecastToComplete: '0.00',
        isMargin: false,
      },
    ],
    totals: {},
  }));
  fake.on('GET', `${P}/direct-costs`, () => ({
    data: [
      cost(),
      cost({
        id: 'dcs_2',
        number: 2,
        description: 'Duplicate entry',
        status: 'void',
        voidReason: 'Posted twice',
      }),
    ],
    total: '1200.50',
  }));
});

describe('DirectCostsPanel', () => {
  it('lists costs with the budget line, total and void reason', async () => {
    renderInProject(<DirectCostsPanel canManage />);
    expect(await screen.findByText('Formwork timber')).toBeTruthy();
    expect(screen.getAllByText('03-100 Concrete').length).toBeGreaterThan(0);
    expect(screen.getByText('Posted twice')).toBeTruthy();
    expect(screen.getByText(/Recorded direct costs total/)).toBeTruthy();
    // Only a recorded cost can be voided.
    expect(screen.getByRole('button', { name: 'Void DC-0001' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Void DC-0002' })).toBeNull();
  });

  it('validates, then records a cost against a budget line', async () => {
    fake.on('POST', `${P}/direct-costs`, () => cost());
    const user = userEvent.setup();
    renderInProject(<DirectCostsPanel canManage />);
    await screen.findByText('Formwork timber');
    await user.click(screen.getByRole('button', { name: 'Record direct cost' }));
    expect(await screen.findByText('Choose the budget line this cost belongs to.')).toBeTruthy();
    expect(fake.callsTo('POST', `${P}/direct-costs`)).toHaveLength(0);

    await user.selectOptions(screen.getByLabelText(/Budget line/), 'bln_1');
    await enterText(user, screen.getByLabelText(/^Description/), 'Hire of scaffold');
    await enterText(user, screen.getByLabelText(/^Amount/), '0');
    await user.click(screen.getByRole('button', { name: 'Record direct cost' }));
    expect(await screen.findByText(/Enter the amount ex GST/)).toBeTruthy();

    await user.clear(screen.getByLabelText(/^Amount/));
    await enterText(user, screen.getByLabelText(/^Amount/), '350.00');
    await user.click(screen.getByRole('button', { name: 'Record direct cost' }));
    await waitFor(() => expect(fake.callsTo('POST', `${P}/direct-costs`)).toHaveLength(1));
    expect(fake.callsTo('POST', `${P}/direct-costs`)[0]!.init.body).toMatchObject({
      budgetLineId: 'bln_1',
      category: 'materials',
      description: 'Hire of scaffold',
      amount: '350.00',
      gst: '0.00',
    });
  });

  it('needs a reason to void a cost', async () => {
    fake.on('POST', `${P}/direct-costs/{directCostId}/void`, () => cost({ status: 'void' }));
    const user = userEvent.setup();
    renderInProject(<DirectCostsPanel canManage />);
    await user.click(await screen.findByRole('button', { name: 'Void DC-0001' }));
    await user.click(screen.getByRole('button', { name: 'Confirm void' }));
    expect(await screen.findByText('Give the reason for voiding this cost.')).toBeTruthy();
    expect(fake.callsTo('POST', `${P}/direct-costs/{directCostId}/void`)).toHaveLength(0);
    await enterText(user, screen.getByLabelText(/Reason for voiding/), 'Posted twice');
    await user.click(screen.getByRole('button', { name: 'Confirm void' }));
    await waitFor(() =>
      expect(fake.callsTo('POST', `${P}/direct-costs/{directCostId}/void`)).toHaveLength(1),
    );
    expect(fake.callsTo('POST', `${P}/direct-costs/{directCostId}/void`)[0]!.init.body).toEqual({
      note: 'Posted twice',
    });
  });

  it('shows no forms or void buttons to someone who cannot manage', async () => {
    renderInProject(<DirectCostsPanel canManage={false} />);
    await screen.findByText('Formwork timber');
    expect(screen.queryByRole('button', { name: 'Record direct cost' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Void DC-0001' })).toBeNull();
  });
});
