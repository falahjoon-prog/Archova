import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { packLines, type ReadinessPack } from '../domain/readiness';

const PAGE = { w: 595.28, h: 841.89, margin: 48 } as const;
const SIZE = { title: 18, heading: 12, body: 10, small: 8.5 } as const;

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > width) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

/** Plain readable PDF of the pack. Standard fonts only, so text is limited to WinAnsi; other characters are replaced. */
export async function renderReadinessPdf(
  pack: ReadinessPack,
  createdAt: Date,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(createdAt);
  doc.setModificationDate(createdAt);
  doc.setProducer('Archova');
  doc.setCreator('Archova');
  doc.setTitle('Tender-readiness pack');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - PAGE.margin;
  for (const l of packLines(pack)) {
    const font = l.style === 'title' || l.style === 'heading' ? bold : regular;
    const size = SIZE[l.style];
    const text = l.text.replace(/[^\x20-\x7e\xa1-\xff]/g, '?');
    for (const [i, part] of wrap(text, font, size, PAGE.w - PAGE.margin * 2).entries()) {
      if (y < PAGE.margin + size) {
        page = doc.addPage([PAGE.w, PAGE.h]);
        y = PAGE.h - PAGE.margin;
      }
      if (i === 0 && l.style === 'heading') y -= 10;
      page.drawText(part, { x: PAGE.margin, y, size, font, color: rgb(0.07, 0.09, 0.15) });
      y -= size * 1.45;
    }
  }
  return doc.save({ useObjectStreams: false });
}
