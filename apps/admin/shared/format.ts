import type { PriceUnit, RequestStatus } from '@archova/contracts';
import { localDateOf, startOfLocalDay } from '@archova/time';
import type { StatusTone } from '@archova/ui';

/** Every console date is shown in Australian Eastern time, the owner's zone (conventions §Time). */
export const CONSOLE_TIME_ZONE = 'Australia/Sydney';

const dateTime = new Intl.DateTimeFormat('en-AU', {
  timeZone: CONSOLE_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const dateOnly = new Intl.DateTimeFormat('en-AU', {
  timeZone: CONSOLE_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export const formatDateTime = (iso: string | null) => (iso ? dateTime.format(new Date(iso)) : '—');
export const formatDate = (iso: string | null) => (iso ? dateOnly.format(new Date(iso)) : '—');

/** `2027-01-05` ⇄ the instant that local day starts in Sydney. */
export const toDateInput = (iso: string | null) =>
  iso ? localDateOf(new Date(iso), CONSOLE_TIME_ZONE) : '';
export const fromDateInput = (date: string) =>
  date
    ? startOfLocalDay(
        date as Parameters<typeof startOfLocalDay>[0],
        CONSOLE_TIME_ZONE,
      ).toISOString()
    : null;

const aud0 = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  currencyDisplay: 'narrowSymbol',
  maximumFractionDigits: 0,
});
const aud2 = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  currencyDisplay: 'narrowSymbol',
});

export function formatMoney(cents: number | null): string {
  if (cents === null) return '—';
  const dollars = cents / 100;
  return (Number.isInteger(dollars) ? aud0 : aud2).format(dollars).replace(/^\$/, 'A$');
}

export const UNIT_LABEL: Record<PriceUnit, string> = {
  free: 'Free',
  user_month: 'Per user, per month',
  year: 'Per year',
};

export function formatPrice(
  p: { unit: PriceUnit; fromPrice: boolean; amountCents: number | null } | null,
): string {
  if (!p) return '—';
  if (p.unit === 'free') return 'Free';
  const suffix = p.unit === 'user_month' ? ' per user per month' : ' per year';
  return `${p.fromPrice ? 'From ' : ''}${formatMoney(p.amountCents)}${suffix}`;
}

export const STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  executed: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  draft: 'Draft',
  pending_approval: 'Waiting for approval',
  scheduled: 'Scheduled',
  published: 'Live',
  retired: 'Retired',
};

export const statusTone = (s: string): StatusTone =>
  s === 'executed' || s === 'published'
    ? 'success'
    : s === 'pending' || s === 'pending_approval' || s === 'scheduled'
      ? 'warning'
      : s === 'rejected' || s === 'failed'
        ? 'danger'
        : 'neutral';

export const REQUEST_STATUS_OPTIONS: Array<{ value: '' | RequestStatus; label: string }> = [
  { value: 'pending', label: 'Waiting for approval' },
  { value: 'executed', label: 'Done' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'failed', label: 'Failed' },
];

export const planStateLabel = (s: string) =>
  s === 'trialing' ? 'Trial' : s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
