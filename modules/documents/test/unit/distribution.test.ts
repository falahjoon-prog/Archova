import { describe, expect, it } from 'vitest';
import {
  computeRegister,
  type RegisterItemInput,
  type RevisionRef,
  type SentRecipient,
  type SentTransmittal,
} from '../../src/domain/distribution';

const NOW = new Date('2026-11-20T00:00:00Z');
const item: RegisterItemInput = {
  kind: 'drawing',
  key: 's1',
  number: 'A-101',
  title: 'Plan',
  discipline: 'Architectural',
  currentRevisionId: 'rB',
  currentRev: 'B',
};
const revisions: RevisionRef[] = [
  { kind: 'drawing', revisionId: 'rA', itemKey: 's1', rev: 'A' },
  { kind: 'drawing', revisionId: 'rB', itemKey: 's1', rev: 'B' },
];
const rcpt = (email: string, over: Partial<SentRecipient> = {}): SentRecipient => ({
  email,
  name: null,
  companyId: null,
  role: 'to',
  deliveredAt: null,
  openedAt: null,
  downloadedAt: null,
  acknowledgedAt: null,
  ...over,
});
const tr = (
  id: string,
  revisionId: string,
  sentAt: string,
  recipients: SentRecipient[],
  responseDue: string | null = null,
): SentTransmittal => ({
  id,
  number: 1,
  sentAt: new Date(sentAt),
  responseDue,
  items: [{ kind: 'drawing', revisionId }],
  recipients,
});
const run = (transmittals: SentTransmittal[]) =>
  computeRegister({ items: [item], revisions, transmittals, now: NOW, today: '2026-11-20' })[0]!;

describe('computeRegister', () => {
  it('flags a current revision that was never issued', () => {
    const row = run([]);
    expect(row.flags.map((f) => f.kind)).toEqual(['not_distributed']);
  });

  it('marks acknowledged, cc and pending recipients with no flags', () => {
    const row = run([
      tr('t1', 'rB', '2026-11-19T00:00:00Z', [
        rcpt('a@x.com', { acknowledgedAt: NOW }),
        rcpt('b@x.com', { role: 'cc' }),
        rcpt('c@x.com'),
      ]),
    ]);
    expect(row.recipients.map((r) => r.status)).toEqual(['acknowledged', 'cc', 'pending']);
    expect(row.flags).toEqual([]);
  });

  it('flags overdue against the response date and outstanding after the grace period', () => {
    const overdue = run([tr('t1', 'rB', '2026-11-10T00:00:00Z', [rcpt('a@x.com')], '2026-11-15')]);
    expect(overdue.recipients[0]!.status).toBe('overdue');
    expect(overdue.flags[0]).toMatchObject({ kind: 'ack_overdue', severity: 'high', count: 1 });

    const outstanding = run([tr('t1', 'rB', '2026-11-10T00:00:00Z', [rcpt('a@x.com')])]);
    expect(outstanding.recipients[0]!.status).toBe('outstanding');
    expect(outstanding.flags[0]!.kind).toBe('ack_outstanding');
  });

  it('is not overdue before the response date', () => {
    const row = run([tr('t1', 'rB', '2026-11-10T00:00:00Z', [rcpt('a@x.com')], '2026-11-20')]);
    expect(row.recipients[0]!.status).toBe('pending');
  });

  it('separates superseded-in-use from a plain distribution gap', () => {
    const row = run([
      tr('t1', 'rA', '2026-11-01T00:00:00Z', [
        rcpt('used@x.com', { downloadedAt: NOW }),
        rcpt('quiet@x.com'),
      ]),
      tr('t2', 'rB', '2026-11-19T00:00:00Z', [rcpt('other@x.com', { acknowledgedAt: NOW })]),
    ]);
    const byEmail = Object.fromEntries(row.recipients.map((r) => [r.email, r.status]));
    expect(byEmail).toEqual({
      'used@x.com': 'stale',
      'quiet@x.com': 'stale',
      'other@x.com': 'acknowledged',
    });
    expect(row.flags.map((f) => f.kind).sort()).toEqual(['distribution_gap', 'superseded_in_use']);
  });

  it('uses the latest transmittal per recipient, matching emails case-insensitively', () => {
    const row = run([
      tr('t1', 'rA', '2026-11-01T00:00:00Z', [rcpt('A@x.com')]),
      tr('t2', 'rB', '2026-11-19T00:00:00Z', [rcpt('a@X.com', { acknowledgedAt: NOW })]),
    ]);
    expect(row.recipients).toHaveLength(1);
    expect(row.recipients[0]).toMatchObject({ status: 'acknowledged', rev: 'B' });
    expect(row.flags).toEqual([]);
  });
});
