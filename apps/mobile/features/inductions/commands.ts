// Online induction calls (workforce IND-US1). The induction needs a connection; credential photos upload via files.
import { unwrap, type ApiClient } from '@archova/api-client';

export interface InductionTarget {
  orgId: string;
  projectId: string;
}

const base = '/v1/orgs/{orgId}/projects/{projectId}/induction-completions' as const;
const at = (t: InductionTarget, completionId: string) => ({
  path: { orgId: t.orgId, projectId: t.projectId, completionId },
});

/** Starts, or picks up again, the current induction. `siteId` is optional for single-site projects. */
export async function startInduction(
  api: ApiClient,
  t: InductionTarget,
  input: { idempotencyKey: string; siteId?: string },
) {
  return unwrap(
    await api.POST(base, {
      params: {
        path: { orgId: t.orgId, projectId: t.projectId },
        header: { 'Idempotency-Key': input.idempotencyKey },
      },
      body: input.siteId ? { siteId: input.siteId } : {},
    }),
  );
}

/** A short-lived link to a file this induction uses; fetch a fresh one each time it is shown. */
export async function getInductionFile(
  api: ApiClient,
  t: InductionTarget,
  completionId: string,
  fileId: string,
) {
  return unwrap(
    await api.GET(`${base}/{completionId}/files/{fileId}/download`, {
      params: { path: { orgId: t.orgId, projectId: t.projectId, completionId, fileId } },
    }),
  );
}

/** A short-lived link to the current revision of a SWMS the induction names, with its title and revision. */
export async function getInductionSwms(
  api: ApiClient,
  t: InductionTarget,
  completionId: string,
  documentId: string,
) {
  return unwrap(
    await api.GET(`${base}/{completionId}/swms/{documentId}/download`, {
      params: { path: { orgId: t.orgId, projectId: t.projectId, completionId, documentId } },
    }),
  );
}

export async function recordSectionSeen(
  api: ApiClient,
  t: InductionTarget,
  completionId: string,
  input: { section: number; seconds: number },
) {
  return unwrap(
    await api.POST(`${base}/{completionId}/progress`, {
      params: at(t, completionId),
      body: input,
    }),
  );
}

export async function submitQuiz(
  api: ApiClient,
  t: InductionTarget,
  completionId: string,
  answers: { questionId: string; answerIndex: number }[],
) {
  return unwrap(
    await api.POST(`${base}/{completionId}/quiz-attempts`, {
      params: at(t, completionId),
      body: { answers },
    }),
  );
}

export async function signInduction(
  api: ApiClient,
  t: InductionTarget,
  completionId: string,
  input: {
    typedName: string;
    signaturePath: string;
    /** Both are the worker's own ticks on the declaration; the server refuses unless true. */
    fitForWork: boolean;
    agreed: boolean;
    clientAt: string;
  },
) {
  return unwrap(
    await api.POST(`${base}/{completionId}/sign`, {
      params: at(t, completionId),
      body: {
        typedName: input.typedName,
        signature: { format: 'svg', data: input.signaturePath },
        fitForWork: input.fitForWork,
        agreed: input.agreed,
        clientAt: input.clientAt,
      },
    }),
  );
}

export async function getInductionCompletion(
  api: ApiClient,
  t: InductionTarget,
  completionId: string,
) {
  return unwrap(await api.GET(`${base}/{completionId}`, { params: at(t, completionId) }));
}
