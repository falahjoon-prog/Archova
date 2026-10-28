// A site photo a task sends to the model as an image (RFI drafts F3, defect tagging F5). The file is read through
// `files.readFileBytes` inside the caller's transaction, so the caller's own read access applies; this turns what
// came back into the image the model gets.
import type { SitePhoto } from '@archova/ai-prompts';
import { AppError } from '@archova/kernel';
import type { ReadableFile } from './drawing-register';

/** The model takes images up to about 3.75 MB (before base64); the apps shrink phone photos before upload. */
export const MAX_PHOTO_BYTES = 3_000_000;
const PHOTO_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** The photo as the model gets it, or 422 when it isn't an image Nova reads or belongs to another project. */
export function toSitePhoto(read: ReadableFile, projectId: string): SitePhoto {
  const { file, bytes } = read;
  const mime = PHOTO_MIMES.find((m) => m === file.mime);
  // A photo in another project is not this caller's to send to the model from here.
  if (!mime || (file.projectId && file.projectId !== projectId))
    throw new AppError('validation_failed', 'Nova reads site photos in PNG, JPEG or WebP.', [
      { path: 'photo/fileId', message: 'Not a photo of this project' },
    ]);
  return { mime, base64: Buffer.from(bytes).toString('base64') };
}
