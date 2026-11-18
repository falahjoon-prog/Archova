const CATEGORY: Record<string, string> = {
  crane: 'Crane',
  excavator: 'Excavator',
  loader: 'Loader',
  truck: 'Truck',
  generator: 'Generator',
  access_platform: 'Access platform',
  compaction: 'Compaction',
  lighting: 'Lighting',
  other: 'Other',
};

export const categoryLabel = (c: string) => CATEGORY[c] ?? c;

/** "Excavator, owned" or "Crane, hired from Acme Hire". */
export function assetSubtitle(a: {
  category: string;
  ownership: string;
  supplier: string | null;
  status: string;
}): string {
  const own = a.ownership === 'hired' && a.supplier ? `hired from ${a.supplier}` : a.ownership;
  const status =
    a.status === 'maintenance' ? 'in the workshop' : a.status === 'retired' ? 'retired' : null;
  return [categoryLabel(a.category), own, status].filter(Boolean).join(', ');
}

const day = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/** "9 Nov to 13 Nov", or a single day. */
export const allocationRange = (startsOn: string, endsOn: string) =>
  startsOn === endsOn ? day(startsOn) : `${day(startsOn)} to ${day(endsOn)}`;
