import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api, ensureCsrfToken } from '@/shared/lib/api';
import { uploadFile } from '@/shared/lib/uploads';

export type SiteCapture = components['schemas']['SiteCapture'];
export type NewSiteCapture = components['schemas']['CreateSiteCaptureRequest'];
export type CaptureObservation = components['schemas']['CaptureObservation'];
export type NovaCaptureScan = components['schemas']['NovaCaptureScan'];
export type ObservationStatus = components['schemas']['HazardSignalStatus'];
export type RfiOption = { id: string; label: string };
export type RaisedIssue = { id: string; number: number };

/** What Nova can read: the same limits as other photos Nova looks at. */
export const STILL_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const STILL_MAX_BYTES = 3 * 1024 * 1024;

const C = '/v1/orgs/{orgId}/projects/{projectId}/site-captures' as const;
const CI = '/v1/orgs/{orgId}/projects/{projectId}/site-captures/{captureId}' as const;
const SCAN = '/v1/orgs/{orgId}/projects/{projectId}/ai/captures/view-scans' as const;
const OBS = '/v1/orgs/{orgId}/projects/{projectId}/ai/captures/observations' as const;
const REVIEW =
  '/v1/orgs/{orgId}/projects/{projectId}/ai/captures/observations/{observationId}/review' as const;

/** Live API only: site capture has no preview store. */
export function createSiteCaptureApi(orgId: string) {
  return {
    async list(projectId: string): Promise<SiteCapture[]> {
      return unwrap(await api.GET(C, { params: { path: { orgId, projectId } } })).data;
    },
    async create(projectId: string, body: NewSiteCapture): Promise<SiteCapture> {
      return unwrap(
        await api.POST(C, {
          params: {
            path: { orgId, projectId },
            header: { 'Idempotency-Key': crypto.randomUUID() },
          },
          body,
        }),
      );
    },
    /** `version` is the capture's version as last read; a stale one is refused. */
    async update(
      projectId: string,
      captureId: string,
      version: number,
      body: components['schemas']['UpdateSiteCaptureRequest'],
    ): Promise<SiteCapture> {
      return unwrap(
        await api.PATCH(CI, {
          params: { path: { orgId, projectId, captureId }, header: { 'If-Match': `"${version}"` } },
          body,
        }),
      );
    },
    async remove(projectId: string, captureId: string): Promise<void> {
      unwrap(await api.DELETE(CI, { params: { path: { orgId, projectId, captureId } } }));
    },
    async listRfis(projectId: string): Promise<RfiOption[]> {
      const page = unwrap(
        await api.GET('/v1/orgs/{orgId}/projects/{projectId}/rfis', {
          params: { path: { orgId, projectId }, query: { limit: 100 } },
        }),
      );
      return page.data.map((r) => ({ id: r.id, label: `${r.numberLabel} ${r.subject}` }));
    },
    /** Stores the still in the project, then has Nova read it. Nova sees the still, never the live tour. */
    async scanStill(projectId: string, input: { still: File; note: string }) {
      const stored = await uploadFile(orgId, { file: input.still, projectId, module: 'bim' });
      await ensureCsrfToken();
      return unwrap(
        await api.POST(SCAN, {
          params: { path: { orgId, projectId } },
          body: {
            still: { fileId: stored.id },
            ...(input.note.trim() ? { note: input.note.trim() } : {}),
          },
        }),
      );
    },
    async observations(
      projectId: string,
      status?: ObservationStatus,
    ): Promise<CaptureObservation[]> {
      return unwrap(
        await api.GET(OBS, {
          params: {
            path: { orgId, projectId },
            query: { limit: 100, ...(status ? { status } : {}) },
          },
        }),
      ).data;
    },
    async review(
      projectId: string,
      observationId: string,
      decision: 'confirmed' | 'dismissed',
      note?: string,
    ): Promise<CaptureObservation> {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(REVIEW, {
          params: { path: { orgId, projectId, observationId } },
          body: { decision, ...(note?.trim() ? { note: note.trim() } : {}) },
        }),
      );
    },
    /** Raises a coordination issue from something a person confirmed, and links the capture to it. */
    async raiseIssue(
      projectId: string,
      input: { title: string; description: string; location: string },
    ): Promise<RaisedIssue> {
      const d = unwrap(
        await api.POST('/v1/orgs/{orgId}/projects/{projectId}/coordination-issues', {
          params: {
            path: { orgId, projectId },
            header: { 'Idempotency-Key': crypto.randomUUID() },
          },
          body: input,
        }),
      );
      return { id: d.issue.id, number: d.issue.number };
    },
  };
}
