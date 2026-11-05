import { describe, expect, it } from 'vitest';
import { buildRawMessage } from '../../src/mime';
import { renderEvidenceEmail } from '../../src/jobs/evidence-deliveries';

describe('raw message', () => {
  it('carries both bodies and each attachment intact, and cannot be given extra headers', () => {
    const raw = buildRawMessage(
      {
        to: 'a@b.co',
        subject: 'Claim 1\r\nBcc: evil@x.co',
        text: 'hi',
        html: '<p>hi</p>',
        attachments: [
          {
            filename: '../x y.pdf',
            contentType: 'application/pdf',
            content: Buffer.from('%PDF-1.7 body'),
          },
        ],
      },
      'Archova <no-reply@archova.com.au>',
      undefined,
      'seed',
    );
    expect(raw).toContain('Subject: Claim 1 Bcc: evil@x.co\r\n');
    expect(raw).not.toMatch(/\r\nBcc:/);
    expect(raw).toContain('filename=".._x_y.pdf"');
    const b64 =
      /filename="\.\._x_y\.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)\r\n--/.exec(
        raw,
      )![1]!;
    expect(Buffer.from(b64.replace(/\r\n/g, ''), 'base64').toString()).toBe('%PDF-1.7 body');
    expect(raw.endsWith('--=_mixed_seed--\r\n')).toBe(true);
  });
});

describe('service email', () => {
  it('attaches the PDF and JSON, never links, and never says verified', () => {
    const m = renderEvidenceEmail(
      {
        id: 'd',
        recipientEmail: 'pay@owner.co',
        kind: 'claim',
        claimNumber: 3,
        contractNumber: 1,
        contractTitle: 'Electrical <b>',
        snapshotSha256: 'a'.repeat(64),
        pdfSha256: 'b'.repeat(64),
        pdf: Buffer.from('pdf'),
        snapshotText: '{"a":1}',
        signatureKeyId: 'k1',
        evidenceId: 'e',
        addressBasis: null,
      },
      'Harbour Build',
    );
    expect(m.attachments?.map((a) => a.filename)).toEqual([
      'claim-3-claim-evidence.pdf',
      'claim-3-claim-evidence.json',
    ]);
    expect(m.html).not.toContain('<b>');
    expect(m.text + m.html).not.toMatch(/https?:|verified|compliant/i);
    expect(m.subject).toContain('Payment claim 3');
  });
});
