// Replays a queued action through the typed client: the same endpoints the online screens call.
import { unwrap, type ApiClient } from '@archova/api-client';
import type { ActionSender } from './action-queue';

export function createActionSender(api: ApiClient, orgId: string): ActionSender {
  return async (a) => {
    const base = { orgId, projectId: a.projectId };
    const p = a.payload;
    switch (a.kind) {
      case 'submittal.respond':
        unwrap(
          await api.POST(
            '/v1/orgs/{orgId}/projects/{projectId}/submittals/{submittalId}/steps/{stepId}/respond',
            {
              params: { path: { ...base, submittalId: a.targetId, stepId: String(p.stepId) } },
              body: {
                response: p.response as 'approved',
                ...(typeof p.comments === 'string' && p.comments ? { comments: p.comments } : {}),
              },
            },
          ),
        );
        return;
      case 'timesheet.submit':
        unwrap(
          await api.POST('/v1/orgs/{orgId}/projects/{projectId}/timesheets/{timesheetId}/submit', {
            params: { path: { ...base, timesheetId: a.targetId } },
          }),
        );
        return;
      case 'timesheet.approve':
        unwrap(
          await api.POST('/v1/orgs/{orgId}/projects/{projectId}/timesheets/{timesheetId}/approve', {
            params: { path: { ...base, timesheetId: a.targetId } },
          }),
        );
        return;
      case 'timesheet.reject':
        unwrap(
          await api.POST('/v1/orgs/{orgId}/projects/{projectId}/timesheets/{timesheetId}/reject', {
            params: { path: { ...base, timesheetId: a.targetId } },
            body: { reason: String(p.reason ?? '') },
          }),
        );
        return;
    }
  };
}
