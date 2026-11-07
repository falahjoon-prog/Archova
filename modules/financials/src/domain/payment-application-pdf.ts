import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { certifiedAmountFinding, type PaymentApplication } from './payment-application';
import { fromCents, toCents } from './money';

export const PDF_SECTIONS = ['g702', 'summary', 'breakdown', 'payment', 'proofread'] as const;
export type PdfSection = (typeof PDF_SECTIONS)[number];
export const PDF_COLUMNS = [
  'code',
  'description',
  'scheduledValue',
  'previous',
  'thisPeriod',
  'completedToDate',
  'percentComplete',
  'balanceToFinish',
] as const;
export type PdfColumn = (typeof PDF_COLUMNS)[number];

export interface PdfOptions {
  sections: PdfSection[];
  columns: PdfColumn[];
  paper: 'a4' | 'letter';
  orientation: 'portrait' | 'landscape';
  /** Free text printed under the summary (up to 500 characters). */
  notes: string;
  signatureBlock: boolean;
  /** The architect's certified amount (decimal string), or null to leave it blank on the certificate. */
  amountCertified: string | null;
}

export const DEFAULT_PDF_OPTIONS: PdfOptions = {
  sections: ['summary', 'breakdown', 'payment'],
  columns: [...PDF_COLUMNS],
  paper: 'a4',
  orientation: 'landscape',
  notes: '',
  signatureBlock: false,
  amountCertified: null,
};

const PAPER = { a4: [595.28, 841.89], letter: [612, 792] } as const;
const HEADERS: Record<PdfColumn, string> = {
  code: 'Item',
  description: 'Description',
  scheduledValue: 'Scheduled value',
  previous: 'Previous',
  thisPeriod: 'This period',
  completedToDate: 'To date',
  percentComplete: '%',
  balanceToFinish: 'Balance',
};
const WEIGHT: Record<PdfColumn, number> = {
  code: 0.8,
  description: 3,
  scheduledValue: 1.4,
  previous: 1.3,
  thisPeriod: 1.3,
  completedToDate: 1.3,
  percentComplete: 0.8,
  balanceToFinish: 1.3,
};
const TEXT_COLUMNS = new Set<PdfColumn>(['code', 'description']);

/** Digits with thousands separators; ASCII only because the standard fonts have no wider glyphs. */
export const fmtMoney = (amount: string) => {
  const neg = amount.startsWith('-');
  const [w, f = '00'] = amount.replace('-', '').split('.');
  return `${neg ? '-' : ''}$${w!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${f.padEnd(2, '0')}`;
};

