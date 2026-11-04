import type { ContractAnswer, ContractReview } from '../data/api';
import {
  CONTRACT_TYPE_LABEL,
  DAY_TYPE_LABEL,
  DECISION_LABEL,
  SEVERITY,
  SUMMARY_LABEL,
  TIME_BAR_LABEL,
  currentDecisions,
} from './labels';

export interface ExportLine {
  text: string;
  style: 'title' | 'heading' | 'body' | 'small';
  indent?: number;
}

type Source = ContractReview['flags'][number]['source'];

const cite = (s: Source): string =>
  `${s.clause ? `Clause ${s.clause}` : 'Clause number not printed'}, page ${s.page}: "${s.quote}"`;

/**
 * The review (and any questions asked on the Ask tab) as the lines the PDF prints. Kept apart from drawing so what is
 * printed can be tested. The disclaimer comes from the API and is always first; nothing here adds a view of the
 * contract (design/09 §1).
 */
export function reviewExportLines(
  r: ContractReview,
  answers: readonly ContractAnswer[],
  exportedAt: string,
): ExportLine[] {
  const out: ExportLine[] = [
    { text: r.fileName, style: 'title' },
    {
      text: `Nova contract review - ${CONTRACT_TYPE_LABEL[r.contractType]} - ${r.ourSide === 'we_pay' ? 'We pay' : 'We get paid'}`,
      style: 'small',
    },
    { text: `Reviewed ${r.createdAt.slice(0, 10)}. Exported ${exportedAt}.`, style: 'small' },
    { text: r.disclaimer, style: 'body' },
  ];
  if (r.playbookMissing)
    out.push({
      text: 'No playbook for this contract type: Nova summarised the contract but looked for no departures.',
      style: 'small',
    });
  if (r.unreadPages.length)
    out.push({
      text: `Pages ${r.unreadPages.join(', ')} have no text Nova can read, so it may have missed clauses on them.`,
      style: 'small',
    });
  if (r.truncated)
    out.push({
      text: 'The contract is longer than Nova reads in one go, so some pages were cut.',
      style: 'small',
    });
  if (r.multiState)
    out.push({
      text: 'Covers more than one state: any statutory checks are for a person.',
      style: 'small',
    });

  out.push({ text: 'Summary', style: 'heading' });
  if (!r.summary.length)
    out.push({ text: 'Nova found none of the key terms in this contract.', style: 'small' });
  for (const s of r.summary) {
    out.push({ text: `${SUMMARY_LABEL[s.key]}: ${s.text}`, style: 'body', indent: 1 });
    out.push({ text: cite(s.source), style: 'small', indent: 2 });
  }
  if (r.summaryNotFound.length)
    out.push({
      text: `Not found in this contract: ${r.summaryNotFound
        .map((k) => SUMMARY_LABEL[k as keyof typeof SUMMARY_LABEL] ?? k)
        .join(', ')}`,
      style: 'small',
      indent: 1,
    });

  const decisions = currentDecisions(r);
  out.push({ text: `Flags (${decisions.size} of ${r.flags.length} decided)`, style: 'heading' });
  if (!r.flags.length)
    out.push({
      text: r.playbookMissing
        ? 'No departures were looked for.'
        : 'Nova found no departures from your playbook. It only checks the issues on its list.',
      style: 'small',
    });
  r.flags.forEach((f, i) => {
    const d = decisions.get(i);
    out.push({
      text: `${SEVERITY[f.severity].label} - ${f.topic} - ${d ? DECISION_LABEL[d.decision] : 'Undecided'}`,
      style: 'body',
      indent: 1,
    });
    out.push({ text: f.finding, style: 'body', indent: 2 });
    out.push({ text: cite(f.source), style: 'small', indent: 2 });
    out.push({
      text: `Your position: ${f.position}${f.threshold ? ` (${f.threshold})` : ''}`,
      style: 'small',
      indent: 2,
    });
    if (f.approvedWording) {
      const w = f.approvedWording;
      out.push({ text: `${w.label}: ${w.wording}`, style: 'small', indent: 2 });
      out.push({
        text: `Approved by ${w.approvedBy} on ${w.approvedOn}. ${w.approvalNote}${f.wordingStatus === 'review_due' ? ' Review is due.' : ''}`,
        style: 'small',
        indent: 2,
      });
    } else {
      out.push({ text: 'No approved wording: refer to your lawyer.', style: 'small', indent: 2 });
    }
    if (d)
      out.push({
        text: `Decision: ${DECISION_LABEL[d.decision]} on ${d.decidedAt.slice(0, 10)}${d.note ? `. ${d.note}` : ''}`,
        style: 'small',
        indent: 2,
      });
  });
  out.push({
    text: "Not on Nova's checklist: Nova only checks the issues on its list. Anything else, check with your lawyer.",
    style: 'small',
  });

  out.push({ text: 'Time bars and notice periods', style: 'heading' });
  if (!r.timeBars.length)
    out.push({
      text: 'Nova found no notice periods or time bars in this contract.',
      style: 'small',
    });
  for (const t of r.timeBars) {
    const days =
      t.days !== null
        ? ` (${t.days} ${DAY_TYPE_LABEL[t.dayType]})`
        : ` (${DAY_TYPE_LABEL[t.dayType]})`;
    out.push({ text: `${TIME_BAR_LABEL[t.event]}: ${t.period}${days}`, style: 'body', indent: 1 });
    out.push({ text: cite(t.source), style: 'small', indent: 2 });
  }

  if (answers.length) {
    out.push({ text: 'Questions asked of the contract', style: 'heading' });
    // The Ask tab lists the newest first; the export reads in the order they were asked.
    for (const a of [...answers].reverse()) {
      out.push({ text: `Q: ${a.question}`, style: 'body', indent: 1 });
      out.push({ text: a.answer, style: 'body', indent: 2 });
      for (const c of a.citations) out.push({ text: cite(c), style: 'small', indent: 2 });
      if (a.kind === 'not_addressed' && (a.unreadPages.length || a.truncated))
        out.push({
          text: `${a.unreadPages.length ? `Nova could not read pages ${a.unreadPages.join(', ')}. ` : ''}${a.truncated ? 'Part of the contract was left out.' : ''} The answer may be there.`,
          style: 'small',
          indent: 2,
        });
    }
  }
  return out;
}

