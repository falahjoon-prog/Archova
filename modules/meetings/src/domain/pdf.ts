import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import type { MinutesView } from './minutes';

const KIND: Record<string, string> = {
  information: 'Info',
  decision: 'Decision',
  action: 'Action',
};
const ATTENDANCE: Record<string, string> = {
  present: 'Present',
  apologies: 'Apologies',
  absent: 'Absent',
};

export interface Line {
  text: string;
  style: 'title' | 'heading' | 'body' | 'small';
  indent?: number;
}

/** The minutes as the lines the PDF prints; kept apart from drawing so what is printed can be tested. */
export function minutesLines(m: MinutesView): Line[] {
  const out: Line[] = [
    { text: m.title, style: 'title' },
    { text: `${m.seriesName}, meeting ${m.number}, minutes version ${m.version}`, style: 'small' },
    {
      text: `Held ${m.heldAt.slice(0, 16).replace('T', ' ')} UTC${m.location ? `, ${m.location}` : ''}`,
      style: 'small',
    },
    {
      text: `Issued ${m.issuedAt.slice(0, 10)}${m.correctionsBy ? `. Corrections by ${m.correctionsBy}.` : ''}`,
      style: 'small',
    },
    { text: 'Attendance', style: 'heading' },
  ];
  for (const a of m.attendees) {
    const who = [a.name, a.companyName, a.role].filter(Boolean).join(', ');
    out.push({
      text: `${who} - ${ATTENDANCE[a.attendance] ?? a.attendance}`,
      style: 'body',
      indent: 1,
    });
  }
  for (const s of m.sections) {
    out.push({ text: `${s.position}. ${s.title}`, style: 'heading' });
    if (s.live) {
      // MTG-AC6: the list as it stood when the minutes were issued.
      out.push({
        text: `List as at ${s.live.asOf.slice(0, 16).replace('T', ' ')} UTC`,
        style: 'small',
        indent: 1,
      });
      if (!s.live.rows.length)
        out.push({ text: 'Nothing on this list at the time.', style: 'small', indent: 1 });
      for (const r of s.live.rows) {
        out.push({ text: `${r.ref}  ${r.title}`, style: 'body', indent: 1 });
        if (r.detail) out.push({ text: r.detail, style: 'small', indent: 2 });
      }
      if (s.live.truncated)
        out.push({
          text: 'The list was longer; the rest is not shown.',
          style: 'small',
          indent: 1,
        });
    }
    if (!s.items.length && !s.live)
      out.push({ text: 'Nothing recorded.', style: 'small', indent: 1 });
    for (const i of s.items) {
      out.push({
        text: `${i.itemNo}  [${KIND[i.kind]}${i.kind === 'action' && i.status === 'closed' ? ', closed' : ''}]  ${i.body}`,
        style: 'body',
        indent: 1,
      });
      const meta = [
        i.ownerName ? `Owner: ${i.ownerName}` : null,
        i.dueDate ? `Due: ${i.dueDate}` : null,
        i.carriedCount > 0
          ? `Carried forward ${i.carriedCount} time${i.carriedCount === 1 ? '' : 's'}`
          : null,
      ].filter(Boolean);
      if (meta.length) out.push({ text: meta.join('   '), style: 'small', indent: 2 });
    }
  }
  return out;
}

const SIZE = { title: 18, heading: 12, body: 10, small: 9 } as const;
const PAGE = { w: 595, h: 842, margin: 50 } as const;

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Renders A4 minutes. Text is WinAnsi (Helvetica); characters outside it are replaced so a stray symbol cannot fail an issue. */
export async function renderMinutesPdf(m: MinutesView): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - PAGE.margin;
  const safe = (t: string) => t.replace(/[^\x20-\x7E\xA1-\xFF]/g, '?');
  for (const l of minutesLines(m)) {
    const size = SIZE[l.style];
    const f = l.style === 'title' || l.style === 'heading' ? bold : font;
    const x = PAGE.margin + (l.indent ?? 0) * 16;
    const gap = l.style === 'heading' ? 8 : 0;
    y -= gap;
    for (const text of wrap(safe(l.text), f, size, PAGE.w - PAGE.margin - x)) {
      if (y < PAGE.margin + size) {
        page = doc.addPage([PAGE.w, PAGE.h]);
        y = PAGE.h - PAGE.margin;
      }
      page.drawText(text, {
        x,
        y: y - size,
        size,
        font: f,
        color: l.style === 'small' ? rgb(0.35, 0.35, 0.35) : rgb(0.07, 0.09, 0.15),
      });
      y -= size + 4;
    }
  }
  return doc.save();
}
