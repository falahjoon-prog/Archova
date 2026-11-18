// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInProject } from '@/test/render';
import { divisionOf, groupLines, sumLines, type CostReportLine } from '../lib/costReport';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { CostReportPanel } = await import('../components/CostReportPanel');
const P = '/v1/orgs/{orgId}/projects/{projectId}';

const row = (over: Partial<CostReportLine> = {}): CostReportLine => ({
  lineId: 'bln_1',
  code: '03-100',
  codeDescription: 'Concrete',
  description: '',
  original: '100000.00',
  approvedChanges: '0.00',
  revised: '100000.00',
  approved: '60000.00',
  pending: '30000.00',
  nonCommitted: '20000.00',
  projected: '110000.00',
  variance: '-10000.00',
  ...over,
});

describe('cost report grouping', () => {
  it('groups by division and adds subtotals', () => {
    expect(divisionOf('03-100')).toBe('03');
    const g = groupLines([
      row(),
      row({ lineId: 'bln_2', code: '03-200' }),
      row({ lineId: 'bln_3', code: '09-100' }),
    ]);
    expect(g.map((x) => x.division)).toEqual(['03', '09']);
    expect(g[0]!.totals.projected).toBe('220000.00');
    expect(sumLines([row()]).variance).toBe('-10000.00');
  });
});

describe('CostReportPanel', () => {
  beforeEach(() => {
    fake.reset();
    fake.on('GET', `${P}/budget/cost-report`, () => ({
      hasBudget: true,
      status: 'locked',
      lines: [row()],
    }));
    fake.on('GET', `${P}/budget/lines/{lineId}/cost-report-items`, () => ({
      code: '03-100 - Concrete',
      total: '30000.00',
      groups: [
        {
          kind: 'subcontract',
          sourceId: 'cmt_1',
          label: 'SC-3 - Concrete package',
          total: '30000.00',
          items: [{ number: 1, description: 'Slab pour', amount: '30000.00' }],
        },
      ],
    }));
  });

  it('shows the figures, collapses a division, and drills into pending items', async () => {
    const user = userEvent.setup();
    renderInProject(<CostReportPanel />);
    expect(await screen.findByText(/Subtotal 03/)).toBeTruthy();
    await user.click(
      await screen.findByRole('button', { name: /Pending contracts & POs, 03-100/ }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('SC-3 - Concrete package')).toBeTruthy();
    expect(within(dialog).getByText('Slab pour')).toBeTruthy();
    expect(
      fake.callsTo('GET', `${P}/budget/lines/{lineId}/cost-report-items`)[0]!.init,
    ).toMatchObject({
      params: { query: { column: 'pending' } },
    });
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: /Subtotal 03/ }));
    await waitFor(() => expect(screen.queryByText('Concrete')).toBeNull());
  });
});
