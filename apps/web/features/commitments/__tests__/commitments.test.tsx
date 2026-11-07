// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInProject } from '@/test/render';
import type { Commitment } from '../data/api';
import { rollupCommitments } from '../lib/rollup';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { CommitmentsScreen } = await import('../screens/CommitmentsScreen');

const P = '/v1/orgs/{orgId}/projects/{projectId}';
const c = (over: Partial<Commitment>): Commitment => ({
  id: 'cmt_1',
  number: 1,
  kind: 'subcontract',
  title: 'Concrete supply',
  vendorCompanyId: null,
  status: 'approved',
  total: '1000.50',
  overBudgetOverride: false,
  submittedAt: null,
  decidedAt: null,
  decisionNote: null,
  ...over,
});

beforeEach(() => fake.reset());

describe('rollupCommitments', () => {
  it('counts approved, submitted and draft only', () => {
    const r = rollupCommitments([
      c({ id: 'a', status: 'approved', total: '100.10' }),
      c({ id: 'b', status: 'approved', total: '50.20' }),
      c({ id: 'd', status: 'submitted', total: '40.00' }),
      c({ id: 'e', status: 'draft', total: '10.00' }),
      c({ id: 'f', status: 'void', total: '999.00' }),
      c({ id: 'g', status: 'rejected', total: '999.00' }),
    ]);
    expect(r).toMatchObject({ committed: 15030, pending: 4000, draft: 1000, ifApproved: 19030 });
    expect(r.counts).toEqual({ approved: 2, submitted: 1, draft: 1 });
  });
});

describe('CommitmentsScreen', () => {
  it('shows the totals bar and the list', async () => {
    fake.on('GET', `${P}/commitments`, () => ({
      data: [
        c({}),
        c({ id: 'cmt_2', number: 2, title: 'Crane hire', status: 'submitted', total: '500.00' }),
      ],
    }));
    renderInProject(<CommitmentsScreen />);
    expect(await screen.findByText('Concrete supply')).toBeTruthy();
    expect(screen.getByText('Committed (approved)')).toBeTruthy();
    expect(screen.getByText('Crane hire')).toBeTruthy();
  });

  it('says so when there are none', async () => {
    fake.on('GET', `${P}/commitments`, () => ({ data: [] }));
    renderInProject(<CommitmentsScreen />);
    expect(await screen.findByText('No commitments yet')).toBeTruthy();
  });
});
