// The text of a declaration or certificate PDF, page by page, as printed rows: from the PDF text layer, or for a
// scanned page from OCR (background tier). Used by declaration reading.
import {
  MAX_DECLARATION_PAGE_CHARS,
  MAX_DECLARATION_PAGES,
  type DeclarationPage,
} from '@archova/ai-prompts';
import { AppError, type TenantContext } from '@archova/kernel';
import { sheetLines } from '../domain/drawing-compare';
import { ocrToTextItems } from '../domain/ocr';
import { readPdfText, readScannedPages } from '../infra/pdf';
import type { ReadableFile } from './drawing-register';
import type { Gateway } from './gateway';

/** Characters sent to the model for one document. */
export const MAX_DECLARATION_CHARS = 30_000;

export interface DeclarationText {
  pages: DeclarationPage[];
  pageCount: number;
  /** Pages read by OCR: the person should check these against the PDF. */
  scannedPages: number[];
  /** Pages with no text even after OCR, and pages beyond the limits. */
  skippedPages: number[];
  truncated: boolean;
}

export async function readDeclarationText(
  gateway: Pick<Gateway, 'ocr'>,
  ctx: TenantContext,
  projectId: string,
  file: ReadableFile,
): Promise<DeclarationText> {
  if (file.file.mime !== 'application/pdf')
    throw new AppError('validation_failed', 'Nova reads declarations sent as PDF.', [
      { path: 'fileId', message: 'Not a PDF' },
    ]);
  const pdf = await readPdfText(file.bytes, { maxPages: MAX_DECLARATION_PAGES });
  const rows = (items: Parameters<typeof sheetLines>[0], page: { width: number; height: number }) =>
    sheetLines(items, page)
      .map((l) => l.text)
      .join('\n');
  const read = new Map<number, string>();
  const blank: number[] = [];
  for (const p of pdf.pages) {
    if (p.items.some((i) => i.str.trim())) read.set(p.page, rows(p.items, p));
    else blank.push(p.page);
  }
  const scannedPages: number[] = [];
  if (blank.length) {
    const scans = await readScannedPages(file.bytes, blank);
    const ocr = await gateway.ocr(
      ctx,
      scans.map((s) => s.png),
      { feature: 'declaration_reading', projectId },
    );
    scans.forEach((scan, i) => {
      const text = rows(ocrToTextItems(ocr[i]?.lines ?? [], scan.placement), scan);
      if (text.trim()) {
        read.set(scan.page, text);
        scannedPages.push(scan.page);
      }
    });
  }
  let truncated = pdf.pageCount > MAX_DECLARATION_PAGES;
  let budget = MAX_DECLARATION_CHARS;
  const pages: DeclarationPage[] = [];
  for (const [page, full] of [...read].sort((a, b) => a[0] - b[0])) {
    if (budget <= 0) {
      truncated = true;
      break;
    }
    const text = full.slice(0, Math.min(MAX_DECLARATION_PAGE_CHARS, budget));
    if (text.length < full.length) truncated = true;
    budget -= text.length;
    pages.push({ page, text });
  }
  const sent = new Set(pages.map((p) => p.page));
  return {
    pages,
    pageCount: pdf.pageCount,
    scannedPages: scannedPages.sort((a, b) => a - b),
    skippedPages: Array.from(
      { length: Math.min(pdf.pageCount, MAX_DECLARATION_PAGES) },
      (_, i) => i + 1,
    ).filter((n) => !sent.has(n)),
    truncated,
  };
}
