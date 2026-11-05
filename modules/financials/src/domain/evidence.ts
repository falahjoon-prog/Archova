import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';

export type EvidenceKind = 'claim' | 'schedule';

/** JSON with object keys sorted, so the same facts always hash the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}

export const sha256Hex = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex');

export interface ClaimSnapshot {
  kind: 'claim';
  sealedAt: string;
  timeZone: string;
  contract: { number: number; title: string; kind: string; sopaState: string };
  claim: {
    id: string;
    number: number;
    periodEnd: string;
    receivedAt: string;
    statesAct: boolean;
    isValid: boolean;
    invalidReason: string | null;
    claimedGross: string;
    lessPrevious: string;
    retention: string;
    claimedNet: string;
    gst: string;
    claimedTotal: string;
    servedOn: string | null;
    scheduleDueOn: string | null;
    paymentDueOn: string | null;
    paymentReadDown: boolean;
    ruleState: string | null;
    rulesReviewed: boolean;
  };
  lines: {
    ref: string;
    description: string;
    previous: string;
    thisClaim: string;
    toDate: string;
  }[];
}

export interface ScheduleSnapshot {
  kind: 'schedule';
  sealedAt: string;
  timeZone: string;
  contract: { number: number; title: string; kind: string; sopaState: string };
  claim: { id: string; number: number; claimedNet: string; scheduleDueOn: string | null };
  /** Ties the schedule to the sealed claim it answers. */
  claimEvidenceSha256: string | null;
  schedule: {
    id: string;
    scheduledAmount: string;
    withheldAmount: string;
    overallReason: string | null;
    lineReasons: { ref: string; reason: string }[];
    issuedAt: string;
    issuedWithinTime: boolean;
  };
}

export type EvidenceSnapshot = ClaimSnapshot | ScheduleSnapshot;

const PAGE = { w: 595, h: 842, margin: 50 };

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      // A word wider than the line (a hash) is cut rather than run off the page.
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

/** The lines the PDF prints. Kept apart from drawing so what is printed can be tested. */
export function evidenceLines(s: EvidenceSnapshot, snapshotSha256: string) {
  const L: { text: string; style: 'title' | 'heading' | 'body' | 'small' }[] = [];
  const add = (text: string, style: 'title' | 'heading' | 'body' | 'small' = 'body') =>
    L.push({ text, style });
  const sealed = `${s.sealedAt.slice(0, 19).replace('T', ' ')} UTC`;
  add(
    s.kind === 'claim'
      ? `Payment claim ${s.claim.number}`
      : `Payment schedule for claim ${s.claim.number}`,
    'title',
  );
  add(`Contract ${s.contract.number}: ${s.contract.title} (${s.contract.sopaState})`, 'small');
  add(`Recorded ${sealed}. Project time zone ${s.timeZone}.`, 'small');
  if (s.kind === 'claim') {
    const c = s.claim;
    add('Claim', 'heading');
    add(`Period end ${c.periodEnd}. Received ${c.receivedAt.slice(0, 19).replace('T', ' ')} UTC.`);
    add(
      `Gross ${c.claimedGross}, less previous ${c.lessPrevious}, retention ${c.retention}, net ${c.claimedNet}, GST ${c.gst}, total ${c.claimedTotal}.`,
    );
    add(
      c.statesAct
        ? 'The claim states it is made under the Act.'
        : 'The claim does not state it is made under the Act.',
    );
    add('Dates', 'heading');
    if (c.isValid) {
      add(
        `Served on ${c.servedOn}. Payment schedule due ${c.scheduleDueOn}. Payment due ${c.paymentDueOn}.`,
      );
      if (c.paymentReadDown)
        add('A longer contract payment term was read down to the statutory limit.', 'small');
    } else add(`Not treated as a valid payment claim: ${c.invalidReason ?? 'no reason recorded'}.`);
    if (!c.rulesReviewed)
      add(`Dates follow ${c.ruleState ?? 'the state'} rules not yet legally reviewed.`, 'small');
    add('Lines', 'heading');
    for (const l of s.lines)
      add(
        `${l.ref} ${l.description}: previous ${l.previous}, this claim ${l.thisClaim}, to date ${l.toDate}`,
      );
  } else {
    const p = s.schedule;
    add('Payment schedule', 'heading');
    add(
      `Issued ${p.issuedAt.slice(0, 19).replace('T', ' ')} UTC, ${p.issuedWithinTime ? 'within' : 'after'} the due date ${s.claim.scheduleDueOn ?? 'not set'}.`,
    );
    add(
      `Claimed net ${s.claim.claimedNet}. Scheduled ${p.scheduledAmount}. Withheld ${p.withheldAmount}.`,
    );
    if (p.overallReason) add(`Reason: ${p.overallReason}`);
    for (const r of p.lineReasons) add(`${r.ref}: ${r.reason}`);
    if (s.claimEvidenceSha256) add(`Answers sealed claim record ${s.claimEvidenceSha256}`, 'small');
  }
  add('Seal', 'heading');
  add(`SHA-256 of the record data (JSON, kept with this PDF): ${snapshotSha256}`, 'small');
  add(
    'This is a record of what the platform held when the entry was made. It is not proof of service. Service time is the delivery confirmation of the email it was sent with.',
    'small',
  );
  return L;
}

export async function renderEvidencePdf(s: EvidenceSnapshot, snapshotSha256: string) {
  const doc = await PDFDocument.create();
  // Fixed dates so the same snapshot always renders the same bytes.
  const fixed = new Date(s.sealedAt);
  doc.setCreationDate(fixed);
  doc.setModificationDate(fixed);
  doc.setProducer('Archova');
  doc.setCreator('Archova');
  doc.setTitle(`Sealed evidence: ${s.kind} ${s.claim.number}`);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const size = { title: 16, heading: 12, body: 10, small: 8.5 } as const;
  let page = doc.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - PAGE.margin;
  for (const l of evidenceLines(s, snapshotSha256)) {
    const font = l.style === 'title' || l.style === 'heading' ? bold : regular;
    const sz = size[l.style];
    const gap = l.style === 'heading' ? 8 : 0;
    for (const [i, text] of wrap(l.text, font, sz, PAGE.w - PAGE.margin * 2).entries()) {
      if (y < PAGE.margin + sz) {
        page = doc.addPage([PAGE.w, PAGE.h]);
        y = PAGE.h - PAGE.margin;
      }
      if (i === 0) y -= gap;
      page.drawText(text, { x: PAGE.margin, y, size: sz, font, color: rgb(0.07, 0.09, 0.15) });
      y -= sz * 1.45;
    }
  }
  return doc.save({ useObjectStreams: false });
}
