// Transmittals against the documents module (product 02, DOC-AC10–AC12). A sent transmittal can't change, so the
// screen only creates drafts and sends them; the receipts come back on the same detail.

import { ApiError, unwrap } from '@archova/api-client';
import { api } from '@/shared/lib/api';
import { allPages } from '@/shared/lib/data-mode';
import type {
  CreateTransmittal,
  Sendable,
  Transmittal,
  TransmittalAccess,
  TransmittalDetail,
} from '../lib/types';

const P = '/v1/orgs/{orgId}/projects/{projectId}/transmittals' as const;

export function createTransmittalsApi(orgId: string) {
  return {
    list(projectId: string): Promise<Transmittal[]> {
      return allPages(async (cursor) =>
        unwrap(
          await api.GET(P, {
            params: {
              path: { orgId, projectId },
              query: { limit: 100, ...(cursor ? { cursor } : {}) },
            },
          }),
        ),
      );
    },
    /** The current revision of every drawing and document, to choose from. */
    async listSendable(projectId: string): Promise<Sendable[]> {
      const [sheets, docs] = await Promise.all([
        allPages(async (cursor) =>
          unwrap(
            await api.GET('/v1/orgs/{orgId}/projects/{projectId}/drawings', {
              params: {
                path: { orgId, projectId },
                query: { limit: 200, ...(cursor ? { cursor } : {}) },
              },
            }),
          ),
        ),
        allPages(async (cursor) =>
          unwrap(
            await api.GET('/v1/orgs/{orgId}/projects/{projectId}/documents', {
              params: {
                path: { orgId, projectId },
                query: { limit: 200, ...(cursor ? { cursor } : {}) },
              },
            }),
          ),
        ),
      ]);
      const drawings: Sendable[] = sheets.flatMap((s) =>
        s.currentRevision
          ? [
              {
                revisionType: 'drawing' as const,
                revisionId: s.currentRevision.id,
                number: s.sheetNumber,
                title: s.title,
                rev: s.currentRevision.rev,
                discipline: s.discipline,
              },
            ]
          : [],
      );
      const documents: Sendable[] = docs.flatMap((d) =>
        d.currentRevision
          ? [
              {
                revisionType: 'document' as const,
                revisionId: d.currentRevision.id,
                number: d.docNumber,
                title: d.title,
                rev: d.currentRevision.rev,
                discipline: null,
              },
            ]
          : [],
      );
      const byNumber = (a: Sendable, b: Sendable) =>
        (a.number ?? a.title).localeCompare(b.number ?? b.title, 'en-AU', { numeric: true });
      return [...drawings.sort(byNumber), ...documents.sort(byNumber)];
    },
    async get(projectId: string, transmittalId: string): Promise<TransmittalDetail> {
      return unwrap(
        await api.GET(`${P}/{transmittalId}`, {
          params: { path: { orgId, projectId, transmittalId } },
        }),
      );
    },
    async create(projectId: string, body: CreateTransmittal): Promise<TransmittalDetail> {
      return unwrap(
        await api.POST(P, {
          params: { path: { orgId, projectId } },
          body,
          headers: { 'Idempotency-Key': crypto.randomUUID() },
        }),
      );
    },
    async send(
      projectId: string,
      transmittalId: string,
      version: number,
    ): Promise<TransmittalDetail> {
      return unwrap(
        await api.POST(`${P}/{transmittalId}/send`, {
          params: {
            path: { orgId, projectId, transmittalId },
            header: { 'If-Match': `"${version}"` },
          },
        }),
      );
    },
    async resend(projectId: string, transmittalId: string, recipientId: string) {
      return unwrap(
        await api.POST(`${P}/{transmittalId}/recipients/{recipientId}/resend`, {
          params: { path: { orgId, projectId, transmittalId, recipientId } },
        }),
      );
    },
  };
}

export type TransmittalsApi = ReturnType<typeof createTransmittalsApi>;

// ---- The recipient's page, opened from the emailed link (X45) ----
// The token is exchanged once for the `__Host-lnk` cookie; no call carries it afterwards.

export type LinkResult = { state: 'open'; access: TransmittalAccess } | { state: 'expired' };

const dead = (e: unknown) => e instanceof ApiError && [401, 410, 422].includes(e.status);

export const transmittalLinkApi = {
  async open(token: string): Promise<LinkResult> {
    try {
      const access =
        token === 'continue'
          ? unwrap(await api.GET('/v1/transmittal-access'))
          : unwrap(await api.POST('/v1/transmittal-access', { body: { token } }));
      return { state: 'open', access };
    } catch (e) {
      // An expired, revoked or unknown link all look the same, by design.
      if (dead(e)) return { state: 'expired' };
      throw e;
    }
  },
  async acknowledge(): Promise<TransmittalAccess> {
    return unwrap(await api.POST('/v1/transmittal-access/acknowledge'));
  },
  async download(item: { revisionType: 'document' | 'drawing'; revisionId: string }) {
    return unwrap(await api.POST('/v1/transmittal-access/download', { body: item }));
  },
};
