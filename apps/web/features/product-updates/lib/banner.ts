import type { PublicProductUpdate } from '../data/api';

const KEY = 'archova.dismissedProductUpdates';

/** The newest update the owner marked as a banner that this browser has not dismissed. Input is newest first. */
export function pickBanner(
  items: readonly PublicProductUpdate[],
  dismissed: readonly string[],
): PublicProductUpdate | null {
  return items.find((u) => u.banner && !dismissed.includes(u.id)) ?? null;
}

export function readDismissed(): string[] {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function writeDismissed(ids: string[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids.slice(-50)));
  } catch {
    // Storage can be blocked; the banner then simply returns on the next visit.
  }
}
