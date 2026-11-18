export const KIND_TEXT: Record<string, string> = {
  building_permit: 'Building permit',
  development_approval: 'Development approval',
  construction_certificate: 'Construction certificate',
  occupation_certificate: 'Occupation certificate',
  council_approval: 'Council approval',
  planning_permit: 'Planning permit',
  environmental_permit: 'Environmental permit',
  road_occupancy: 'Road occupancy',
  traffic_management: 'Traffic management',
  crane_hoist: 'Crane and hoist',
  demolition: 'Demolition',
  hot_work: 'Hot work',
  trade_licence: 'Trade licence',
  other: 'Other',
};

export const STATUS_TEXT: Record<string, string> = {
  active: 'Active',
  expiring_soon: 'Expiring soon',
  expired: 'Expired',
  renewal_in_progress: 'Renewal in progress',
  closed: 'Closed',
};

/** "12 Nov 2026". Dates are project-local days, so no zone maths here. */
export function dayText(date: string | null): string {
  if (!date) return 'none';
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "Expires in 12 days", "Expired 3 days ago", or "No expiry date". */
export function expiryText(daysToExpiry: number | null): string {
  if (daysToExpiry === null) return 'No expiry date';
  if (daysToExpiry === 0) return 'Expires today';
  const n = Math.abs(daysToExpiry);
  const unit = n === 1 ? 'day' : 'days';
  return daysToExpiry > 0 ? `Expires in ${n} ${unit}` : `Expired ${n} ${unit} ago`;
}

/** One line for a register row: number, kind, status and how long is left. */
export function permitSubtitle(p: {
  numberLabel: string;
  kind: string;
  status: string;
  daysToExpiry: number | null;
  lifecycle: string;
}): string {
  const base = `${p.numberLabel}, ${KIND_TEXT[p.kind] ?? p.kind}, ${STATUS_TEXT[p.status] ?? p.status}`;
  return p.lifecycle === 'closed' ? base : `${base}. ${expiryText(p.daysToExpiry)}`;
}

export const EVENT_TEXT: Record<string, string> = {
  create: 'Added to the register',
  startRenewal: 'Renewal started',
  markRenewed: 'Renewed',
  close: 'Closed',
  reopen: 'Reopened',
};
