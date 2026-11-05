import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  evidenceLines,
  renderEvidencePdf,
  sha256Hex,
  type ClaimSnapshot,
} from '../../src/domain/evidence';

const snap: ClaimSnapshot = {
  kind: 'claim',
  sealedAt: '2026-10-13T23:00:00.000Z',
  timeZone: 'Australia/Sydney',
  contract: { number: 1, title: 'Electrical', kind: 'subcontract', sopaState: 'NSW' },
  claim: {
    id: 'c1',
    number: 1,
    periodEnd: '2026-09-30',
    receivedAt: '2026-10-13T23:00:00.000Z',
    statesAct: true,
    isValid: true,
    invalidReason: null,
    claimedGross: '30000.00',
    lessPrevious: '0.00',
    retention: '1500.00',
    claimedNet: '28500.00',
    gst: '2850.00',
    claimedTotal: '31350.00',
    servedOn: '2026-10-14',
    scheduleDueOn: '2026-10-28',
    paymentDueOn: '2026-11-11',
    paymentReadDown: false,
    ruleState: 'NSW',
    rulesReviewed: false,
  },
  lines: [
    {
      ref: 'E1',
      description: 'Rough-in',
      previous: '0.00',
      thisClaim: '30000.00',
      toDate: '30000.00',
    },
  ],
};

describe('sealed evidence', () => {
  it('canonicalises JSON so key order never changes the hash', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: undefined }] })).toBe('{"a":[{"d":2}],"b":1}');
    expect(sha256Hex(canonicalJson({ a: 1, b: 2 }))).toBe(sha256Hex(canonicalJson({ b: 2, a: 1 })));
  });

  it('changes the hash when any fact changes', () => {
    const changed = { ...snap, claim: { ...snap.claim, claimedTotal: '31350.01' } };
    expect(sha256Hex(canonicalJson(changed))).not.toBe(sha256Hex(canonicalJson(snap)));
  });

  it('prints the dates, amounts, the seal, and the unreviewed-rules note', () => {
    const text = evidenceLines(snap, 'abc')
      .map((l) => l.text)
      .join('\n');
    expect(text).toContain('Payment schedule due 2026-10-28');
    expect(text).toContain('total 31350.00');
    expect(text).toContain('not yet legally reviewed');
    expect(text).toContain('SHA-256');
    expect(text).not.toMatch(/verified|compliant/i);
  });

  it('renders a PDF, the same bytes every time', async () => {
    const a = await renderEvidencePdf(snap, 'a'.repeat(64));
    const b = await renderEvidencePdf(snap, 'a'.repeat(64));
    expect(Buffer.from(a.subarray(0, 5)).toString()).toBe('%PDF-');
    expect(sha256Hex(a)).toBe(sha256Hex(b));
  });
});
