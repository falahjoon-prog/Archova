import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api, ensureCsrfToken } from '@/shared/lib/api';
import { uploadFile } from '@/shared/lib/uploads';
import type { HazardPattern, HazardSignal } from '../lib/types';
import type { HazardSignalSource } from './source';

type ApiSignal = components['schemas']['HazardSignal'];
type ApiPattern = components['schemas']['HazardPattern'];

const toSignal = (s: ApiSignal): HazardSignal => ({
  id: s.id,
  fileId: s.fileId,
  category: s.category,
  categoryLabel: s.categoryLabel,
  observation: s.observation,
  confidence: s.confidence,
  status: s.status,
  reviewNote: s.reviewNote,
  reviewedAt: s.reviewedAt,
  createdAt: s.createdAt,
});

const toPattern = (p: ApiPattern): HazardPattern => ({ ...p });

export function createHazardSignalsApi(orgId: string): HazardSignalSource {
  return {
    async scan(projectId, { photo, note }) {
      const stored = await uploadFile(orgId, { file: photo, projectId, module: 'safety' });
      await ensureCsrfToken();
      const r = unwrap(
        await api.POST('/v1/orgs/{orgId}/projects/{projectId}/ai/safety/photo-scans', {
          params: { path: { orgId, projectId } },
          body: { photo: { fileId: stored.id }, ...(note.trim() ? { note: note.trim() } : {}) },
        }),
      );
      return {
        signals: r.signals.map(toSignal),
        photoUnclear: r.photoUnclear,
        dropped: r.dropped,
        unsupportedNumbers: r.unsupportedNumbers,
        disclaimer: r.disclaimer,
      };
    },
    async list(projectId, status) {
      const r = unwrap(
        await api.GET('/v1/orgs/{orgId}/projects/{projectId}/ai/safety/hazard-signals', {
          params: { path: { orgId, projectId }, query: { status, limit: 100 } },
        }),
      );
      return r.data.map(toSignal);
    },
    async review(projectId, id, input) {
      await ensureCsrfToken();
      return toSignal(
        unwrap(
          await api.POST(
            '/v1/orgs/{orgId}/projects/{projectId}/ai/safety/hazard-signals/{signalId}/review',
            {
              params: { path: { orgId, projectId, signalId: id } },
              body: { decision: input.decision, ...(input.note ? { note: input.note } : {}) },
            },
          ),
        ),
      );
    },
    async patterns(projectId, days) {
      const r = unwrap(
        await api.GET('/v1/orgs/{orgId}/projects/{projectId}/ai/safety/hazard-patterns', {
          params: { path: { orgId, projectId }, query: { days } },
        }),
      );
      return r.data.map(toPattern);
    },
  };
}
