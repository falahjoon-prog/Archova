// The induction builder against the workforce module's endpoints (Ben's #33), with the same interface as the
// preview source. Writes carry the induction's version as If-Match; the server owns approvals (an approval is
// tied to the section as it was approved and clears when that section changes) and what blocks publishing.

import { unwrap } from '@archova/api-client';
import { api, ensureCsrfToken } from '@/shared/lib/api';
import type { InductionBuilderSource } from './source';

const P = '/v1/orgs/{orgId}/projects/{projectId}/inductions' as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function createInductionBuilderApi(orgId: string): InductionBuilderSource {
  const at = (projectId: string, inductionId: string) => ({ orgId, projectId, inductionId });

  async function get(projectId: string, inductionId: string) {
    return unwrap(
      await api.GET(`${P}/{inductionId}`, { params: { path: at(projectId, inductionId) } }),
    );
  }

  return {
    async list(projectId) {
      const res = unwrap(await api.GET(P, { params: { path: { orgId, projectId } } }));
      return res.data;
    },
    get,
    async create(projectId, input) {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(P, {
          params: { path: { orgId, projectId }, header: idempotencyKey() },
          body: { title: input.title.trim(), validityMonths: input.validityMonths },
        }),
      );
    },
    async update(projectId, induction, patch) {
      await ensureCsrfToken();
      return unwrap(
        await api.PATCH(`${P}/{inductionId}`, {
          params: { path: at(projectId, induction.id), header: ifMatch(induction.version) },
          body: { ...patch, ...(patch.title !== undefined ? { title: patch.title.trim() } : {}) },
        }),
      );
    },
    async saveDraft(projectId, induction, content) {
      await ensureCsrfToken();
      return unwrap(
        await api.PUT(`${P}/{inductionId}/draft`, {
          params: { path: at(projectId, induction.id), header: ifMatch(induction.version) },
          body: { content },
        }),
      );
    },
    async approve(projectId, induction, section) {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${P}/{inductionId}/draft/approvals`, {
          params: { path: at(projectId, induction.id), header: ifMatch(induction.version) },
          body: { section },
        }),
      );
    },
    async publish(projectId, induction, input) {
      await ensureCsrfToken();
      unwrap(
        await api.POST(`${P}/{inductionId}/publish`, {
          params: { path: at(projectId, induction.id), header: ifMatch(induction.version) },
          body: {
            redo: input.redo,
            graceDays: input.graceDays,
            ...(input.changeNote.trim() ? { changeNote: input.changeNote.trim() } : {}),
          },
        }),
      );
      // Publishing answers with the new version; the screen needs the induction with it.
      return get(projectId, induction.id);
    },
    async listLinks(projectId, inductionId) {
      const res = unwrap(
        await api.GET(`${P}/{inductionId}/links`, {
          params: { path: at(projectId, inductionId) },
        }),
      );
      return res.data;
    },
    async createLink(projectId, inductionId, input) {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${P}/{inductionId}/links`, {
          params: { path: at(projectId, inductionId), header: idempotencyKey() },
          body: input,
        }),
      );
    },
    async revokeLink(projectId, inductionId, linkId) {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${P}/{inductionId}/links/{linkId}/revoke`, {
          params: { path: { ...at(projectId, inductionId), linkId } },
        }),
      );
    },
    async register(projectId) {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/projects/{projectId}/induction-register', {
          params: { path: { orgId, projectId } },
        }),
      );
    },
  };
}
