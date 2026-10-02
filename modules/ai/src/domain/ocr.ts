// OCR results (ai/03 §3 step 2) turned into what the rest of Nova reads: page text for search, and positioned text
// for the title block reader. Pure functions.
import type { OcrLine } from './provider';
import type { TextItem } from './titleblock';

/** Lines Textract is less sure of than this are dropped: they are usually specks, stamps or hatching. */
export const MIN_OCR_CONFIDENCE = 0.4;

/** Where the scanned image sits on the page: the PDF matrix that maps the image's unit square to page points. */
export type ImagePlacement = readonly [number, number, number, number, number, number];

const kept = (lines: readonly OcrLine[]) =>
  lines.filter((l) => l.text.trim() && l.confidence >= MIN_OCR_CONFIDENCE);

/** Page text for chunking, in the reading order OCR returned. */
export function ocrPageText(lines: readonly OcrLine[]): string {
  return kept(lines)
    .map((l) => l.text.trim())
    .join('\n');
}

/**
 * OCR lines as positioned text in page points (origin bottom-left), like the PDF text layer, so the title block
 * region can be picked the same way. An image's first row is at the top of its unit square.
 */
export function ocrToTextItems(lines: readonly OcrLine[], m: ImagePlacement): TextItem[] {
  const [a, b, c, d, e, f] = m;
  return kept(lines).map((l) => {
    const u = l.box.left;
    const v = 1 - l.box.top - l.box.height;
    return {
      str: l.text.trim(),
      x: a * u + c * v + e,
      y: b * u + d * v + f,
      height: Math.hypot(c, d) * l.box.height,
    };
  });
}
