// Scanned PDFs for OCR tests: each scanned page is one full-page greyscale image, as a scanner writes it. The fake
// OCR can't read pixels, so each scan is told apart by its image width and tests script what it "says".
import { deflateSync } from 'node:zlib';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { FakeOcrResponder } from '@archova/mod-ai';

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** A white greyscale PNG with a dark band, like a lightly marked page. */
function paperPng(width: number, height: number): Uint8Array {
  const raw = Buffer.alloc((width + 1) * height, 255);
  for (let y = 0; y < height; y++) raw[y * (width + 1)] = 0;
  for (let x = 0; x < width; x++) raw[Math.floor(height / 2) * (width + 1) + 1 + x] = 0;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export type ScanPage =
  | { scan: { width: number; height: number }; size: [number, number] }
  | { text: string[]; size: [number, number] };

/** A PDF mixing scanned pages and pages with a text layer. */
export async function scannedPdf(pages: ScanPage[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const p of pages) {
    const [w, h] = p.size;
    const page = doc.addPage([w, h]);
    if ('scan' in p) {
      const img = await doc.embedPng(paperPng(p.scan.width, p.scan.height));
      page.drawImage(img, { x: 0, y: 0, width: w, height: h });
    } else
      p.text.forEach((text, i) =>
        page.drawText(text, { x: 50, y: h - 60 - i * 22, size: 11, font }),
      );
  }
  return doc.save();
}

export const pngWidth = (png: Uint8Array) => Buffer.from(png).readUInt32BE(16);

export interface ScriptedLine {
  text: string;
  /** Fractions of the image, origin top-left. */
  left: number;
  top: number;
  confidence?: number;
}

/** Fake OCR that answers per scan, picked by the image width the PDF was made with. */
export function scriptedOcr(byWidth: Record<number, ScriptedLine[]>): FakeOcrResponder {
  return (req) => ({
    lines: (byWidth[pngWidth(req.image)] ?? []).map((l) => ({
      text: l.text,
      confidence: l.confidence ?? 0.98,
      box: { left: l.left, top: l.top, width: 0.15, height: 0.012 },
    })),
  });
}
