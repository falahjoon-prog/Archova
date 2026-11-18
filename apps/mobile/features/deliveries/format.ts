export function deliveryWindow(startIso: string, endIso: string, zone: string): string {
  const day = new Date(startIso).toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: zone,
  });
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-AU', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: zone,
    });
  return `${day}, ${time(startIso)} to ${time(endIso)}`;
}

const STATUS: Record<string, string> = {
  scheduled: 'scheduled',
  arrived: 'on site',
  unloaded: 'unloaded',
  delayed: 'delayed',
  missed: 'missed',
  cancelled: 'cancelled',
};

export const deliveryStatusLabel = (s: string) => STATUS[s] ?? s;

/** "Concrete pump, 2 items" style summary of what is coming. */
export function itemsSummary(
  items: readonly { description: string; quantity?: string | null; unit?: string | null }[],
) {
  return items.map((i) => [i.quantity, i.unit, i.description].filter(Boolean).join(' ')).join(', ');
}

/** Which check-in a site person can log next: arrival first, then unloaded. */
export function nextCheckIn(status: string): 'arrived' | 'unloaded' | null {
  if (status === 'scheduled' || status === 'delayed') return 'arrived';
  if (status === 'arrived') return 'unloaded';
  return null;
}

export const checkInLabel = (e: 'arrived' | 'unloaded') =>
  e === 'arrived' ? 'Truck arrived' : 'Unloaded';

export function deliverySubtitle(
  d: { supplierName: string; windowStart: string; windowEnd: string; status: string },
  zone: string,
): string {
  return [
    d.supplierName,
    deliveryWindow(d.windowStart, d.windowEnd, zone),
    deliveryStatusLabel(d.status),
  ].join(', ');
}
