// Translation catalogues and formatting (AU first). Formatting uses the project's IANA timezone (conventions §Time).

export const DEFAULT_LOCALE = 'en-AU';

export function formatDate(iso: string, timeZone: string, locale = DEFAULT_LOCALE): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

export function formatDateTime(iso: string, timeZone: string, locale = DEFAULT_LOCALE): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** Money arrives from the API as `{ amount: "12345.67", currency: "AUD" }`; never parse to float for maths. */
export function formatMoney(
  m: { amount: string; currency: string },
  locale = DEFAULT_LOCALE,
): string {
  const [whole = '0', cents = '00'] = m.amount.replace('-', '').split('.');
  const sign = m.amount.startsWith('-') ? '-' : '';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const symbol =
    new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency })
      .formatToParts(0)
      .find((p) => p.type === 'currency')?.value ?? m.currency;
  return `${sign}${symbol}${grouped}.${cents.padEnd(2, '0').slice(0, 2)}`;
}
