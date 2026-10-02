// Offline commands for photos (mobile 02 §2.4, 03 §3.1). A photo is saved on the device at once with its
// `photos.create` held in the outbox; the file uploads in the background and releases the command with its id.

import type { Capture } from '@archova/contracts';
import type { SqlDatabase } from '../../lib/db/sql';
import type { SqliteSyncStore } from '../../lib/db/sync-store';
import type { UploadQueue } from '../../lib/files/upload-queue';

export const PHOTO_ENTITY = 'photo';

export interface LocalPhoto {
  id: string;
  projectId: string;
  /** The defect, diary entry or other record the photo belongs to, if any. */
  defectId: string | null;
  capture: Capture;
  localUri: string;
  thumbnailUri: string;
  /** Set once the server has stored the file. */
  fileId: string | null;
}

export interface CapturePhotoInput {
  photoId: string;
  mutationId: string;
  projectId: string;
  defectId?: string | null;
  /** Commands that must be applied first, such as the offline `defects.create` this photo belongs to. */
  dependsOn?: string[];
  capture: Capture;
  file: {
    localUri: string;
    thumbnailUri: string;
    filename: string;
    mime: string;
    sizeBytes: number;
    sha256: string;
  };
  /** When the user took it; kept as the record time (AC21). */
  clientAt: string;
}

export async function capturePhoto(
  deps: { db: SqlDatabase; store: SqliteSyncStore; uploads: UploadQueue },
  input: CapturePhotoInput,
): Promise<LocalPhoto> {
  const photo: LocalPhoto = {
    id: input.photoId,
    projectId: input.projectId,
    defectId: input.defectId ?? null,
    capture: input.capture,
    localUri: input.file.localUri,
    thumbnailUri: input.file.thumbnailUri,
    fileId: null,
  };
  await deps.db.withExclusiveTransactionAsync(async (tx) => {
    await deps.store.writeLocalIn(tx, {
      entityType: PHOTO_ENTITY,
      id: photo.id,
      projectId: photo.projectId,
      data: photo,
    });
    await deps.store.enqueueIn(
      tx,
      {
        mutationId: input.mutationId,
        command: 'photos.create',
        entityType: PHOTO_ENTITY,
        entityId: photo.id,
        projectId: photo.projectId,
        baseVersion: null,
        clientAt: input.clientAt,
        dependsOn: input.dependsOn ?? [],
        payload: { projectId: photo.projectId, defectId: photo.defectId, capture: input.capture },
      },
      { held: true },
    );
    await deps.uploads.addIn(tx, {
      id: photo.id,
      projectId: photo.projectId,
      module: 'photos',
      localUri: input.file.localUri,
      filename: input.file.filename,
      mime: input.file.mime,
      sizeBytes: input.file.sizeBytes,
      sha256: input.file.sha256,
      capture: input.capture,
      releases: input.mutationId,
    });
  });
  return photo;
}
