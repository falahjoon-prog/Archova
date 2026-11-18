import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { pdfSafe, renderSignedPdf, type SignerRecord } from '../../src/domain/pdf';

async function blank() {
  const d = await PDFDocument.create();
  d.addPage([595, 842]);
  return d.save();
}

const signer: SignerRecord = {
  name: 'Jo Citizen',
  email: 'jo@x.com',
  role: 'needs_to_sign',
  status: 'signed',
  signedOnPaper: false,
  signatureKind: 'typed',
  signatureValue: 'Jo Citizen',
  completedAt: new Date('2026-11-07T01:00:00Z'),
  ip: '203.0.113.9',
  declineReason: null,
};

describe('renderSignedPdf', () => {
  const input = async () => ({
    source: await blank(),
    documentName: 'Notice to proceed.pdf',
    sourceSha256: 'ab'.repeat(32),
    envelope: {
      id: 'env_1',
      subject: 'Notice to proceed',
      sentAt: new Date('2026-11-06T00:00:00Z'),
      completedAt: new Date('2026-11-07T01:00:00Z'),
    },
    signers: [signer],
    fields: [
      {
        recipientEmail: 'jo@x.com',
        kind: 'signature' as const,
        page: 1,
        x: 0.1,
        y: 0.8,
        w: 0.3,
        h: 0.05,
      },
      {
        recipientEmail: 'jo@x.com',
        kind: 'date_signed' as const,
        page: 1,
        x: 0.5,
        y: 0.8,
        w: 0.2,
        h: 0.05,
      },
    ],
    timezone: 'Australia/Sydney',
  });

  it('appends a certificate page and is byte-for-byte repeatable', async () => {
    const a = await renderSignedPdf(await input());
    const b = await renderSignedPdf(await input());
    expect((await PDFDocument.load(a)).getPageCount()).toBe(2);
    expect(createHash('sha256').update(a).digest('hex')).toBe(
      createHash('sha256').update(b).digest('hex'),
    );
  });

  it('survives characters the standard fonts cannot encode', async () => {
    expect(pdfSafe('Zoë 山田')).toBe('Zoë ??');
    const i = await input();
    i.signers = [{ ...signer, name: '山田 太郎', signatureValue: '山田 太郎' }];
    await expect(renderSignedPdf(i)).resolves.toBeInstanceOf(Uint8Array);
  });
});
