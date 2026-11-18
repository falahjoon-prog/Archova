// A drawn signature as a PNG, made without a canvas: the strokes are rasterised into a grey buffer and written as
// an uncompressed PNG. The server stores the image and flags identical ones as repeats (a hand drawing never is).

export interface UnitPoint {
  x: number;
  y: number;
}

export const SIGNATURE_WIDTH = 600;
export const SIGNATURE_HEIGHT = 200;

/** Black strokes on white. `strokes` are in 0..1 of the pad, so any pad size gives the same picture. */
export function rasteriseSignature(
  strokes: readonly (readonly UnitPoint[])[],
  width = SIGNATURE_WIDTH,
  height = SIGNATURE_HEIGHT,
  radius = 1.8,
): Uint8Array {
  const px = new Uint8Array(width * height).fill(255);
  const dot = (cx: number, cy: number) => {
    const r = Math.ceil(radius);
    for (
      let y = Math.max(0, Math.floor(cy) - r);
      y <= Math.min(height - 1, Math.floor(cy) + r);
      y++
    ) {
      for (
        let x = Math.max(0, Math.floor(cx) - r);
        x <= Math.min(width - 1, Math.floor(cx) + r);
        x++
      ) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) px[y * width + x] = 0;
      }
    }
  };
  for (const stroke of strokes) {
    let prev: UnitPoint | null = null;
    for (const p of stroke) {
      const x = Math.min(1, Math.max(0, p.x)) * (width - 1);
      const y = Math.min(1, Math.max(0, p.y)) * (height - 1);
      if (!prev) dot(x, y);
      else {
        const steps = Math.max(1, Math.ceil(Math.hypot(x - prev.x, y - prev.y)));
        for (let i = 1; i <= steps; i++) {
          dot(prev.x + ((x - prev.x) * i) / steps, prev.y + ((y - prev.y) * i) / steps);
        }
      }
      prev = { x, y };
    }
  }
  return px;
}

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const v of bytes) {
    a = (a + v) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i);
  body.set(data, 4);
  return new Uint8Array([...u32(data.length), ...body, ...u32(crc32(body))]);
}

/** An 8-bit greyscale PNG. The image data is zlib "stored" blocks, so there is no compression to get wrong. */
export function encodeGreyPng(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // filter: none
    raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  const blocks: number[] = [0x78, 0x01];
  for (let i = 0; i < raw.length; i += 65535) {
    const part = raw.subarray(i, Math.min(raw.length, i + 65535));
    const last = i + 65535 >= raw.length ? 1 : 0;
    blocks.push(
      last,
      part.length & 255,
      part.length >>> 8,
      ~part.length & 255,
      (~part.length >>> 8) & 255,
    );
    for (const b of part) blocks.push(b);
  }
  blocks.push(...u32(adler32(raw)));
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', new Uint8Array([...u32(width), ...u32(height), 8, 0, 0, 0, 0])),
    chunk('IDAT', new Uint8Array(blocks)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function signaturePng(strokes: readonly (readonly UnitPoint[])[]): Uint8Array {
  return encodeGreyPng(rasteriseSignature(strokes), SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
}

/** True when the pad holds something worth saving. */
export const hasInk = (strokes: readonly (readonly UnitPoint[])[]) =>
  strokes.some((s) => s.length > 0);
