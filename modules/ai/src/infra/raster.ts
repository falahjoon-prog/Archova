// Page images for OCR: decoded pixels (from pdf.js) → greyscale, shrunk to fit Textract's limits, → PNG. Plain
// TypeScript and node:zlib, so the API image needs no native canvas.
import { deflateSync } from 'node:zlib';

/** pdf.js ImageKind. */
export const IMAGE_KIND = { GRAYSCALE_1BPP: 1, RGB_24BPP: 2, RGBA_32BPP: 3 } as const;

export interface DecodedImage {
  width: number;
  height: number;
  kind: number;
  data: Uint8Array | Uint8ClampedArray;
}

export interface GreyImage {
  width: number;
  height: number;
  /** One byte a pixel, 0 black to 255 white. */
  data: Uint8Array;
}

/** The value of one source pixel, 0–255; 1-bit rows are padded to whole bytes, and a set bit is white. */
function sampler(img: DecodedImage): (x: number, y: number) => number {
  const d = img.data;
  switch (img.kind) {
    case IMAGE_KIND.GRAYSCALE_1BPP: {
      const stride = (img.width + 7) >> 3;
      return (x, y) => ((d[y * stride + (x >> 3)]! >> (7 - (x & 7))) & 1 ? 255 : 0);
    }
    case IMAGE_KIND.RGB_24BPP:
      return (x, y) => {
        const i = (y * img.width + x) * 3;
        return (d[i]! * 299 + d[i + 1]! * 587 + d[i + 2]! * 114) / 1000;
      };
    case IMAGE_KIND.RGBA_32BPP:
      return (x, y) => {
        const i = (y * img.width + x) * 4;
        const g = (d[i]! * 299 + d[i + 1]! * 587 + d[i + 2]! * 114) / 1000;
        const a = d[i + 3]! / 255;
        return g * a + 255 * (1 - a); // transparent reads as paper
      };
    default:
      throw new Error(`Unsupported image kind ${img.kind}`);
  }
}

/** Greyscale, area-averaged down so the longer side is at most `maxSide` (never scaled up). */
export function toGrey(img: DecodedImage, maxSide: number): GreyImage {
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const sum = new Float64Array(width * height);
  const count = new Uint32Array(width * height);
  const col = new Uint32Array(img.width);
  for (let x = 0; x < img.width; x++) col[x] = Math.min(width - 1, Math.floor(x * scale));
  const at = sampler(img);
  for (let y = 0; y < img.height; y++) {
    const row = Math.min(height - 1, Math.floor(y * scale)) * width;
    for (let x = 0; x < img.width; x++) {
      const k = row + col[x]!;
      sum[k] = sum[k]! + at(x, y);
      count[k] = count[k]! + 1;
    }
  }
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = count[i] ? Math.round(sum[i]! / count[i]!) : 255;
  return { width, height, data };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** An 8-bit greyscale PNG. */
export function encodePng(img: GreyImage): Uint8Array {
  const raw = Buffer.alloc((img.width + 1) * img.height);
  for (let y = 0; y < img.height; y++)
    raw.set(img.data.subarray(y * img.width, (y + 1) * img.width), y * (img.width + 1) + 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(img.width, 0);
  header.writeUInt32BE(img.height, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 6 })),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
}

/** Textract's synchronous limits: 10 MB and 10,000 px a side. We stay under both. */
export const OCR_MAX_BYTES = 9.5 * 1024 * 1024;

/**
 * The PNG to OCR: the longest side at most `maxSide` (5,000 px reads 2.5 mm text on an A1 sheet at about 15 px,
 * Textract's recommended minimum), shrunk further while the file is over the size limit.
 */
export function ocrImage(img: DecodedImage, maxSide = 5000): Uint8Array | null {
  for (let side = maxSide; side >= 1000; side = Math.round(side * 0.75)) {
    const png = encodePng(toGrey(img, side));
    if (png.length <= OCR_MAX_BYTES) return png;
  }
  return null;
}
