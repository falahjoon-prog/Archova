import { describe, expect, it } from 'vitest';
import {
  checkSignature,
  isComplete,
  isTurn,
  reminderDue,
  sendProblems,
  toNotify,
  type RecipientState,
} from '../../src/domain/envelope';

const r = (id: string, order: number, over: Partial<RecipientState> = {}): RecipientState => ({
  id,
  email: `${id}@x.com`,
  role: 'needs_to_sign',
  routingOrder: order,
  status: 'pending',
  ...over,
});

describe('toNotify', () => {
  it('emails every actionable recipient at once without a signing order', () => {
    const rs = [r('a', 1), r('b', 2), r('c', 3, { role: 'receives_copy' })];
    expect(toNotify(rs, false).map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('emails only the first group with a signing order, then the next once it is done', () => {
    const rs = [r('a', 1), r('b', 2), r('c', 2)];
    expect(toNotify(rs, true).map((x) => x.id)).toEqual(['a']);
    rs[0]!.status = 'signed';
    expect(toNotify(rs, true).map((x) => x.id)).toEqual(['b', 'c']);
  });
  it('skips delegated recipients and waits while a group member is outstanding', () => {
    const rs = [r('a', 1, { status: 'delegated' }), r('a2', 1, { status: 'sent' }), r('b', 2)];
    expect(toNotify(rs, true)).toEqual([]);
  });
});

describe('isTurn', () => {
  it('blocks later groups until earlier ones finish', () => {
    const rs = [r('a', 1, { status: 'sent' }), r('b', 2, { status: 'sent' })];
    expect(isTurn(rs, true, 'a')).toBe(true);
    expect(isTurn(rs, true, 'b')).toBe(false);
    expect(isTurn(rs, false, 'b')).toBe(true);
  });
});

describe('isComplete', () => {
  it('needs every signer signed and ignores copies and delegated rows', () => {
    const rs = [
      r('a', 1, { status: 'signed' }),
      r('b', 1, { status: 'delegated' }),
      r('c', 1, { role: 'receives_copy' }),
    ];
    expect(isComplete(rs)).toBe(true);
    rs.push(r('d', 2));
    expect(isComplete(rs)).toBe(false);
  });
  it('is not complete with no signers', () => {
    expect(isComplete([r('c', 1, { role: 'receives_copy' })])).toBe(false);
  });
});

describe('reminderDue', () => {
  const expiresAt = new Date('2026-12-01T00:00:00Z');
  it('is due inside the reminder window once', () => {
    const env = { expiresAt, reminderDays: 3, lastRemindedAt: null };
    expect(reminderDue(env, new Date('2026-11-20T00:00:00Z'))).toBe(false);
    expect(reminderDue(env, new Date('2026-11-29T00:00:00Z'))).toBe(true);
    expect(
      reminderDue(
        { ...env, lastRemindedAt: new Date('2026-11-28T12:00:00Z') },
        new Date('2026-11-29T00:00:00Z'),
      ),
    ).toBe(false);
    expect(reminderDue(env, new Date('2026-12-02T00:00:00Z'))).toBe(false);
  });
});

describe('sendProblems', () => {
  it('lists what is missing', () => {
    const p = sendProblems({
      subject: ' ',
      documentCount: 0,
      recipients: [
        { name: 'A', email: 'bad', role: 'needs_to_view' },
        { name: 'B', email: 'a@x.com', role: 'needs_to_view' },
        { name: 'C', email: 'A@x.com', role: 'needs_to_view' },
      ],
    });
    expect(p.map((x) => x.path)).toEqual([
      'documents',
      'subject',
      'recipients',
      'recipients/0/email',
      'recipients/2/email',
    ]);
  });
  it('passes a complete draft', () => {
    expect(
      sendProblems({
        subject: 'Notice',
        documentCount: 1,
        recipients: [{ name: 'A', email: 'a@x.com', role: 'needs_to_sign' }],
      }),
    ).toEqual([]);
  });
});

describe('checkSignature', () => {
  it('accepts a typed name and rejects control characters', () => {
    expect(checkSignature('typed', ' Jo Citizen ')).toEqual({ ok: true, value: 'Jo Citizen' });
    expect(checkSignature('typed', 'x\u0007y').ok).toBe(false);
  });
  it('accepts a PNG data URL only', () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(120, 1),
    ]).toString('base64');
    expect(checkSignature('drawn', `data:image/png;base64,${png}`).ok).toBe(true);
    expect(
      checkSignature('drawn', `data:image/png;base64,${Buffer.alloc(200).toString('base64')}`).ok,
    ).toBe(false);
    expect(checkSignature('drawn', 'data:image/svg+xml;base64,AAAA').ok).toBe(false);
  });
});
