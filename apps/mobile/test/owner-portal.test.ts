import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@archova/api-client';
import { mobileRoutes } from '@archova/routes';
import {
  capitalPlan,
  dayText,
  decide,
  listApprovals,
  milestoneText,
  moneyText,
  yearLabel,
} from '../features/owner-portal';

vi.mock('../features/owner-portal/screens/OwnerPortalScreen', () => ({}));

const ok = (data: unknown) => ({ data, response: { ok: true, status: 200 } });
const target = { orgId: 'org_1', projectId: 'prj_1' };

describe('owner portal text', () => {
  it('formats whole cents as dollars', () => {
    expect(moneyText(4_500_000)).toBe('$45,000.00');
    expect(moneyText(5)).toBe('$0.05');
    expect(moneyText(123_456_789)).toBe('$1,234,567.89');
  });
  it('formats a project-local day without zone maths', () => {
    expect(dayText('2026-11-12')).toBe('12 Nov 2026');
  });
  it('describes a milestone in one line', () => {
    expect(milestoneText({ name: 'Level 2 slab', date: '2026-10-20', status: 'done' })).toBe(
      'Level 2 slab, 20 Oct 2026, Done',
    );
    expect(milestoneText({ name: 'Topping out', date: null, status: 'at_risk' })).toBe(
      'Topping out, At risk',
    );
  });
  it('labels years', () => {
    expect(yearLabel(2027)).toBe('FY2027');
    expect(yearLabel(null)).toBe('All years');
  });
  it('has a route', () => {
    expect(mobileRoutes.ownerPortal('prj_1')).toBe('/project/prj_1/owner-portal');
  });
});

describe('owner portal calls', () => {
  it('lists approvals for the project', async () => {
    const GET = vi.fn().mockResolvedValue(ok({ data: [{ id: 'oap_1' }] }));
    expect(await listApprovals({ GET } as unknown as ApiClient, target)).toEqual([{ id: 'oap_1' }]);
    expect(GET).toHaveBeenCalledWith(
      '/v1/orgs/{orgId}/projects/{projectId}/owner-portal/approvals',
      expect.objectContaining({ params: { path: target } }),
    );
  });
  it('reads the capital plan', async () => {
    const GET = vi.fn().mockResolvedValue(ok({ items: [], totals: [] }));
    expect(await capitalPlan({ GET } as unknown as ApiClient, target)).toEqual({
      items: [],
      totals: [],
    });
  });
  it('sends the decision for one approval', async () => {
    const POST = vi.fn().mockResolvedValue(ok({ id: 'oap_1', status: 'approved' }));
    await decide({ POST } as unknown as ApiClient, target, 'oap_1', 'approved');
    const [url, init] = POST.mock.calls[0]!;
    expect(url).toBe(
      '/v1/orgs/{orgId}/projects/{projectId}/owner-portal/approvals/{approvalId}/decision',
    );
    expect(init.params.path.approvalId).toBe('oap_1');
    expect(init.body).toEqual({ decision: 'approved' });
  });
});
