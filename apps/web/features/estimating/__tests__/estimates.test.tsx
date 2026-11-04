// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
vi.mock('@/shared/lib/data-mode', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  previewDataOnly: false,
}));
vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

const { EstimateScreen } = await import('../screens/EstimateScreen');
const { createEstimatesApi, groupForEstimate } = await import('../data/estimates-api');

const ONE = '/v1/orgs/{orgId}/projects/{projectId}/estimates/{estimateId}';

const line = (over: Record<string, unknown> = {}) => ({
  id: 'esl_1',
  parentId: null,
  kind: 'item',
  sort: 1,
  costItemId: null,
  description: 'Porcelain floor tile',
  quantity: '50.000',
  unit: 'm2',
  rate: '85.00',
  amount: '4250.00',
  measurementIds: ['tkm_1'],
  pendingMeasurements: 0,
  unitMismatch: false,
  ...over,
});

const sheet = (over: Record<string, unknown> = {}) => ({
  id: 'est_1',
  projectId: 'prj_1',
  number: 1,
  numberLabel: 'EST-001',
  name: 'Tender estimate',
  status: 'draft',
  baseDate: '2026-10-30',
  region: null,
  contingencyPct: '5.00',
  marginPct: '10.00',
  marginBasis: 'markup',
  gstPct: '10.00',
  issuedAt: null,
  issuedBy: null,
  lines: [line()],
  totals: {
    subtotal: '4250.00',
    contingency: '212.50',
    margin: '446.25',
    totalExGst: '4908.75',
    gst: '490.88',
    totalIncGst: '5399.63',
    missingRates: 0,
    sections: {},
  },
  createdAt: '2026-10-30T00:00:00Z',
  updatedAt: '2026-10-30T00:00:00Z',
  version: 4,
  ...over,
});

beforeEach(() => fake.reset());

describe('EstimateScreen', () => {
  it('shows the server totals and offers to issue a fully priced sheet', async () => {
    fake.on('GET', ONE, () => sheet());
    renderInProject(<EstimateScreen estimateId="est_1" />);
    expect(await screen.findByText('$5,399.63')).toBeTruthy();
    expect(screen.getByText('$4,908.75')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Issue estimate' }).hasAttribute('disabled')).toBe(
      false,
    );
    // Quantity follows takeoff, so it is not an input.
    expect(screen.queryByLabelText(/Quantity of Porcelain/)).toBeNull();
  });

  it('flags unpriced lines and will not issue until they are priced', async () => {
    fake.on('GET', ONE, () =>
      sheet({
        lines: [line({ rate: null, amount: null, pendingMeasurements: 2 })],
        totals: { ...sheet().totals, subtotal: '0.00', missingRates: 1 },
      }),
    );
    renderInProject(<EstimateScreen estimateId="est_1" />);
    expect(await screen.findByText('Some lines are not priced')).toBeTruthy();
    expect(screen.getByText('No rate')).toBeTruthy();
    expect(screen.getByText(/2 marks waiting for acceptance, not counted/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Issue estimate' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('saves a typed rate when the field loses focus', async () => {
    const user = userEvent.setup();
    fake.on('GET', ONE, () =>
      sheet({ lines: [line({ rate: null, amount: null, measurementIds: [] })] }),
    );
    fake.on('PATCH', `${ONE}/lines/{lineId}`, () => sheet());
    renderInProject(<EstimateScreen estimateId="est_1" />);
    const rate = await screen.findByLabelText(/Rate of Porcelain/);
    await user.type(rate, '85.5');
    await user.tab();
    await waitFor(() => expect(fake.callsTo('PATCH', `${ONE}/lines/{lineId}`)).toHaveLength(1));
    expect(fake.callsTo('PATCH', `${ONE}/lines/{lineId}`)[0]!.init.body).toEqual({ rate: '85.5' });
  });

  it('is read-only once issued', async () => {
    fake.on('GET', ONE, () => sheet({ status: 'issued', issuedAt: '2026-10-30T01:00:00Z' }));
    renderInProject(<EstimateScreen estimateId="est_1" />);
    await screen.findByText('Issued. Quantities, rates and the total are frozen.');
    expect(screen.queryByRole('button', { name: 'Issue estimate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add line' })).toBeNull();
  });
});

describe('estimates API source', () => {
  it('sends If-Match on issue and the recalculated sheet comes back', async () => {
    fake.on('POST', `${ONE}/issue`, () => sheet({ status: 'issued' }));
    const issued = await createEstimatesApi('org_1').issue('prj_1', { id: 'est_1', version: 4 });
    expect(issued.status).toBe('issued');
    expect(fake.callsTo('POST', `${ONE}/issue`)[0]!.init.params?.header).toEqual({
      'If-Match': '"4"',
    });
  });

  it('groups accepted measurements by tag and unit, skipping ones already on the sheet', () => {
    const groups = groupForEstimate(
      [
        { id: 'tkm_1', label: 'Tiling: Floor', unit: 'm2' },
        { id: 'tkm_2', label: 'Tiling: Floor', unit: 'm2' },
        { id: 'tkm_3', label: 'Tiling: Floor', unit: 'm' },
        { id: 'tkm_4', label: 'Doors', unit: 'ea' },
      ],
      { lines: [line({ measurementIds: ['tkm_4'] })] } as never,
    );
    expect(groups).toEqual([
      { description: 'Tiling: Floor', measurementIds: ['tkm_1', 'tkm_2'] },
      { description: 'Tiling: Floor', measurementIds: ['tkm_3'] },
    ]);
  });
});
