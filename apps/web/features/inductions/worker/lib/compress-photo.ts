/** Longest edge kept: card numbers stay readable, files stay small on 4G. */
const MAX_EDGE = 1600;
const QUALITY = 0.8;

/**
 * Re-encodes a ticket photo as a smaller JPEG before upload (frontend 11 §4, design 08 B5). Re-encoding also drops
 * EXIF, including the location; the API strips it again on upload. Runs off the main thread where OffscreenCanvas
 * exists, and returns the original file where the browser can't decode images this way.
 */
export async function compressPhoto(file: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined')
    return file;
  try {
    if (typeof Worker !== 'undefined') {
      const worker = new Worker(new URL('./compress-photo.worker.ts', import.meta.url), {
        type: 'module',
      });
      try {
        return await new Promise<Blob>((resolve, reject) => {
          worker.onmessage = (e: MessageEvent<Blob | null>) =>
            e.data ? resolve(e.data) : reject(new Error('compress failed'));
          worker.onerror = () => reject(new Error('compress failed'));
          worker.postMessage(file);
        });
      } finally {
        worker.terminate();
      }
    }
    return await reencode(file);
  } catch {
    return file;
  }
}

export async function reencode(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(
    Math.round(bitmap.width * scale),
    Math.round(bitmap.height * scale),
  );
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
}
