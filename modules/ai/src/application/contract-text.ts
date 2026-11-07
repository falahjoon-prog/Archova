// The text of a contract PDF, page by page, as printed rows, for contract review (F34). Longer than a quote
// (head contracts run to hundreds of pages), so it has its own limits. Pages with no text layer are reported, not
// read: scanned contracts need OCR and its daily page cap, which a later slice adds (design/09 CR1 warns instead).
import {
  MAX_CONTRACT_PAGES,
  MAX_CONTRACT_PAGE_CHARS,
  type ContractPage,
} from '@archova/ai-prompts';
import { AppError } from '@archova/kernel';
import { sheetLines } from '../domain/drawing-compare';
import { readPdfText } from '../infra/pdf';
import type { ReadableFile } from './drawing-register';

/** Characters of one contract sent to the model (about 40,000 tokens). */
export const MAX_CONTRACT_CHARS = 160_000;

export interface ContractText {
  pages: ContractPage[];
  pageCount: number;
  /** Pages with no text layer (scans, or blank pages): Nova did not read them. */
  unreadPages: number[];
  /** Pages cut short, or left out after the page and character limits. */
  truncated: boolean;
}

export async function readContractText(
  file: ReadableFile,
  maxChars: number = MAX_CONTRACT_CHARS,
): Promise<ContractText> {
  if (file.file.mime !== 'application/pdf')
    throw new AppError('validation_failed', 'Nova reads contracts sent as PDF.', [
      { path: 'fileId', message: 'Not a PDF' },
    ]);
  const pdf = await readPdfText(file.bytes, { maxPages: MAX_CONTRACT_PAGES });
  const pages: ContractPage[] = [];
  const unreadPages: number[] = [];
  let truncated = pdf.pageCount > pdf.pages.length;
  let chars = 0;
  for (const p of pdf.pages) {
    if (!p.items.some((i) => i.str.trim())) {
      unreadPages.push(p.page);
      continue;
    }
    let text = sheetLines(p.items, p)
      .map((l) => l.text)
      .join('\n');
    if (text.length > MAX_CONTRACT_PAGE_CHARS) {
      text = text.slice(0, MAX_CONTRACT_PAGE_CHARS);
      truncated = true;
    }
    if (chars + text.length > maxChars) {
      truncated = true;
      break;
    }
    chars += text.length;
    pages.push({ page: p.page, text });
  }
  return { pages, pageCount: pdf.pageCount, unreadPages, truncated };
}
