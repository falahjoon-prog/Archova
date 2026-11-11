import type { SignatureValue } from '@archova/ui';

const W = 600;
const H = 200;

/**
 * Renders what the pad collected as a PNG to upload with the attendance row. A typed signature carries the time it
 * was confirmed, so the same person typing their name at two talks never produces the same image (the server flags
 * identical images as repeats).
 */
export function signatureToPng(
  value: NonNullable<SignatureValue>,
  at: Date = new Date(),
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Canvas is not available.'));
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#111827';
  ctx.fillStyle = '#111827';
  if (value.method === 'drawn') {
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of value.strokes) {
      ctx.beginPath();
      stroke.forEach((p, i) =>
        i === 0 ? ctx.moveTo(p.x * W, p.y * H) : ctx.lineTo(p.x * W, p.y * H),
      );
      ctx.stroke();
    }
  } else {
    ctx.font = 'italic 44px serif';
    ctx.fillText(value.name, 24, 100, W - 48);
    ctx.font = '14px sans-serif';
    ctx.fillText(`Typed signature, confirmed ${at.toISOString()}`, 24, H - 24, W - 48);
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not make the signature image.'))),
      'image/png',
    ),
  );
}
