import type { SopaState } from '@archova/domain';

// Public holidays for the SOPA day count, 2026-27 (docs compliance/02 §5). Set for testing: each date must be
// checked against the state gazette before the state goes live (X61). Part-state holidays (VIC Cup Day, the QLD
// Ekka) are listed for the metro / Brisbane case; a site elsewhere needs the place-specific calendar, which is
// not built, so those claims show the metro dates.
const national = [
  '2026-01-01',
  '2026-01-26',
  '2026-12-25',
  '2026-12-28',
  '2027-01-01',
  '2027-01-26',
];
const easter = ['2026-04-03', '2026-04-04', '2026-04-06'];

export const PUBLIC_HOLIDAYS: Record<SopaState, ReadonlySet<string>> = {
  NSW: new Set([...national, ...easter, '2026-06-08', '2026-10-05']),
  VIC: new Set([...national, ...easter, '2026-06-08', '2026-03-09', '2026-11-03']),
  QLD: new Set([...national, ...easter, '2026-05-04', '2026-08-12', '2026-10-05']),
};
