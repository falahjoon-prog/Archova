// The text of one drawing sheet as positioned lines (0..1, origin top-left): from the PDF text layer, or for a scan
// from OCR (0 credits, background tier). Shared by revision compare (F21) and RFI drafts from a markup (F3).
import type { TenantContext } from '@archova/kernel';
import { ocrToTextItems } from '../domain/ocr';
import { sheetLines, type SheetLine } from '../domain/drawing-compare';
import { readPdfText, readScannedPages } from '../infra/pdf';
import type { ReadableFile } from './drawing-register';
import type { Gateway } from './gateway';

/** `page` is 1-based. Non-PDF files have no readable sheet text. */
export async function readSheetLines(
  gateway: Pick<Gateway, 'ocr'>,
  ctx: TenantContext,
  projectId: string,
  feature: string,
  file: ReadableFile,
  page: number,
): Promise<{ lines: SheetLine[]; scanned: boolean }> {
  if (file.file.mime !== 'application/pdf') return { lines: [], scanned: false };
  const pdf = await readPdfText(file.bytes, { pages: [page] });
  const text = pdf.pages[0];
  if (text?.items.some((i) => i.str.trim()))
    return { lines: sheetLines(text.items, text), scanned: false };
  const [scan] = await readScannedPages(file.bytes, [page]);
  if (!scan) return { lines: [], scanned: false };
  const [read] = await gateway.ocr(ctx, [scan.png], { feature, projectId });
  return { lines: sheetLines(ocrToTextItems(read!.lines, scan.placement), scan), scanned: true };
}