const SIZE = { title: 18, heading: 12, body: 10, small: 9 } as const;
const PAGE = { w: 595, h: 842, margin: 50 } as const;

/** Renders A4. Text is WinAnsi (Helvetica); characters outside it are replaced so a stray symbol cannot fail the export. pdf-lib loads only when someone exports. */
export async function renderReviewPdf(lines: readonly ExportLine[]): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - PAGE.margin;
  const safe = (t: string) =>
    t
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/[^\x20-\x7E\xA1-\xFF]/g, '?');
  for (const l of lines) {
    const size = SIZE[l.style];
    const f = l.style === 'title' || l.style === 'heading' ? bold : font;
    const x = PAGE.margin + (l.indent ?? 0) * 16;
    if (l.style === 'heading') y -= 8;
    const width = PAGE.w - PAGE.margin - x;
    const wrapped: string[] = [];
    let line = '';
    for (const word of safe(l.text).split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && f.widthOfTextAtSize(next, size) > width) {
        wrapped.push(line);
        line = word;
      } else line = next;
    }
    if (line) wrapped.push(line);
    for (const text of wrapped) {
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

/** File name for the download: the contract's name without its extension, safe on every file system. */
export function exportFileName(r: Pick<ContractReview, 'fileName'>): string {
  const base = r.fileName
    .replace(/\.pdf$/i, '')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .trim();
  return `Nova review - ${base || 'contract'}.pdf`;
}
