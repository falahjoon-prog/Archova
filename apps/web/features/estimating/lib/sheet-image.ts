/** Longer side of the picture sent to Nova: enough to read symbols, small enough to upload in a moment. */
const LONG_SIDE_PX = 2000;

export interface SheetImage {
  mime: 'image/png';
  base64: string;
}

/** The sheet's canvas, found from any element in the viewer (the overlay sits beside it). */
export function findSheetCanvas(from: Element | null): HTMLCanvasElement | null {
  for (let el: Element | null = from; el; el = el.parentElement) {
    const canvas = el.querySelector<HTMLCanvasElement>('.pdf-sheet canvas');
    if (canvas) return canvas;
  }
  return null;
}

/**
 * The sheet as the viewer has drawn it, downscaled to a PNG, for Nova. The API has no page renderer (a native canvas
 * is approved for the ai-worker image only), but the browser already renders the page. Null when there is no
 * finished canvas, in which case the server renders the page itself where it can.
 */
export async function captureSheetImage(from: Element | null): Promise<SheetImage | null> {
  const source = findSheetCanvas(from);
  if (!source || !source.width || !source.height) return null;
  const scale = Math.min(1, LONG_SIDE_PX / Math.max(source.width, source.height));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(source.width * scale));
  out.height = Math.max(1, Math.round(source.height * scale));
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, 0, 0, out.width, out.height);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { mime: 'image/png', base64: btoa(binary) };
}
