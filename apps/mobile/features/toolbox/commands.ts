// Toolbox talks on the phone (safety `toolbox-talks`): record a talk, build the attendance list on site and take each
// person's signature. Signing needs a connection: the image goes to storage first, then the row is signed with it.
import { unwrap, type ApiClient } from '@archova/api-client';
import type { FileObject } from '@archova/contracts';
import type { FileTransfer, UploadApi } from '../../lib/files/upload-queue';

export interface ToolboxTarget {
  orgId: string;
  projectId: string;
}

const path = (t: ToolboxTarget) => ({ orgId: t.orgId, projectId: t.projectId });
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });

export async function listTalks(api: ApiClient, t: ToolboxTarget, status?: 'open' | 'closed') {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/toolbox-talks', {
      params: { path: path(t), query: { limit: 50, ...(status ? { status } : {}) } as never },
    }),
  ).data;
}

export async function getTalk(api: ApiClient, t: ToolboxTarget, talkId: string) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/toolbox-talks/{talkId}', {
      params: { path: { ...path(t), talkId } },
    }),
  );
}

export async function listTopics(api: ApiClient, t: ToolboxTarget) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/toolbox-topics', {
      params: { path: path(t) },
    }),
  ).data;
}

export interface NewTalk {
  title: string;
  topicId?: string | null;
  heldAt: string;
  location?: string;
  presenterName: string;
  attendees?: { personName: string; userId?: string | null }[];
}

/** `idempotencyKey` is made once per form, so a retry after a dropped reply cannot record the talk twice. */
export async function createTalk(
  api: ApiClient,
  t: ToolboxTarget,
  talk: NewTalk,
  idempotencyKey: string,
) {
  return unwrap(
    await api.POST('/v1/orgs/{orgId}/projects/{projectId}/toolbox-talks', {
      params: { path: path(t), header: { 'Idempotency-Key': idempotencyKey } },
      body: {
        title: talk.title.trim(),
        heldAt: talk.heldAt,
        presenterName: talk.presenterName.trim(),
        ...(talk.topicId ? { topicId: talk.topicId } : {}),
        ...(talk.location?.trim() ? { location: talk.location.trim() } : {}),
        ...(talk.attendees?.length ? { attendees: talk.attendees } : {}),
      },
    }),
  );
}

export async function addAttendees(
  api: ApiClient,
  t: ToolboxTarget,
  talk: { id: string; version: number },
  attendees: { personName: string; userId?: string | null }[],
) {
  return unwrap(
    await api.POST('/v1/orgs/{orgId}/projects/{projectId}/toolbox-talks/{talkId}/attendees', {
      params: { path: { ...path(t), talkId: talk.id }, header: ifMatch(talk.version) },
      body: { attendees },
    }),
  );
}

export async function removeAttendee(
  api: ApiClient,
  t: ToolboxTarget,
  talk: { id: string; version: number },
  attendeeId: string,
) {
  return unwrap(
    await api.DELETE(
      '/v1/orgs/{orgId}/projects/{projectId}/toolbox-talks/{talkId}/attendees/{attendeeId}',
      {
        params: {
          path: { ...path(t), talkId: talk.id, attendeeId },
          header: ifMatch(talk.version),
        },
      },
    ),
  );
}

export async function transitionTalk(
  api: ApiClient,
  t: ToolboxTarget,
  talk: { id: string; version: number },
  action: 'close' | 'reopen',
) {
  return unwrap(
    await api.POST('/v1/orgs/{orgId}/projects/{projectId}/toolbox-talks/{talkId}/transition', {
      params: { path: { ...path(t), talkId: talk.id }, header: ifMatch(talk.version) },
      body: { action },
    }),
  );
}

export interface SignatureImage {
  localUri: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
}

/** Sends the drawn signature to storage and returns the stored file. Throws if the transfer is refused. */
export async function uploadSignature(
  uploads: UploadApi,
  transfer: FileTransfer,
  input: { projectId: string; idempotencyKey: string; image: SignatureImage },
): Promise<FileObject> {
  const { image } = input;
  const upload = await uploads.createUpload(
    {
      filename: image.filename,
      mime: 'image/png',
      sizeBytes: image.sizeBytes,
      sha256: image.sha256,
      projectId: input.projectId,
      module: 'safety',
    },
    input.idempotencyKey,
  );
  const sent = await transfer.put(upload.uploadUrl, upload.uploadHeaders, image.localUri);
  if (sent.status < 200 || sent.status >= 300) {
    throw new Error(`Signature upload refused (${sent.status})`);
  }
  return uploads.completeUpload(upload.id);
}

export async function signAttendee(
  api: ApiClient,
  t: ToolboxTarget,
  talk: { id: string; version: number },
  attendeeId: string,
  signatureFileId: string,
) {
  return unwrap(
    await api.PUT(
      '/v1/orgs/{orgId}/projects/{projectId}/toolbox-talks/{talkId}/attendees/{attendeeId}/signature',
      {
        params: {
          path: { ...path(t), talkId: talk.id, attendeeId },
          header: ifMatch(talk.version),
        },
        body: { signatureFileId },
      },
    ),
  );
}
