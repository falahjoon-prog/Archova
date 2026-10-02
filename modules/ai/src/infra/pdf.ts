// PDF text layer with positions, per page (ai/03 §3 step 2: "PDF text layer first"), and the scanned image on a
// page with no text, for OCR. Runs in-process with pdf.js (no native code); the ai-worker takes this over when it
// lands.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { ImagePlacement } from '../domain/ocr';
import type { TextItem } from '../domain/titleblock';
import { ocrImage, type DecodedImage } from './raster';

const require = createRequire(import.meta.url);
const STANDARD_FONTS = join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts/');

export interface PdfPageText {
  page: number;
  width: number;
  height: number;
  items: TextItem[];
}

export const MAX_PDF_PAGES = 500;

const open = (bytes: Uint8Array) =>
  getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    standardFontDataUrl: STANDARD_FONTS,
    verbosity: 0,
  });

export async function readPdfText(
  bytes: Uint8Array,
  /** `pages`: read only these (1-based) pages, e.g. one sheet of a drawing set. */
  opts: { maxPages?: number; pages?: readonly number[] } = {},
): Promise<{ pageCount: number; pages: PdfPageText[] }> {
  const task = open(bytes);
  try {
    const pdf = await task.promise;
    const limit = Math.min(pdf.numPages, opts.maxPages ?? MAX_PDF_PAGES);
    const wanted = opts.pages
      ? opts.pages.filter((n) => n >= 1 && n <= pdf.numPages)
      : Array.from({ length: limit }, (_, i) => i + 1);
    const pages: PdfPageText[] = [];
    for (const n of wanted) {
      const page = await pdf.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: TextItem[] = [];
      for (const it of content.items) {
        if (!('str' in it) || !it.str) continue;
        items.push({ str: it.str, x: it.transform[4], y: it.transform[5], height: it.height });
      }
      pages.push({ page: n, width: vp.width, height: vp.height, items });
      page.cleanup();
    }
    return { pageCount: pdf.numPages, pages };
  } finally {
    await task.destroy();
  }
}

export interface ScannedPage {
  page: number;
  width: number;
  height: number;
  /** Greyscale PNG sized for OCR. */
  png: Uint8Array;
  placement: ImagePlacement;
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const multiply = (m: Matrix, n: readonly number[]): Matrix => [
  m[0] * n[0]! + m[2] * n[1]!,
  m[1] * n[0]! + m[3] * n[1]!,
  m[0] * n[2]! + m[2] * n[3]!,
  m[1] * n[2]! + m[3] * n[3]!,
  m[0] * n[4]! + m[2] * n[5]! + m[4],
  m[1] * n[4]! + m[3] * n[5]! + m[5],
];

/** A page counts as scanned when one image covers at least half of it. */
const MIN_COVERAGE = 0.5;
/** Larger images (over ~20,000 × 10,000 px) are left for the worker rather than decoded in the API. */
const MAX_IMAGE_PIXELS = 200_000_000;

/**
 * The scanned image on each of `pages`: the largest image drawn on the page, if it covers most of it. Pages with
 * no such image (blank, vector-only, or many small images) are left out.
 */
export async function readScannedPages(
  bytes: Uint8Array,
  pages: readonly number[],
): Promise<ScannedPage[]> {
  const task = open(bytes);
  try {
    const pdf = await task.promise;
    const out: ScannedPage[] = [];
    for (const n of pages) {
      if (n < 1 || n > pdf.numPages) continue;
      const page = await pdf.getPage(n);
      try {
        const [x0, y0, x1, y1] = page.view as [number, number, number, number];
        const pageArea = (x1 - x0) * (y1 - y0);
        const ops = await page.getOperatorList();
        let ctm: Matrix = IDENTITY;
        const stack: Matrix[] = [];
        let best: { area: number; placement: Matrix; image: () => Promise<unknown> } | null = null;
        for (let i = 0; i < ops.fnArray.length; i++) {
          const fn = ops.fnArray[i];
          const args = ops.argsArray[i] as unknown[];
          if (fn === OPS.save) stack.push(ctm);
          else if (fn === OPS.restore) ctm = stack.pop() ?? IDENTITY;
          else if (fn === OPS.transform) ctm = multiply(ctm, args as number[]);
          else if (fn === OPS.paintFormXObjectBegin) {
            stack.push(ctm);
            if (Array.isArray(args[0])) ctm = multiply(ctm, args[0] as number[]);
          } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? IDENTITY;
          else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
            const area = Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]);
            if (best && area <= best.area) continue;
            const arg = args[0];
            const image =
              typeof arg === 'string'
                ? () => {
                    const objs = arg.startsWith('g_') ? page.commonObjs : page.objs;
                    return new Promise<unknown>((resolve) => objs.get(arg, resolve));
                  }
                : () => Promise.resolve(arg);
            best = { area, placement: ctm, image };
          }
        }
        if (!best || best.area < pageArea * MIN_COVERAGE) continue;
        const img = (await best.image()) as Partial<DecodedImage> | null;
        if (!img?.data || !img.width || !img.height || img.width * img.height > MAX_IMAGE_PIXELS)
          continue;
        const png = ocrImage(img as DecodedImage);
        if (png)
          out.push({ page: n, width: x1 - x0, height: y1 - y0, png, placement: best.placement });
      } finally {
        page.cleanup();
      }
    }
    return out;
  } finally {
    await task.destroy();
  }
}