/** Standard PDF fonts only draw WinAnsi; anything else is replaced so a stray emoji cannot fail the export. */
const safe = (s: string) =>
  s
    .replace(/[\r\t]/g, ' ')
    .replace(/[^\n\x20-\x7e\u00a1-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026]/g, '?');

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (font.widthOfTextAtSize(w, size) > width) {
        let n = w.length - 1;
        while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > width) n--;
        if (line) out.push(line);
        line = '';
        out.push(w.slice(0, n));
        w = w.slice(n);
      }
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > width) {
        out.push(line);
        line = w;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

const cellText = (r: PaymentApplication['rows'][number], c: PdfColumn) => {
  switch (c) {
    case 'code':
      return r.code;
    case 'description':
      return r.description;
    case 'percentComplete':
      return `${r.percentComplete}%`;
    default:
      return fmtMoney(r[c]);
  }
};

const INK = rgb(0.1, 0.13, 0.17);
const MUTED = rgb(0.4, 0.45, 0.5);
const RULE = rgb(0.8, 0.83, 0.86);

/** Renders the payment application. The same application and options always give the same bytes. */
export async function renderPaymentApplicationPdf(
  app: PaymentApplication,
  options: PdfOptions,
  meta: { commitmentTitle: string | null },
) {
  const [pw, ph] = PAPER[options.paper];
  const size: [number, number] = options.orientation === 'landscape' ? [ph, pw] : [pw, ph];
  const margin = 40;
  const doc = await PDFDocument.create();
  doc.setCreationDate(app.receivedAt);
  doc.setModificationDate(app.receivedAt);
  doc.setProducer('Archova');
  doc.setCreator('Archova');
  doc.setTitle(
    `Payment application ${app.claimNumber} - ${app.contractTitle}`.replace(/[^\x20-\x7e]/g, '?'),
  );
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = doc.addPage(size);
  let y = size[1] - margin;
  const width = size[0] - margin * 2;
  const room = (h: number) => {
    if (y - h < margin) {
      page = doc.addPage(size);
      y = size[1] - margin;
    }
  };
  const line = (
    text: string,
    o: { font?: PDFFont; sz?: number; x?: number; color?: ReturnType<typeof rgb>; w?: number } = {},
  ) => {
    const font = o.font ?? regular;
    const sz = o.sz ?? 10;
    for (const t of wrap(text, font, sz, o.w ?? width)) {
      room(sz * 1.5);
      y -= sz * 1.35;
      page.drawText(t, { x: o.x ?? margin, y, size: sz, font, color: o.color ?? INK });
    }
  };
  const heading = (t: string) => {
    room(40);
    y -= 10;
    line(t, { font: bold, sz: 12 });
    y -= 2;
    page.drawLine({
      start: { x: margin, y },
      end: { x: margin + width, y },
      thickness: 0.6,
      color: RULE,
    });
    y -= 2;
  };
  const pair = (label: string, value: string, bolded = false) => {
    room(16);
    y -= 13.5;
    page.drawText(safe(label), { x: margin, y, size: 10, font: regular, color: MUTED });
    const v = safe(value);
    page.drawText(v, {
      x: margin + width - (bolded ? bold : regular).widthOfTextAtSize(v, 10),
      y,
      size: 10,
      font: bolded ? bold : regular,
      color: INK,
    });
  };

  line(`Payment application ${app.claimNumber}`, { font: bold, sz: 18 });
  line([app.contractTitle, meta.commitmentTitle].filter(Boolean).join('  |  '), { color: MUTED });
  line(
    `Period ${app.periodStart ?? 'start of contract'} to ${app.periodEnd}  |  Status: ${app.status}`,
    { color: MUTED },
  );

  const s = app.summary;
  const certFinding =
    options.amountCertified === null
      ? null
      : certifiedAmountFinding(s.currentPaymentDue, options.amountCertified);
  const sigLine = (labels: string[]) => {
    room(60);
    y -= 34;
    const w = (width - 20 * (labels.length - 1)) / labels.length;
    labels.forEach((label, i) => {
      const x = margin + i * (w + 20);
      page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 0.6, color: INK });
      page.drawText(label, { x, y: y - 11, size: 8, font: regular, color: MUTED });
    });
    y -= 14;
  };
  if (options.sections.includes('g702')) {
    const rate = Number(app.retentionPct).toFixed(2);
    const onWork = toCents(s.retainage);
    heading('Application for payment');
    pair('1. Original contract sum', fmtMoney(s.originalSum));
    pair('2. Net change by change orders', fmtMoney(s.netChange));
    pair('3. Contract sum to date', fmtMoney(s.revisedSum), true);
    pair('4. Total completed and stored to date', fmtMoney(s.completedToDate));
    pair(
      `5a. Retainage on completed work (${rate}%, this application)`,
      fmtMoney(fromCents(onWork)),
    );
    pair(`5b. Retainage on stored material (${rate}%, this application)`, fmtMoney('0.00'));
    pair('5. Total retainage', fmtMoney(s.retainage));
    pair('6. Total earned less retainage', fmtMoney(s.earnedLessRetainage));
    pair('7. Less previous certificates for payment', fmtMoney(s.lessPrevious));
    pair('8. Current payment due', fmtMoney(s.currentPaymentDue), true);
    pair('9. Balance to finish', fmtMoney(s.balanceToFinish));
    const c = app.changeOrders;
    const net = (a: string, d: string) => fromCents(toCents(a) - toCents(d));
    heading('Change order summary');
    pair('Approved in previous periods: additions', fmtMoney(c.previousAdditions));
    pair('Approved in previous periods: deductions', fmtMoney(c.previousDeductions));
    pair('Approved this period: additions', fmtMoney(c.thisAdditions));
    pair('Approved this period: deductions', fmtMoney(c.thisDeductions));
    pair(
      'Net changes',
      fmtMoney(
        net(
          fromCents(toCents(c.previousAdditions) + toCents(c.thisAdditions)),
          fromCents(toCents(c.previousDeductions) + toCents(c.thisDeductions)),
        ),
      ),
      true,
    );
    heading('Contractor certification');
    line(
      'The undersigned certifies that, to the best of their knowledge, the work covered by this application has been completed in accordance with the contract, that all amounts have been paid for work for which previous payments were received, and that the current payment shown is now due.',
      { sz: 9 },
    );
    sigLine(['Contractor signature', 'Date']);
    sigLine(['Notary / witness', 'Date']);
    heading('Architect / engineer certificate for payment');
    pair('Amount applied for', fmtMoney(s.currentPaymentDue));
    pair(
      'Amount certified (entered in Archova, to be confirmed by signature)',
      options.amountCertified === null ? '____________' : fmtMoney(options.amountCertified),
      true,
    );
    if (certFinding)
      line(`Nova check: ${certFinding.message}`, { sz: 9, color: rgb(0.7, 0.3, 0.05) });
    sigLine(['Architect / engineer signature', 'Date']);
    page = doc.addPage(size);
    y = size[1] - margin;
  }
  if (options.sections.includes('summary')) {
    heading('Summary');
    pair('Original contract sum', fmtMoney(s.originalSum));
    pair('Approved variations', fmtMoney(s.netChange));
    pair('Revised contract sum', fmtMoney(s.revisedSum), true);
    pair('Completed to date', `${fmtMoney(s.completedToDate)} (${s.percentComplete}%)`);
    pair('Less retainage', fmtMoney(s.retainage));
    pair('Earned less retainage', fmtMoney(s.earnedLessRetainage));
    pair('Less previous claims', fmtMoney(s.lessPrevious));
    pair('This period (before retainage)', fmtMoney(s.thisPeriod));
    pair('GST', fmtMoney(s.gst));
    pair('Current payment due', fmtMoney(s.currentPaymentDue), true);
    pair('Balance to finish', fmtMoney(s.balanceToFinish));
  }
  if (options.notes.trim()) {
    heading('Notes');
    line(options.notes.trim().slice(0, 500));
  }

  if (options.sections.includes('breakdown') && options.columns.length > 0) {
    const cols = PDF_COLUMNS.filter((c) => options.columns.includes(c));
    const total = cols.reduce((n, c) => n + WEIGHT[c], 0);
    const widths = cols.map((c) => (WEIGHT[c] / total) * width);
    const xs = widths.map((_, i) => margin + widths.slice(0, i).reduce((n, w) => n + w, 0));
    const pad = 4;
    const header = () => {
      room(30);
      y -= 12;
      cols.forEach((c, i) => {
        const t = HEADERS[c];
        const w = bold.widthOfTextAtSize(t, 8);
        page.drawText(t, {
          x: TEXT_COLUMNS.has(c) ? xs[i]! : xs[i]! + widths[i]! - pad - w,
          y,
          size: 8,
          font: bold,
          color: MUTED,
        });
      });
      y -= 4;
      page.drawLine({
        start: { x: margin, y },
        end: { x: margin + width, y },
        thickness: 0.6,
        color: RULE,
      });
    };
    heading('Schedule of values');
    header();
    for (const r of app.rows) {
      const cells = cols.map((c, i) =>
        TEXT_COLUMNS.has(c)
          ? wrap(cellText(r, c), regular, 8.5, widths[i]! - pad * 2)
          : [safe(cellText(r, c))],
      );
      const h = Math.max(...cells.map((c) => c.length)) * 11 + 4;
      if (y - h < margin) {
        room(h + 100);
        header();
      }
      const top = y;
      cells.forEach((lines, i) => {
        lines.forEach((t, n) => {
          const c = cols[i]!;
          const w = regular.widthOfTextAtSize(t, 8.5);
          page.drawText(t, {
            x: TEXT_COLUMNS.has(c) ? xs[i]! : xs[i]! + widths[i]! - pad - w,
            y: top - 11 * (n + 1),
            size: 8.5,
            font: regular,
            color: INK,
          });
        });
      });
      y -= h;
      page.drawLine({
        start: { x: margin, y },
        end: { x: margin + width, y },
        thickness: 0.3,
        color: RULE,
      });
    }
  }

  if (options.sections.includes('payment')) {
    heading('Payment');
    pair('Received', app.receivedAt.toISOString().slice(0, 10));
    pair('Date payment schedule is due', app.scheduleDueOn ?? 'Not set');
    pair('Payment due', app.paymentDueOn ?? 'Not set');
    pair(
      'Scheduled amount',
      s.scheduledAmount ? fmtMoney(s.scheduledAmount) : 'No schedule issued',
    );
    pair('Paid so far', fmtMoney(s.paid));
  }

  if (options.sections.includes('proofread')) {
    heading('Nova proofread');
    if (app.findings.length === 0 && !certFinding) line('No issues found against the claim data.');
    for (const f of certFinding ? [certFinding, ...app.findings] : app.findings)
      line(`[${f.severity.toUpperCase()}] ${f.message}`);
    line('Checked by code against the claim data; for the person sending to confirm.', {
      sz: 8,
      color: MUTED,
    });
  }

  if (options.signatureBlock) {
    room(80);
    y -= 40;
    for (const [i, label] of ['Claimant signature', 'Date'].entries()) {
      const x = margin + i * (width * 0.7);
      const w = i === 0 ? width * 0.6 : width * 0.3;
      page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 0.6, color: INK });
      page.drawText(label, { x, y: y - 11, size: 8, font: regular, color: MUTED });
    }
  }

  // Footer on every page: what this document is not. Page numbers last, so the total is known.
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(
      'Prepared by Archova from claim data. Nothing is certified until signed. Not a payment claim or payment schedule under security of payment law.',
      { x: margin, y: margin / 2 + 2, size: 7, font: regular, color: MUTED },
    );
    const t = `Page ${i + 1} of ${pages.length}`;
    p.drawText(t, {
      x: size[0] - margin - regular.widthOfTextAtSize(t, 8),
      y: margin / 2 - 9,
      size: 8,
      font: regular,
      color: MUTED,
    });
  });
  return doc.save({ useObjectStreams: false });
}
