import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

export type LateSubmission = components['schemas']['LateSubmission'];
export type LateStatus = LateSubmission['status'];
export type LateSubmissionList = components['schemas']['LateSubmissionList'];

const P = '/v1/orgs/{orgId}/projects/{projectId}/late-submissions' as const;
const A =
  '/v1/orgs/{orgId}/projects/{projectId}/late-submissions/{lateSubmissionId}/accept' as const;
const R =
  '/v1/orgs/{orgId}/projects/{projectId}/late-submissions/{lateSubmissionId}/reject' as const;

/** Live API only: held changes exist only on the server. */
export function createLateSubmissionsApi(orgId: string) {
  return {
    async list(projectId: string, status: LateStatus): Promise<LateSubmissionList> {
      return unwrap(
        await api.GET(P, {
          params: { path: { orgId, projectId }, query: { status, limit: 100 } },
        }),
      );
    },
    async accept(projectId: string, id: string): Promise<LateSubmission> {
      return unwrap(
        await api.POST(A, {
          params: { path: { orgId, projectId, lateSubmissionId: id } },
        }),
      );
    },
    async reject(projectId: string, id: string, note?: string): Promise<LateSubmission> {
      return unwrap(
        await api.POST(R, {
          params: { path: { orgId, projectId, lateSubmissionId: id } },
          body: note ? { note } : {},
        }),
      );
    },
  };
}
