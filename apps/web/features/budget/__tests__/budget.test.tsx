// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject } from '@/test/render';
import type { Budget, BudgetLine } from '../data/api';
import { parseAmount, parseSignedAmount } from '../lib/money';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
vi.mock('@/features/projects', () => ({
  useProjectPermissions: () => ({ data: { orgRole: 'admin', toolLevels: { budget: 'admin' } } }),
}));

const { BudgetScreen } = await import('../screens/BudgetScreen');

const P = '/v1/orgs/{orgId}/projects/{projectId}';
const line = (over: Partial<BudgetLine> = {}): BudgetLine => ({
  id: 'bln_1',
  costCodeId: 'ccd_1',
  code: '03-100',
  codeDescription: 'Concrete',
  description: '',
  original: '50000.00',
  approvedChanges: '0.00',
  revised: '50000.00',
  committed: '0.00',
  actual: '0.00',
  forecastToComplete: '0.00',
  isMargin: false,
  ...over,
});
const budget = (over: Partial<Budget> = {}): Budget => ({
  id: 'bud_1',
  status: 'draft',
  lockedAt: null,
  lines: [line()],
  totals: {
    original: '50000.00',
    approvedChanges: '0.00',
    revised: '50000.00',
    committed: '0.00',
    actual: '0.00',
    forecastToComplete: '0.00',
  },
  ...over,
});

beforeEach(() => {
  fake.reset();
  fake.on('GET', `${P}/cost-codes`, () => ({
    data: [
      { id: 'ccd_1', code: '03-100', description: 'Concrete', parentId: null, archived: false },
    ],
  }));
});

describe('parsing amounts', () => {
  it('accepts plain dollar amounts and rejects zero or malformed signed ones', () => {
    expect(parseAmount('12500.50')).toBe('12500.50');
    expect(parseAmount('-5')).toBeNull();
    expect(parseSignedAmount('-1500')).toBe('-1500');
    expect(parseSignedAmount('+20')).toBe('20');
    expect(parseSignedAmount('0.00')).toBeNull();
    expect(parseSignedAmount('abc')).toBeNull();
  });
});

