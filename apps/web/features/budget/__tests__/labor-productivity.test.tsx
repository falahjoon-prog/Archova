// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { LaborProductivityPanel } = await import('../components/LaborProductivityPanel');

const P = '/v1/orgs/{orgId}/projects/{projectId}';
const row = (over: Record<string, unknown> = {}) => ({
  costCodeId: 'ccd_1',
  code: '03-100',
  description: 'Slab',
  divisionId: 'ccd_0',
  parentId: 'ccd_0',
  uom: 'm2',
  budgetedHours: 100,
  timesheetHours: 80,
  pctHoursUsed: 0.8,
  pctComplete: 0.5,
  earnedHours: 50,
  budgetedQuantity: 500,
  quantityComplete: 250,
  budgetedRate: 5,
  actualRate: 3.13,
  flagged: true,
  ...over,
});

beforeEach(() => {
  fake.reset();
  fake.on('GET', `${P}/reports/labor-productivity`, () => ({
    rows: [
      row(),
      row({
        costCodeId: 'ccd_2',
        code: '03-200',
        description: 'Walls',
        actualRate: 6,
        flagged: false,
      }),
    ],
    totals: {
      budgetedHours: 200,
      timesheetHours: 160,
      earnedHours: 100,
      pctHoursUsed: 0.8,
      efficiency: 0.63,
      flaggedRows: 1,
    },
    unallocatedHours: 4,
    codes: [
      { id: 'ccd_0', code: '03', description: 'Concrete', parentId: null },
      { id: 'ccd_1', code: '03-100', description: 'Slab', parentId: 'ccd_0' },
      { id: 'ccd_2', code: '03-200', description: 'Walls', parentId: 'ccd_0' },
    ],
  }));
});

describe('LaborProductivityPanel', () => {
  it('shows the columns, flags the slow row and summarises the hours', async () => {
    renderInProject(<LaborProductivityPanel canManage />);
    expect(await screen.findByText('Slab')).toBeTruthy();
    expect(screen.getAllByText('Below plan')).toHaveLength(1);
    expect(screen.getAllByText('50.0%').length).toBeGreaterThan(0);
    expect(screen.getByText(/1 below plan/)).toBeTruthy();
    expect(screen.getByText(/4 hours have no cost code/)).toBeTruthy();
  });

  it('asks for the report again when a division is chosen', async () => {
    const user = userEvent.setup();
    renderInProject(<LaborProductivityPanel canManage={false} />);
    await screen.findByText('Slab');
    await user.selectOptions(screen.getByLabelText('Division'), 'ccd_0');
    await waitFor(() =>
      expect(
        fake
          .callsTo('GET', `${P}/reports/labor-productivity`)
          .some((c) => JSON.stringify(c.init).includes('ccd_0')),
      ).toBe(true),
    );
    expect(screen.queryByRole('button', { name: /Edit plan/ })).toBeNull();
  });

  it('validates then saves a plan', async () => {
    fake.on('PUT', `${P}/cost-codes/{costCodeId}/production`, () => ({}));
    const user = userEvent.setup();
    renderInProject(<LaborProductivityPanel canManage />);
    await user.click(await screen.findByRole('button', { name: 'Edit plan 03-100' }));
    await user.clear(screen.getByLabelText(/^Budgeted hours/));
    await user.click(screen.getByRole('button', { name: 'Save plan' }));
    expect(await screen.findByText(/Enter the budgeted hours/)).toBeTruthy();
    await enterText(user, screen.getByLabelText(/^Budgeted hours/), '120');
    await user.click(screen.getByRole('button', { name: 'Save plan' }));
    await waitFor(() =>
      expect(fake.callsTo('PUT', `${P}/cost-codes/{costCodeId}/production`)).toHaveLength(1),
    );
    expect(fake.callsTo('PUT', `${P}/cost-codes/{costCodeId}/production`)[0]!.init.body).toEqual({
      uom: 'm2',
      budgetedHours: 120,
      budgetedQuantity: 500,
      quantityComplete: 250,
    });
  });
});
