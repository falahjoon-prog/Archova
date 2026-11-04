import {
  UnmappedCostCodeError,
  type AccountTarget,
  type FieldMap,
  type LedgerDocument,
} from './types';

export function centsToDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError('cents must be a safe integer');
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function decimalToCents(value: number | string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new RangeError('not a number');
  return Math.round(n * 100);
}

export interface ResolvedLine {
  description: string;
  amountCents: number;
  gstCents: number;
  target: AccountTarget;
}

// Lines by cost code with GST per line, then retention as a negative line (integrations/02 §2 A4, A5).
// Throws UnmappedCostCodeError listing every missing code so one sync issue names them all.
export function resolveLines(doc: LedgerDocument, map: FieldMap): ResolvedLine[] {
  const missing = [
    ...new Set(doc.lines.filter((l) => !map.accounts[l.costCode]).map((l) => l.costCode)),
  ];
  if (missing.length > 0) throw new UnmappedCostCodeError(missing);
  const lines: ResolvedLine[] = doc.lines.map((l) => ({
    description: l.description,
    amountCents: l.amountCents,
    gstCents: l.gstCents,
    target: map.accounts[l.costCode] as AccountTarget,
  }));
  if (doc.retentionCents > 0) {
    lines.push({
      description: 'Retention',
      amountCents: -doc.retentionCents,
      gstCents: 0,
      target: map.retention,
    });
  }
  return lines;
}
