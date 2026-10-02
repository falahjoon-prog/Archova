// PDF text layer with positions, per page (ai/03 §3 step 2: "PDF text layer first"). Scanned pages have no text
// and go to vision. Runs in-process with pdf.js (no native code); the ai-worker takes this over when it lands.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from '../domain/titleblock';

const require = createRequire(import.meta.url);
const STANDARD_FONTS = join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts/');

export interface PdfPageText {
  page: number;
  width: number;
  height: number;
  items: TextItem[];
}

export const MAX_PDF_PAGES = 500;

export async function readPdfText(
  bytes: Uint8Array,
  opts: { maxPages?: number } = {},
): Promise<{ pageCount: number; pages: PdfPageText[] }> {
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    standardFontDataUrl: STANDARD_FONTS,
    verbosity: 0,
  });
  try {
    const pdf = await task.promise;
    const limit = Math.min(pdf.numPages, opts.maxPages ?? MAX_PDF_PAGES);
    const pages: PdfPageText[] = [];
    for (let n = 1; n <= limit; n++) {
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
