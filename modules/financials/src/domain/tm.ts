import { createHash } from 'node:crypto';
import { toCents } from './money';

// Time-and-materials (daywork) ticket rules, kept pure so they are cheap to test.

export type TmKind = 'labour' | 'equipment' | 'material';
export type TmStatus = 'draft' | 'part_signed' | 'signed' | 'converted' | 'void';
export type TmRole = 'contractor' | 'principal_rep';
export const TM_ROLES: readonly TmRole[] = ['contractor', 'principal_rep'];

/** Direct costs have one category each, so a ticket becomes one direct cost per kind. */
export const DIRECT_COST_CATEGORY = {
  labour: 'labour',
  equipment: 'plant',
  material: 'materials',
} as const;

export interface TmLineInput {
  kind: TmKind;
  description: string;
  /** Up to two decimals, more than zero. */
  quantity: string;
  unit: string;
  /** Ex GST per unit. */
  rate: string;
}

const QTY = /^\d{1,8}(\.\d{1,2})?$/;
export const MAX_QUANTITY = 1_000_000;
export const MAX_RATE_CENTS = 100_000_000; // $1,000,000.00 per unit
export const isQuantity = (v: string) => QTY.test(v) && Number(v) > 0 && Number(v) <= MAX_QUANTITY;

/** quantity x rate in whole cents, rounded half up. */
export function lineCents(quantity: string, rate: string): number {
  const [w, f = ''] = quantity.split('.') as [string, string?];
  const q100 = Number(w) * 100 + Number(f.padEnd(2, '0'));
  return Math.round((q100 * toCents(rate)) / 100);
}

export function totalCents(lines: { amount: string }[]): number {
  return lines.reduce((n, l) => n + toCents(l.amount), 0);
}

export function totalsByKind(lines: { kind: TmKind; amount: string }[]): Record<TmKind, number> {
  const out: Record<TmKind, number> = { labour: 0, equipment: 0, material: 0 };
  for (const l of lines) out[l.kind] += toCents(l.amount);
  return out;
}

/** Status after a signature: both roles signed means signed. */
export function statusAfterSigning(signedRoles: readonly TmRole[]): TmStatus {
  return TM_ROLES.every((r) => signedRoles.includes(r)) ? 'signed' : 'part_signed';
}

export interface TicketContent {
  number: number;
  title: string;
  description: string | null;
  workDate: string;
  location: string | null;
  contractor: string | null;
  instructedBy: string | null;
  lines: { kind: TmKind; description: string; quantity: string; unit: string; rate: string }[];
}

/** SHA-256 over a fixed-order rendering of what the signer saw, so a signature proves the content. */
export function contentHash(c: TicketContent): string {
  const canon = JSON.stringify([
    c.number,
    c.title,
    c.description,
    c.workDate,
    c.location,
    c.contractor,
    c.instructedBy,
    c.lines.map((l) => [l.kind, l.description, l.quantity, l.unit, l.rate]),
  ]);
  return createHash('sha256').update(canon).digest('hex');
}
