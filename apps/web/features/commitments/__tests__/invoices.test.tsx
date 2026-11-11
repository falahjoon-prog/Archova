// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInProject } from '@/test/render';
import type { CommitmentInvoice } from '../data/api';
import { invoicesToCsv } from '../lib/invoicesCsv';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { CommitmentDetailScreen } = await import('../screens/CommitmentDetailScreen');

const P = '/v1/orgs/{orgId}/projects/{projectId}';
const detail = (contractId: string | null) => ({
  commitment: {
    id: 'cmt_1',
    number: 1,
    kind: 'subcontract',
    title: 'Electrical',
    vendorCompanyId: null,
    contractId,
    status: 'approved',
    total: '100000.00',
    overBudgetOverride: false,
    submittedAt: null,
    decidedAt: null,
    decisionNote: null,
  },
  lines: [],
});
const row: CommitmentInvoice = {
  claimId: 'pcl_1',
  number: 1,
  periodStart: null,
  periodEnd: '2026-10-31',
  receivedAt: '2026-11-01T00:00:00.000Z',
  status: 'submitted',
  thisPeriod: '10000.00',
  completedToDate: '10000.00',
  retainage: '500.00',
  earnedLessRetainage: '9500.00',
  payable: '9500.00',
  paid: '0.00',
  paymentDue: '9500.00',
  paymentDueOn: null,
  balanceToFinish: '90000.00',
  percentComplete: '10.00',
};

beforeEach(() => fake.reset());

describe('invoicesToCsv', () => {
  it('writes a header and one line per invoice, quoting and guarding formulas', () => {
    const csv = invoicesToCsv([row, { ...row, number: 2, status: '=cmd' }]);
    const lines = csv.replace('﻿', '').trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^Invoice #,Period start/);
    expect(lines[1]).toBe(
      '1,,2026-10-31,2026-11-01,submitted,10000.00,10000.00,500.00,9500.00,9500.00,0.00,9500.00,,90000.00,10.00',
    );
    expect(lines[2]).toContain("'=cmd");
  });
});

describe('CommitmentDetailScreen invoices', () => {
  it('asks for a contract when none is linked', async () => {
    fake.on('GET', `${P}/commitments/{commitmentId}`, () => detail(null));
    fake.on('GET', `${P}/commitments/{commitmentId}/invoices`, () => ({
      linked: false,
      contractId: null,
      summary: null,
    }));
    fake.on('GET', `${P}/contracts`, () => ({ data: [] }));
    renderInProject(<CommitmentDetailScreen commitmentId="cmt_1" />);
    expect(await screen.findByText('No contract linked')).toBeTruthy();
  });

  it('lists the linked contract’s invoices with totals', async () => {
    fake.on('GET', `${P}/commitments/{commitmentId}`, () => detail('cnt_1'));
    fake.on('GET', `${P}/commitments/{commitmentId}/invoices`, () => ({
      linked: true,
      contractId: 'cnt_1',
      summary: {
        originalSum: '100000.00',
        netChange: '0.00',
        revisedSum: '100000.00',
        invoiced: '10000.00',
        retainage: '500.00',
        paid: '0.00',
        remaining: '9500.00',
        percentPaid: '0.00',
        rows: [row],
      },
    }));
    fake.on('GET', `${P}/contracts`, () => ({ data: [] }));
    renderInProject(<CommitmentDetailScreen commitmentId="cmt_1" />);
    expect(await screen.findByText('Revised contract sum')).toBeTruthy();
    expect(screen.getByText('10.00%')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Lines/ }));
  });
});
