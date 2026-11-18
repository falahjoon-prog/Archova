import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@archova/api-client';
import { mobileRoutes } from '@archova/routes';
import { expiryText, permitSubtitle, startRenewal } from '../features/permits';
import {
  carbonText,
  conditionSubtitle,
  percentText,
  startCondition,
  tonnesText,
} from '../features/environment';

vi.mock('../features/permits/screens/PermitsScreen', () => ({}));
vi.mock('../features/permits/screens/PermitScreen', () => ({}));
vi.mock('../features/environment/screens/EnvironmentScreen', () => ({}));

const target = { orgId: 'org_1', projectId: 'prj_1' };
const ok = (data: unknown) => ({ data, response: { ok: true } });

describe('permit text', () => {
  it('says how long is left', () => {
    expect(expiryText(null)).toBe('No expiry date');
    expect(expiryText(0)).toBe('Expires today');
    expect(expiryText(1)).toBe('Expires in 1 day');
    expect(expiryText(12)).toBe('Expires in 12 days');
    expect(expiryText(-3)).toBe('Expired 3 days ago');
  });
  it('summarises a register row, without expiry once closed', () => {
    const p = {
      numberLabel: 'PMT-0004',
      kind: 'hot_work',
      status: 'expiring_soon',
      daysToExpiry: 5,
    };
    expect(permitSubtitle({ ...p, lifecycle: 'active' })).toBe(
      'PMT-0004, Hot work, Expiring soon. Expires in 5 days',
    );
    expect(permitSubtitle({ ...p, status: 'closed', lifecycle: 'closed' })).toBe(
      'PMT-0004, Hot work, Closed',
    );
  });
});

describe('environment text', () => {
  it('formats the numbers', () => {
    expect(percentText(null)).toBe('No data yet');
    expect(percentText(82)).toBe('82%');
    expect(tonnesText(12.34)).toBe('12.3 t');
    expect(carbonText(640)).toBe('640 kg CO2e');
    expect(carbonText(2450)).toBe('2.5 t CO2e');
  });
  it('summarises a condition row', () => {
    expect(
      conditionSubtitle({
        numberLabel: 'EMC-0003',
        category: 'waste',
        status: 'in_progress',
        isOverdue: true,
      }),
    ).toBe('EMC-0003, Waste, In progress, overdue');
  });
});

describe('routes', () => {
  it('has routes for permits and environment', () => {
    expect(mobileRoutes.permits('prj_1')).toBe('/project/prj_1/permits');
    expect(mobileRoutes.permit('prj_1', 'pmt_2')).toBe('/project/prj_1/permits/pmt_2');
    expect(mobileRoutes.environment('prj_1')).toBe('/project/prj_1/environment');
  });
});

describe('calls', () => {
  it('starts a renewal against the version that was read', async () => {
    const POST = vi.fn().mockResolvedValue(ok({ permit: {}, events: [] }));
    await startRenewal({ POST } as unknown as ApiClient, target, { id: 'pmt_1', version: 2 });
    const [, init] = POST.mock.calls[0]!;
    expect(init.params.header).toEqual({ 'If-Match': '"2"' });
    expect(init.params.path.permitId).toBe('pmt_1');
    expect(init.body).toEqual({ action: 'startRenewal' });
  });
  it('starts a condition against the version that was read', async () => {
    const POST = vi.fn().mockResolvedValue(ok({}));
    await startCondition({ POST } as unknown as ApiClient, target, { id: 'emc_1', version: 5 });
    const [, init] = POST.mock.calls[0]!;
    expect(init.params.header).toEqual({ 'If-Match': '"5"' });
    expect(init.params.path.conditionId).toBe('emc_1');
    expect(init.body).toEqual({ action: 'start' });
  });
});
