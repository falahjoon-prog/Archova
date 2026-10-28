// Adding a white card during the online induction (IND-AC7): upload the photo straight to storage, then record
// the credential with the stored file's id. Unlike photos in the outbox, this needs a connection throughout.
import { unwrap, type ApiClient } from '@archova/api-client';
import type { FileObject } from '@archova/contracts';
import type { FileTransfer, UploadApi } from '../../lib/files/upload-queue';
import type { InductionTarget } from './commands';

export interface CredentialPhoto {
  localUri: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
}

/** White card numbers are letters and digits; the server holds the real check, this catches typos early. */
export function normaliseCardNumber(raw: string): string {
  return raw.replace(/[\s-]+/g, '').toUpperCase();
}

export function cardNumberProblem(raw: string): string | null {
  const n = normaliseCardNumber(raw);
  if (n === '') return 'Enter the number on your card.';
  if (!/^[A-Z0-9]{4,20}$/.test(n)) return 'Card numbers use letters and digits only.';
  return null;
}

/** Sends one photo to storage and returns the stored file. Throws if the transfer is refused. */
export async function uploadCredentialPhoto(
  uploads: UploadApi,
  transfer: FileTransfer,
  input: { projectId: string; idempotencyKey: string; photo: CredentialPhoto },
): Promise<FileObject> {
  const { photo } = input;
  const upload = await uploads.createUpload(
    {
      filename: photo.filename,
      mime: photo.mime,
      sizeBytes: photo.sizeBytes,
      sha256: photo.sha256,
      projectId: input.projectId,
      module: 'workforce',
    },
    input.idempotencyKey,
  );
  const sent = await transfer.put(upload.uploadUrl, upload.uploadHeaders, photo.localUri);
  if (sent.status < 200 || sent.status >= 300) {
    throw new Error(`Photo upload refused (${sent.status})`);
  }
  return uploads.completeUpload(upload.id);
}

export async function addWhiteCard(
  api: ApiClient,
  t: InductionTarget,
  completionId: string,
  input: { number: string; fileIds: string[]; expiresOn?: string },
) {
  return unwrap(
    await api.POST(
      '/v1/orgs/{orgId}/projects/{projectId}/induction-completions/{completionId}/credentials',
      {
        params: { path: { orgId: t.orgId, projectId: t.projectId, completionId } },
        body: {
          kind: 'white_card',
          number: normaliseCardNumber(input.number),
          fileIds: input.fileIds,
          ...(input.expiresOn ? { expiresOn: input.expiresOn } : {}),
        },
      },
    ),
  );
}
