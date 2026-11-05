// Budget arithmetic in whole cents. Unlike claim money, budget changes can be negative.

import { fromCents, toCents } from './money';

const SIGNED = /^-?\d{1,16}(\.\d{1,2})?$/;

export const isSignedMoney = (v: string) => SIGNED.test(v);

/** Cents from a signed decimal string such as `-250.50`. */
export function signedCents(v: string): number {
  return v.startsWith('-') ? -toCents(v.slice(1)) : toCents(v);
}

export interface LineAmounts {
  original: string;
  approvedChanges: string;
  committed: string;
  actual: string;
  forecastToComplete: string;
}

export const revisedOf = (l: Pick<LineAmounts, 'original' | 'approvedChanges'>) =>
  fromCents(signedCents(l.original) + signedCents(l.approvedChanges));

export function totalsOf(lines: LineAmounts[]) {
  const sum = (pick: (l: LineAmounts) => string) =>
    fromCents(lines.reduce((n, l) => n + signedCents(pick(l)), 0));
  return {
    original: sum((l) => l.original),
    approvedChanges: sum((l) => l.approvedChanges),
    revised: sum(revisedOf),
    committed: sum((l) => l.committed),
    actual: sum((l) => l.actual),
    forecastToComplete: sum((l) => l.forecastToComplete),
  };
}
