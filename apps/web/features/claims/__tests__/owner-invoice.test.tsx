// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { OwnerInvoicesPanel, backupSummary, totalWithMarkup } =
  await import('../components/OwnerInvoicesPanel');

const P = '/v1/orgs/{orgId}/projects/{projectId}';
const ok = { kind: 'claim_pdf', status: 'attached', detail: null } as const;
const candidate = (over: Record<string, unknown> = {}) => ({
  claimId: 'pcl_1',
  contractId: 'cnt_2',
  contractTitle: 'Electrical',
  number: 1,
  periodEnd: '2026-09-30',
  status: 'scheduled',
  thisPeriod: '20000.00',
  completedToDate: '20000.00',
  amount: '19000.00',
  withheld: '0.00',
  flags: [],
  backup: [ok, { kind: 'payment_schedule_pdf', status: 'missing', detail: null }],
  ...over,
});
const invoice = {
  id: 'oiv_1',
  contractId: 'cnt_1',
  number: 1,
  periodEnd: '2026-09-30',
  markupPct: '10.00',
  subTotal: '19000.00',
  markupAmount: '1900.00',
  total: '20900.00',
  note: null,
  createdAt: '2026-11-07T00:00:00Z',
};

beforeEach(() => {
  fake.reset();
  fake.on('GET', `${P}/contracts/{contractId}/owner-invoices`, () => ({ data: [] }));
});

describe('owner invoice helpers', () => {
  it('summarises missing backup and adds markup to the cent', () => {
    expect(backupSummary([ok])).toBe('Backup complete');
    expect(backupSummary(candidate().backup as Parameters<typeof backupSummary>[0])).toBe(
      'Backup missing: Payment schedule',
    );
    expect(totalWithMarkup(['100.05'], '12.5')).toBe('112.56');
    expect(totalWithMarkup(['100.00'], 'x')).toBeNull();
  });
});

describe('OwnerInvoicesPanel', () => {
  it('holds a Nova-flagged claim until it is ticked and confirmed, then creates the draft', async () => {
    fake.on('GET', `${P}/contracts/{contractId}/owner-invoice-prefill`, () => ({
      periodEnd: '2026-10-31',
      candidates: [
        candidate(),
        candidate({
          claimId: 'pcl_2',
          number: 2,
          flags: [{ code: 'duplicate', message: 'Possible duplicate of claim 1.' }],
        }),
      ],
    }));
    const create = vi.fn((_req: unknown) => ({
      invoice,
      lines: [],
      missingBackup: 0,
    }));
    fake.on('POST', `${P}/contracts/{contractId}/owner-invoices`, (req: unknown) => create(req));
    const user = userEvent.setup();
    renderInProject(<OwnerInvoicesPanel contractId="cnt_1" canManage />);
    await user.click(await screen.findByRole('button', { name: 'Pre-fill owner invoice' }));
    expect(await screen.findByText('Do you want to pre-fill the owner invoice?')).toBeTruthy();
    expect(await screen.findByText(/Nova flagged some claims/)).toBeTruthy();

    // The unflagged claim is ticked; the flagged one starts out and stays out until confirmed.
    const boxes = await screen.findAllByRole('checkbox');
    expect((boxes[0] as HTMLInputElement).checked).toBe(true);
    expect((boxes[1] as HTMLInputElement).checked).toBe(false);
    await user.click(boxes[1]!);
    expect(await screen.findByText('Possible duplicate of claim 1.')).toBeTruthy();
    const make = screen.getByRole('button', { name: 'Create draft' }) as HTMLButtonElement;
    expect(make.disabled).toBe(true);
    await user.click(screen.getByLabelText(/I've checked this/));
    expect(make.disabled).toBe(false);
    await user.click(make);
    await waitFor(() => expect(create).toHaveBeenCalled());
    const sent = (create.mock.calls[0]![0] as { body: Record<string, unknown> }).body;
    expect(sent).toMatchObject({
      claimIds: ['pcl_1', 'pcl_2'],
      confirmedClaimIds: ['pcl_2'],
    });
  });

  it('hides the pre-fill button from people who cannot record claims', async () => {
    renderInProject(<OwnerInvoicesPanel contractId="cnt_1" canManage={false} />);
    expect(await screen.findByText('No owner invoice drafts')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pre-fill owner invoice' })).toBeNull();
  });
});
