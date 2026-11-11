import { formatMoney } from '@/shared/lib/format';
import type { TmLineRequest } from '../data/api';

/** Amounts from the financials API are decimal strings, AUD ex GST. */
export const aud = (amount: string) => formatMoney({ amount, currency: 'AUD' });

export const KINDS = [
  { value: 'labour', label: 'Labour', unit: 'hr' },
  { value: 'equipment', label: 'Equipment', unit: 'hr' },
  { value: 'material', label: 'Material', unit: 'ea' },
] as const;
export const KIND_LABEL: Record<string, string> = Object.fromEntries(
  KINDS.map((k) => [k.value, k.label]),
);

const QTY = /^\d{1,8}(\.\d{1,2})?$/;
const MONEY = /^\d{1,16}(\.\d{1,2})?$/;
export const isQty = (v: string) => QTY.test(v.trim()) && Number(v) > 0;
export const isRate = (v: string) => MONEY.test(v.trim());

/** quantity x rate in cents, half up: the same sum the server does, so the screen total matches what is saved. */
export function lineCents(quantity: string, rate: string): number {
  if (!isQty(quantity) || !isRate(rate)) return 0;
  const [qw, qf = ''] = quantity.trim().split('.');
  const [rw, rf = ''] = rate.trim().split('.');
  const q100 = Number(qw) * 100 + Number(qf.padEnd(2, '0'));
  const r100 = Number(rw) * 100 + Number(rf.padEnd(2, '0'));
  return Math.round((q100 * r100) / 100);
}

export const centsToAmount = (c: number) =>
  `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;

export interface DraftLine extends Omit<TmLineRequest, 'quantity' | 'rate'> {
  key: string;
  quantity: string;
  rate: string;
}

export function blankLine(kind: DraftLine['kind'] = 'labour'): DraftLine {
  const unit = KINDS.find((k) => k.value === kind)!.unit;
  return { key: crypto.randomUUID(), kind, description: '', quantity: '', unit, rate: '' };
}

/** First problem with the lines, in the words the person should see, or null. */
export function lineProblem(lines: DraftLine[]): string | null {
  if (lines.length === 0) return 'Add at least one line.';
  for (const [i, l] of lines.entries()) {
    const n = `Line ${i + 1}`;
    if (!l.description.trim()) return `${n}: describe the work.`;
    if (!isQty(l.quantity)) return `${n}: enter a quantity above zero, like 8 or 4.5.`;
    if (!l.unit.trim()) return `${n}: enter a unit, like hr.`;
    if (!isRate(l.rate)) return `${n}: enter the rate ex GST, like 85 or 140.50.`;
  }
  return null;
}

/** The version and wording of the acknowledgement the signer accepts. Change both together (and the version) if the wording changes. */
export const ACK_VERSION = 'tm-sign-v1';
export const ACK_TEXT =
  'I confirm the labour, equipment and materials on this ticket are a true record of the work done, and I understand this signature is recorded against the ticket, with the time and device it was given from.';

export const GEO_LABEL: Record<string, string> = {
  inside: 'on site',
  outside: 'outside the site fence',
  uncertain: 'position not confirmed on site',
  unknown: 'no position recorded',
};

/** The device position, or null if it is refused, unavailable or slow. Signing never waits on it for long. */
export function currentFix(
  timeoutMs = 8000,
): Promise<{ lat: number; lng: number; accuracyM?: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          ...(Number.isFinite(p.coords.accuracy)
            ? { accuracyM: Math.round(p.coords.accuracy) }
            : {}),
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}
