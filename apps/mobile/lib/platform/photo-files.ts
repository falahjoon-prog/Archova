// Photo files on the device (mobile 03 §3.1): resized for upload, thumbnailed for lists, kept in the app
// sandbox (not the camera roll, excluded from backups) until the server has stored them.

import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export const UPLOAD_LONG_EDGE_PX = 2560;
export const THUMBNAIL_LONG_EDGE_PX = 320;

export interface PreparedPhoto {
  localUri: string;
  thumbnailUri: string;
  filename: string;
  mime: 'image/jpeg';
  sizeBytes: number;
  sha256: string;
}

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** Long edge capped at `longEdge`, aspect ratio kept; never upscales. */
export function fitWithin(width: number, height: number, longEdge: number) {
  const scale = Math.min(1, longEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

async function resizeTo(sourceUri: string, longEdge: number, compress: number) {
  const context = ImageManipulator.manipulate(sourceUri);
  const original = await context.renderAsync();
  const size = fitWithin(original.width, original.height, longEdge);
  const image =
    size.width === original.width && size.height === original.height
      ? original
      : await ImageManipulator.manipulate(sourceUri).resize(size).renderAsync();
  return image.saveAsync({ format: SaveFormat.JPEG, compress });
}

/**
 * Resize and compress the camera's photo (HEIC becomes JPEG), make a thumbnail, move both into the sandbox
 * under the photo's id, and hash the upload copy for `createUpload`.
 */
export async function preparePhoto(photoId: string, sourceUri: string): Promise<PreparedPhoto> {
  const dir = new Directory(Paths.document, 'photos');
  if (!dir.exists) dir.create({ intermediates: true });

  const upload = await resizeTo(sourceUri, UPLOAD_LONG_EDGE_PX, 0.8);
  const thumb = await resizeTo(sourceUri, THUMBNAIL_LONG_EDGE_PX, 0.6);

  const file = new File(dir, `${photoId}.jpg`);
  new File(upload.uri).move(file);
  const thumbnail = new File(dir, `${photoId}.thumb.jpg`);
  new File(thumb.uri).move(thumbnail);

  const bytes = await file.bytes();
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return {
    localUri: file.uri,
    thumbnailUri: thumbnail.uri,
    filename: `${photoId}.jpg`,
    mime: 'image/jpeg',
    sizeBytes: bytes.byteLength,
    sha256: toHex(new Uint8Array(digest)),
  };
}
