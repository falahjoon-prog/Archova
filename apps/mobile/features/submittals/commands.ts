// Submittals on the phone: list, read the review trail, and respond to the step that is waiting on you (SUB-US*).
// Who may respond is decided by the server; the phone only offers the buttons.
import { unwrap, type ApiClient } from '@archova/api-client';

export interface SubmittalTarget {
  orgId: string;
  projectId: string;
}

const path = (t: SubmittalTarget) => ({ orgId: t.orgId, projectId: t.projectId });

export type SubmittalFilter = 'all' | 'mine';

export async function listSubmittals(
  api: ApiClient,
  t: SubmittalTarget,
  opts: { status?: string; q?: string } = {},
) {
  const query: { limit: number; status?: never; q?: string } & Record<string, unknown> = {
    limit: 50,
  };
  if (opts.status) query.status = opts.status as never;
  if (opts.q?.trim()) query.q = opts.q.trim();
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/submittals', {
      params: { path: path(t), query },
    }),
  ).data;
}

export async function getSubmittal(api: ApiClient, t: SubmittalTarget, submittalId: string) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/submittals/{submittalId}', {
      params: { path: { ...path(t), submittalId } },
    }),
  );
}

export type ReviewAnswer =
  'forwarded' | 'approved' | 'approved_as_noted' | 'revise_resubmit' | 'rejected';

export async function respondToStep(
  api: ApiClient,
  t: SubmittalTarget,
  a: { submittalId: string; stepId: string; response: ReviewAnswer; comments?: string },
) {
  return unwrap(
    await api.POST(
      '/v1/orgs/{orgId}/projects/{projectId}/submittals/{submittalId}/steps/{stepId}/respond',
      {
        params: { path: { ...path(t), submittalId: a.submittalId, stepId: a.stepId } },
        body: {
          response: a.response,
          ...(a.comments?.trim() ? { comments: a.comments.trim() } : {}),
        },
      },
    ),
  );
}