describe('BudgetScreen', () => {
  it('offers to start a budget when none exists', async () => {
    fake.on('GET', `${P}/budget`, () =>
      budget({
        id: null,
        lines: [],
        totals: { ...budget().totals, original: '0.00', revised: '0.00' },
      }),
    );
    fake.on('POST', `${P}/budget`, () => budget({ lines: [] }));
    const user = userEvent.setup();
    renderInProject(<BudgetScreen />);
    await user.click(await screen.findByRole('button', { name: 'Start the budget' }));
    await waitFor(() => expect(fake.callsTo('POST', `${P}/budget`)).toHaveLength(1));
  });

  it('confirms before locking the budget', async () => {
    fake.on('GET', `${P}/budget`, () => budget());
    fake.on('POST', `${P}/budget/lock`, () => budget({ status: 'locked' }));
    const user = userEvent.setup();
    renderInProject(<BudgetScreen />);
    await user.click(await screen.findByRole('button', { name: 'Lock budget' }));
    expect(fake.callsTo('POST', `${P}/budget/lock`)).toHaveLength(0);
    const buttons = await screen.findAllByRole('button', { name: 'Lock budget' });
    await user.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(fake.callsTo('POST', `${P}/budget/lock`)).toHaveLength(1));
  });

  it('needs a reason, and stays above zero, when adjusting a locked line', async () => {
    fake.on('GET', `${P}/budget`, () =>
      budget({ status: 'locked', lockedAt: '2026-11-01T00:00:00Z' }),
    );
    fake.on('GET', `${P}/budget/lines/{lineId}/adjustments`, () => ({ data: [] }));
    fake.on('POST', `${P}/budget/lines/{lineId}/adjustments`, () => line());
    const user = userEvent.setup();
    renderInProject(<BudgetScreen />);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Adjust' }));
    await enterText(user, await screen.findByLabelText(/Change \(AUD/), '2500');
    await user.click(screen.getByRole('button', { name: 'Record adjustment' }));
    expect(await screen.findByText('Give the reason for this change.')).toBeTruthy();

    await user.clear(screen.getByLabelText(/Change \(AUD/));
    await enterText(user, screen.getByLabelText(/Change \(AUD/), '-60000');
    await enterText(user, screen.getByLabelText(/Reason/), 'Scope removed');
    await user.click(screen.getByRole('button', { name: 'Record adjustment' }));
    expect(await screen.findByText('This would take the line below zero.')).toBeTruthy();
    expect(fake.callsTo('POST', `${P}/budget/lines/{lineId}/adjustments`)).toHaveLength(0);
  });

  it('shows the buyout summary and the budget modifications from the Reports tab', async () => {
    fake.on('GET', `${P}/budget`, () =>
      budget({ lines: [line({ revised: '50000.00', committed: '20000.00' })] }),
    );
    fake.on('GET', `${P}/budget/adjustments`, () => ({
      data: [
        {
          id: 'bad_1',
          amount: '-500.00',
          reason: 'Scope removed',
          createdAt: '2026-11-02T00:00:00Z',
          lineId: 'bln_1',
          code: '03-100',
          codeDescription: 'Concrete',
        },
      ],
    }));
    const user = userEvent.setup();
    renderInProject(<BudgetScreen />);
    await user.click(await screen.findByRole('tab', { name: 'Reports' }));
    expect(await screen.findByText('Part bought out')).toBeTruthy();
    expect(screen.getByText('40%')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Budget modifications' }));
    expect(await screen.findByText('Scope removed')).toBeTruthy();
  });

  it('adds a cost code from the Cost codes tab', async () => {
    fake.on('GET', `${P}/budget`, () => budget());
    fake.on('POST', `${P}/cost-codes`, () => ({
      id: 'ccd_2',
      code: '04-200',
      description: 'Masonry',
      parentId: null,
      archived: false,
    }));
    const user = userEvent.setup();
    renderInProject(<BudgetScreen />);
    await user.click(await screen.findByRole('tab', { name: 'Cost codes' }));
    await user.click(await screen.findByRole('button', { name: 'Add cost code' }));
    expect(await screen.findByText('Enter a code, like 03-100.')).toBeTruthy();
    await enterText(user, screen.getByLabelText(/^Code/), '04-200');
    await enterText(user, screen.getByLabelText(/^Description/), 'Masonry');
    await user.click(screen.getByRole('button', { name: 'Add cost code' }));
    await waitFor(() => expect(fake.callsTo('POST', `${P}/cost-codes`)).toHaveLength(1));
    expect(fake.callsTo('POST', `${P}/cost-codes`)[0]!.init.body).toEqual({
      code: '04-200',
      description: 'Masonry',
    });
  });
});

describe('Snapshots tab', () => {
  it('names a snapshot before taking it and lists it afterwards', async () => {
    fake.on('GET', `${P}/budget`, () => budget());
    fake.on('GET', `${P}/budget/snapshots`, () => ({ data: [] }));
    fake.on('POST', `${P}/budget/snapshots`, () => ({
      id: 'bsn_1',
      name: 'Tender',
      note: null,
      takenAt: '2026-11-06T00:00:00Z',
      lines: [],
      totals: { original: '0.00', approvedChanges: '0.00', revised: '0.00' },
    }));
    const user = userEvent.setup();
    renderInProject(<BudgetScreen />);
    await user.click(await screen.findByRole('tab', { name: 'Snapshots' }));
    await user.click(await screen.findByRole('button', { name: 'Take snapshot' }));
    expect(await screen.findByText(/Give the snapshot a name/)).toBeTruthy();
    expect(fake.callsTo('POST', `${P}/budget/snapshots`)).toHaveLength(0);
    await enterText(user, screen.getByLabelText(/^Name/), 'Tender');
    await user.click(screen.getByRole('button', { name: 'Take snapshot' }));
    await waitFor(() => expect(fake.callsTo('POST', `${P}/budget/snapshots`)).toHaveLength(1));
    expect(fake.callsTo('POST', `${P}/budget/snapshots`)[0]!.init.body).toEqual({ name: 'Tender' });
  });
});
