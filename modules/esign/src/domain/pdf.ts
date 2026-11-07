// The signed copy: the original PDF with each placed field filled in, plus a "Certificate of completion" page
// listing who signed, when, from which address and the hash of the original. Rendering is deterministic (dates are
// pinned to the completion time), so the hash recorded at completion can be checked again on every download.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/**
 * A drawn signature is untrusted input that ends up inside the sealed PDF, so it is checked before it is stored:
 * a real PNG header, sane dimensions (a decompression bomb is mostly a huge IHDR), and a trial embed in a scratch
 * PDF. Returns a message when it is not acceptable.
 */
export async function verifyDrawnSignature(dataUrl: string): Promise<string | null> {
  const bad = 'The drawn signature is invalid. Clear it and draw it again.';
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return bad;
  const bytes = Buffer.from(dataUrl.slice(comma + 1), 'base64');
  if (bytes.length < 33 || bytes.length > 110_000 || bytes.toString('latin1', 12, 16) !== 'IHDR')
    return bad;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 2000 || height > 1000 || width * height > 1_500_000)
    return bad;
  try {
    const scratch = await PDFDocument.create();
    await scratch.embedPng(bytes);
  } catch {
    return bad;
  }
  return null;
}

export interface SignerRecord {
  name: string;
  email: string;
  role: 'needs_to_sign' | 'needs_to_view' | 'receives_copy';
  status: string;
  signedOnPaper: boolean;
  signatureKind: 'typed' | 'drawn' | null;
  signatureValue: string | null;
  completedAt: Date | null;
  ip: string | null;
  declineReason: string | null;
}

