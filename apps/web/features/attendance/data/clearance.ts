import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';
import { delay } from '@/shared/mocks/runtime';

export type WorkerClearance = components['schemas']['WorkerClearance'];

export interface ClearanceSource {
  check(projectId: string, code: string): Promise<WorkerClearance>;
}

export function createClearanceApi(orgId: string): ClearanceSource {
  return {
    async check(projectId, code) {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/projects/{projectId}/attendance/clearance', {
          params: { path: { orgId, projectId }, query: { code } },
        }),
      );
    },
  };
}

export const clearancePreview: ClearanceSource = {
  check: (_projectId, code) =>
    delay({
      workerId: code.replace('archova:badge:', ''),
      fullName: 'Sam Nguyen',
      kind: 'worker',
      companyName: 'Northside Electrical',
      photoUrl: null,
      siteId: null,
      localDate: '2026-11-07',
      checkedAt: '2026-11-07T07:00:00.000Z',
      result: 'blocked',
      checks: [
        { key: 'worker', label: 'Worker record', status: 'pass', detail: 'Active' },
        { key: 'white_card', label: 'White card', status: 'pass', detail: 'Current' },
        {
          key: 'licences',
          label: 'Licences and cards',
          status: 'warn',
          detail: 'Trade licence expires 2026-11-20',
        },
        {
          key: 'induction',
          label: 'Site induction',
          status: 'fail',
          detail: 'Not completed for this project',
        },
        { key: 'swms', label: 'SWMS sign-off', status: 'pass', detail: 'Read and acknowledged' },
        {
          key: 'insurance',
          label: 'Company insurance',
          status: 'pass',
          detail: 'Certificates and bonds in date',
        },
      ],
      flag: {
        severity: 'blocking',
        title: 'Site induction: Not completed for this project (1 more)',
        detail:
          'Site induction: Not completed for this project. Licences and cards: Trade licence expires 2026-11-20',
        suggestedAction: 'Send them the site induction link and hold entry until it is signed.',
      },
    }),
};
