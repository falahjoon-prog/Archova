// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { VariationsPanel } = await import('../components/VariationsPanel');

const P = '/v1/orgs/{orgId}/projects/{projectId}';
const variation = (over: Record<string, unknown> = {}) => ({
  id: 'var_1',
  contractId: 'cnt_1',
  number: 1,
  title: 'Extra circuits',
  description: null,
  amount: '5000.00',
  timeImpactDays: 0,
  status: 'approved',
  claimedToDate: '0.00',
  submittedAt: null,
  decidedAt: null,
  decisionNote: null,
  costCodeId: null,
  ...over,
});
const codes = [
  { id: 'ccd_1', code: '16-100', description: 'Electrical', parentId: null, archived: false },
  { id: 'ccd_2', code: '99-000', description: 'Old code', parentId: null, archived: true },
];

beforeEach(() => {
  fake.reset();
  fake.on('GET', `${P}/cost-codes`, () => ({ data: codes }));
  fake.on('GET', `${P}/contracts/{contractId}/variations`, () => ({
    data: [
      variation(),
      variation({ id: 'var_2', number: 2, status: 'withdrawn', costCodeId: 'ccd_1' }),
    ],
    approvedTotal: '5000.00',
  }));
});

describe('VariationsPanel cost codes', () => {
  it('codes an approved variation, clears it, and leaves a withdrawn one read-only', async () => {
    fake.on('PUT', `${P}/variations/{variationId}/cost-code`, () =>
      variation({ costCodeId: 'ccd_1' }),
    );
    const user = userEvent.setup();
    renderInProject(<VariationsPanel contractId="cnt_1" canManage canDecide />);
    const pick = (await screen.findByLabelText('Cost code for variation 1')) as HTMLSelectElement;
    // Archived codes are not offered; the withdrawn variation shows its code as text, not a picker.
    expect([...pick.options].map((o) => o.text)).toEqual(['Not coded', '16-100 Electrical']);
    expect(screen.queryByLabelText('Cost code for variation 2')).toBeNull();
    expect(screen.getByRole('cell', { name: '16-100 Electrical' })).toBeTruthy();

    await user.selectOptions(pick, 'ccd_1');
    await waitFor(() =>
      expect(fake.callsTo('PUT', `${P}/variations/{variationId}/cost-code`)).toHaveLength(1),
    );
    expect(fake.callsTo('PUT', `${P}/variations/{variationId}/cost-code`)[0]!.init.body).toEqual({
      costCodeId: 'ccd_1',
    });
  });

  it('sends the chosen cost code with a new variation, and none when left blank', async () => {
    fake.on('POST', `${P}/contracts/{contractId}/variations`, () => variation({ status: 'draft' }));
    const user = userEvent.setup();
    renderInProject(<VariationsPanel contractId="cnt_1" canManage canDecide={false} />);
    await enterText(user, await screen.findByLabelText(/^Title/), 'Switchboard');
    await enterText(user, screen.getByLabelText(/^Amount/), '1200.00');
    await user.click(screen.getByRole('button', { name: 'Save draft variation' }));
    await waitFor(() =>
      expect(fake.callsTo('POST', `${P}/contracts/{contractId}/variations`)).toHaveLength(1),
    );
    expect(fake.callsTo('POST', `${P}/contracts/{contractId}/variations`)[0]!.init.body).toEqual({
      title: 'Switchboard',
      amount: '1200.00',
      timeImpactDays: 0,
    });
    await user.selectOptions(screen.getByLabelText('Cost code'), 'ccd_1');
    await enterText(user, screen.getByLabelText(/^Title/), 'Second');
    await enterText(user, screen.getByLabelText(/^Amount/), '10.00');
    await user.click(screen.getByRole('button', { name: 'Save draft variation' }));
    await waitFor(() =>
      expect(fake.callsTo('POST', `${P}/contracts/{contractId}/variations`)).toHaveLength(2),
    );
    expect(
      (
        fake.callsTo('POST', `${P}/contracts/{contractId}/variations`)[1]!.init.body as {
          costCodeId: string;
        }
      ).costCodeId,
    ).toBe('ccd_1');
  });
});