export interface PlacedField {
  recipientEmail: string;
  kind: 'signature' | 'date_signed';
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SignedPdfInput {
  source: Uint8Array;
  documentName: string;
  sourceSha256: string;
  envelope: { id: string; subject: string; sentAt: Date | null; completedAt: Date };
  signers: readonly SignerRecord[];
  fields: readonly PlacedField[];
  timezone: string;
}

/** WinAnsi only: pdf-lib's standard fonts throw on anything else, so unknown characters become "?". */
export function pdfSafe(v: string): string {
  let out = '';
  for (const ch of v.normalize('NFC')) {
    const c = ch.codePointAt(0)!;
    out += (c >= 0x20 && c < 0x7f) || (c >= 0xa1 && c <= 0xff) ? ch : c === 0x20 ? ' ' : '?';
  }
  return out;
}

export function formatWhen(d: Date | null, timezone: string): string {
  if (!d) return '-';
  try {
    return (
      new Intl.DateTimeFormat('en-AU', {
        timeZone: timezone,
        dateStyle: 'medium',
        timeStyle: 'medium',
      }).format(d) + ` (${timezone})`
    );
  } catch {
    return d.toISOString();
  }
}

export function formatDate(d: Date | null, timezone: string): string {
  if (!d) return '';
  try {
    return new Intl.DateTimeFormat('en-AU', { timeZone: timezone, dateStyle: 'medium' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

async function drawSignature(
  pdf: PDFDocument,
  page: PDFPage,
  font: PDFFont,
  s: SignerRecord,
  box: { x: number; y: number; w: number; h: number },
) {
  let drawn = false;
  if (s.signatureKind === 'drawn' && s.signatureValue) {
    try {
      const b64 = s.signatureValue.slice(s.signatureValue.indexOf(',') + 1);
      const img = await pdf.embedPng(Buffer.from(b64, 'base64'));
      const scale = Math.min(box.w / img.width, box.h / img.height);
      page.drawImage(img, {
        x: box.x,
        y: box.y,
        width: img.width * scale,
        height: img.height * scale,
      });
      drawn = true;
    } catch {
      // Never let one signature strand the envelope: fall back to the signer's name below.
    }
  }
  if (drawn) return;
  if (s.signatureKind === 'drawn' && s.signatureValue) {
    page.drawText(pdfSafe(s.name), { x: box.x, y: box.y + box.h * 0.2, size: 12, font });
  } else if (s.signatureKind === 'typed' && s.signatureValue) {
    const text = pdfSafe(s.signatureValue);
    const size = Math.max(8, Math.min(box.h * 0.7, (box.w / Math.max(text.length, 1)) * 1.9, 26));
    page.drawText(text, {
      x: box.x,
      y: box.y + box.h * 0.2,
      size,
      font,
      color: rgb(0.1, 0.1, 0.35),
    });
  } else if (s.signedOnPaper) {
    page.drawText('Signed on paper', { x: box.x, y: box.y + box.h * 0.2, size: 9, font });
  }
}

export async function renderSignedPdf(input: SignedPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(input.source, {
    ignoreEncryption: false,
    updateMetadata: false,
  });
  const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const byEmail = new Map(input.signers.map((s) => [s.email.toLowerCase(), s]));
  const pages = pdf.getPages();

  for (const f of input.fields) {
    const s = byEmail.get(f.recipientEmail.toLowerCase());
    const page = pages[f.page - 1];
    if (!s || !page || s.status !== 'signed') continue;
    const { width, height } = page.getSize();
    const box = {
      x: f.x * width,
      y: height - (f.y + f.h) * height,
      w: f.w * width,
      h: f.h * height,
    };
    if (f.kind === 'signature') await drawSignature(pdf, page, italic, s, box);
    else
      page.drawText(pdfSafe(formatDate(s.completedAt, input.timezone)), {
        x: box.x,
        y: box.y + box.h * 0.25,
        size: Math.min(10, Math.max(7, box.h * 0.6)),
        font: regular,
      });
  }

  // Certificate of completion (A4).
  let page = pdf.addPage([595.28, 841.89]);
  let y = 800;
  const left = 48;
  const line = (text: string, o: { size?: number; font?: PDFFont; gap?: number } = {}) => {
    const size = o.size ?? 10;
    if (y < 70) {
      page = pdf.addPage([595.28, 841.89]);
      y = 800;
    }
    page.drawText(pdfSafe(text).slice(0, 110), { x: left, y, size, font: o.font ?? regular });
    y -= size + (o.gap ?? 5);
  };
  line('Certificate of completion', { size: 18, font: bold, gap: 12 });
  line(`Document: ${input.documentName}`);
  line(`Envelope subject: ${input.envelope.subject}`);
  line(`Envelope ID: ${input.envelope.id}`);
  line(`Sent: ${formatWhen(input.envelope.sentAt, input.timezone)}`);
  line(`Completed: ${formatWhen(input.envelope.completedAt, input.timezone)}`);
  line(`Original document SHA-256: ${input.sourceSha256}`, { size: 8, gap: 14 });
  line('Signers', { size: 13, font: bold, gap: 8 });
  for (const s of input.signers.filter((x) => x.role !== 'receives_copy')) {
    line(`${s.name} <${s.email}>`, { font: bold });
    const what =
      s.status === 'signed'
        ? s.signedOnPaper
          ? 'Signed on paper (confirmed by the sender)'
          : `Signed (${s.signatureKind === 'drawn' ? 'drawn' : 'typed'} signature)`
        : s.status === 'viewed'
          ? 'Viewed'
          : s.status === 'declined'
            ? `Declined${s.declineReason ? `: ${s.declineReason}` : ''}`
            : s.status;
    line(`   ${what} at ${formatWhen(s.completedAt, input.timezone)}`);
    if (s.ip) line(`   IP address: ${s.ip}`);
    if (s.signatureKind && s.signatureValue && s.status === 'signed' && !s.signedOnPaper) {
      if (y < 110) {
        page = pdf.addPage([595.28, 841.89]);
        y = 800;
      }
      await drawSignature(pdf, page, italic, s, { x: left + 14, y: y - 34, w: 160, h: 34 });
      y -= 44;
    }
    y -= 6;
  }
  line('Electronic signatures are recorded with the time and network address of each signer.', {
    size: 8,
  });

  pdf.setTitle(pdfSafe(input.documentName));
  pdf.setProducer('Archova e-signature');
  pdf.setCreator('Archova');
  pdf.setCreationDate(input.envelope.completedAt);
  pdf.setModificationDate(input.envelope.completedAt);
  return pdf.save({ useObjectStreams: false });
}
