// Equipment: bookings must not collide and hours are logged to the quarter hour. Pure rules; use cases in application/equipment.

/** Do two inclusive date ranges (`YYYY-MM-DD`) share a day? A booking ending on the 5th and one starting on the 5th do. */
export const datesOverlap = (
  a: { startsOn: string; endsOn: string },
  b: { startsOn: string; endsOn: string },
) => a.startsOn <= b.endsOn && b.startsOn <= a.endsOn;

/** Machines that are being serviced or are retired can't be booked. */
export const bookable = (status: string) => status === 'available' || status === 'in_use';

/** Hours as entered, e.g. `7.5`; whole quarter hours from 0.25 to 24, returned as a two decimal string. */
export function normaliseHours(input: string): string | null {
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(input)) return null;
  const n = Number(input);
  if (n <= 0 || n > 24 || Math.round(n * 4) !== n * 4) return null;
  return n.toFixed(2);
}
