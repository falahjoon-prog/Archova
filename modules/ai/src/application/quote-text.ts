// The text of a quote PDF, page by page, as printed rows (columns separated by two spaces): from the PDF text layer,
// or for a scanned page from OCR (0 credits, background tier). Used by quote reading (F22).
import { MAX_QUOTE_PAGE_CHARS, MAX_QUOTE_PAGES, type QuotePage } from '@archova/ai-prompts';
import { AppError, type TenantContext } from '@archova/kernel';
import { sheetLines } from '../domain/drawing-compare';
import { ocrToTextItems } from '../domain/ocr';
import { readPdfText, readScannedPages } from '../infra/pdf';
import type { ReadableFile } from './drawing-register';
import type { Gateway } from './gateway';

/** Scanned pages OCR'd for one quote; a longer scan is read for its first pages. */
export const MAX_OCR_PAGES = 10;
/** Characters sent to the model for one quote. */
export const MAX_QUOTE_CHARS = 60_000;

export interface QuoteText {
  pages: QuotePage[];
  pageCount: number;
  /** Pages read by OCR: the estimator should check these against the PDF. */
  scannedPages: number[];
  /** Pages with no text even after OCR, and pages beyond the limits. */
  skippedPages: number[];
  /** A page was cut, or later pages were left out, to stay inside the limits. */
  truncated: boolean;
}

export async function readQuoteText(
  gateway: Pick<Gateway, 'ocr'>,
  ctx: TenantContext,
  projectId: string,
  file: ReadableFile,
): Promise<QuoteText> {
  if (file.file.mime !== 'application/pdf')
    throw new AppError('validation_failed', 'Nova reads quotes sent as PDF.', [
      { path: 'fileId', message: 'Not a PDF' },
    ]);
  const pdf = await readPdfText(file.bytes, { maxPages: MAX_QUOTE_PAGES });
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
  const toScan = blank.slice(0, MAX_OCR_PAGES);
  if (toScan.length) {
    const scans = await readScannedPages(file.bytes, toScan);
    const ocr = await gateway.ocr(
      ctx,
      scans.map((s) => s.png),
      { feature: 'quote_reading', projectId },
    );
    scans.forEach((scan, i) => {
      const text = rows(ocrToTextItems(ocr[i]?.lines ?? [], scan.placement), scan);
      if (text.trim()) {
        read.set(scan.page, text);
        scannedPages.push(scan.page);
      }
    });
  }

  let truncated = pdf.pageCount > MAX_QUOTE_PAGES || blank.length > MAX_OCR_PAGES;
  let budget = MAX_QUOTE_CHARS;
  const pages: QuotePage[] = [];
  for (const [page, full] of [...read].sort((a, b) => a[0] - b[0])) {
    if (budget <= 0) {
      truncated = true;
      break;
    }
    const text = full.slice(0, Math.min(MAX_QUOTE_PAGE_CHARS, budget));
    if (text.length < full.length) truncated = true;
    budget -= text.length;
    pages.push({ page, text });
  }
  const sent = new Set(pages.map((p) => p.page));
  return {
    pages,
    pageCount: pdf.pageCount,
    scannedPages: scannedPages.sort((a, b) => a - b),
    skippedPages: Array.from({ length: pdf.pageCount }, (_, i) => i + 1).filter(
      (n) => !sent.has(n),
    ),
    truncated,
  };
}
