// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', async () => {
  const { createQueries } = await import('@archova/query');
  return { ...fake.module, queries: createQueries(fake.module.api as never) };
});
vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

const { PlantScreen } = await import('../screens/PlantScreen');

const P = '/v1/orgs/{orgId}/plant';
const asset = {
  id: 'pla_1',
  name: '20t excavator',
  assetNumber: 'EX-20',
  category: 'excavator',
  ownership: 'hired',
  supplier: 'Coates',
  make: null,
  model: null,
  serialNumber: null,
  dailyRateCents: 45000,
  status: 'active',
  notes: null,
  contractorName: 'Hunter Plant Services',
  contractorEmail: 'service@hunterplant.example',
  version: 1,
};

beforeEach(() => {
  fake.reset();
  fake.on('GET', `${P}/assets`, () => ({ data: [asset] }));
  fake.on('GET', `${P}/allocations`, () => ({
    data: [
      {
        id: 'pal_1',
        assetId: 'pla_1',
        projectId: 'prj_1',
        costCodeId: null,
        startsOn: '2026-11-10',
        endsOn: '2026-11-12',
        note: null,
        status: 'active',
        postedThrough: null,
        estimatedCostCents: 135000,
      },
    ],
  }));
  fake.on('GET', `${P}/maintenance-plans`, () => ({
    data: [
      {
        id: 'ppn_1',
        assetId: 'pla_1',
        title: '500 hour service',
        kind: 'service',
        intervalDays: 90,
        nextDueOn: '2026-11-01',
        lastDoneOn: null,
        responsible: null,
        active: true,
        state: 'overdue',
      },
    ],
  }));
  fake.on('GET', `${P}/flags`, () => ({
    data: [
      {
        code: 'maintenance_overdue',
        severity: 'critical',
        assetId: 'pla_1',
        subjectId: 'ppn_1',
        message: '20t excavator (EX-20): 500 hour service 6 days overdue.',
        date: '2026-11-01',
      },
    ],
  }));
  fake.on('GET', `${P}/contractor-notices`, () => ({ data: [] }));
  fake.on('GET', `${P}/utilisation`, () => ({
    from: '2026-10-08',
    to: '2026-11-07',
    days: 31,
    fleetPct: 40,
    assets: [
      {
        assetId: 'pla_1',
        bookedDays: 12,
        idleDays: 19,
        pct: 39,
        costCents: 540000,
        idleCostCents: 855000,
      },
    ],
    projects: [{ projectId: 'prj_1', bookedDays: 12, costCents: 540000 }],
  }));
  fake.on('GET', '/v1/orgs/{orgId}/projects/{projectId}/cost-codes', () => ({
    data: [
      { id: 'ccd_1', code: '3100', description: 'Plant hire', parentId: null, archived: false },
    ],
  }));
  fake.on('GET', '/v1/orgs/{orgId}/projects', () => ({
    data: [{ id: 'prj_1', name: 'Harbour St Tower' }],
  }));
});

describe('PlantScreen', () => {
  it('leads with Nova flags and the fleet figures', async () => {
    renderInProject(<PlantScreen />);
    expect(await screen.findByText(/500 hour service 6 days overdue/)).toBeTruthy();
    expect(screen.getByText('Needs attention')).toBeTruthy();
  });

  it('lists the fleet and the allocations with their project and cost', async () => {
    const user = userEvent.setup();
    renderInProject(<PlantScreen />);
    await user.click(await screen.findByRole('tab', { name: /Fleet/ }));
    expect(await screen.findByText('Hired from Coates')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: /Allocations/ }));
    expect((await screen.findAllByText('Harbour St Tower')).length).toBeGreaterThan(1);
    expect(screen.getByRole('button', { name: /Cancel allocation of 20t excavator/ })).toBeTruthy();
  });

  it('shows idle cost on the utilisation tab', async () => {
    const user = userEvent.setup();
    renderInProject(<PlantScreen />);
    await user.click(await screen.findByRole('tab', { name: /Utilisation/ }));
    expect(await screen.findByText('39%')).toBeTruthy();
  });

  it('sends a flagged job to the contractor with an optional note', async () => {
    const user = userEvent.setup();
    let body: unknown = null;
    fake.on('POST', `${P}/assets/{assetId}/contractor-notices`, (req: { body?: unknown }) => {
      body = req.body;
      return { id: 'pcn_1' };
    });
    renderInProject(<PlantScreen />);
    await user.click(await screen.findByRole('button', { name: 'Notify contractor' }));
    expect(screen.getByText(/don.t need an Archova account/)).toBeTruthy();
    await user.type(screen.getByLabelText(/Note/), 'Please book before Friday');
    await user.click(screen.getByRole('button', { name: 'Send to contractor' }));
    await vi.waitFor(() =>
      expect(body).toMatchObject({ planId: 'ppn_1', message: 'Please book before Friday' }),
    );
  });

  it('asks for a contractor email when the machine has none', async () => {
    fake.on('GET', `${P}/assets`, () => ({
      data: [{ ...asset, contractorEmail: null, contractorName: null }],
    }));
    renderInProject(<PlantScreen />);
    expect(await screen.findByText(/Add a contractor email to 20t excavator/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Notify contractor' })).toBeNull();
  });
});
