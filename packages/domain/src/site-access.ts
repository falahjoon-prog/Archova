// Site directions and access (project locations): the "Get Directions" link and Nova's rule-based pick of the
// access point that fits who is arriving. No maps API or key is involved, and no model call.

import type { GeoPoint } from './geo';

export const LOCATION_KINDS = [
  'site_office',
  'gate',
  'laydown',
  'parking',
  'hospital',
  'other',
] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export interface AccessPoint {
  id: string;
  name: string;
  kind: LocationKind;
  /** Short words for what the point is for, e.g. "deliveries", "visitors". */
  usedFor: readonly string[];
  isDefault: boolean;
}

/** A plain maps link that opens turn-by-turn directions. Prefers the pin; falls back to the address. */
export function directionsUrl(p: {
  address?: string | null;
  point?: GeoPoint | null;
}): string | null {
  const destination = p.point ? `${p.point.lat},${p.point.lng}` : p.address?.trim();
  if (!destination) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

export interface Arrival {
  /** Trade or role, e.g. "Concrete pump driver", "Client rep". */
  role?: string | null;
  /** Today's task or reason for the visit, e.g. "Level 3 slab pour". */
  task?: string | null;
}

/** What a kind of arrival needs: words that identify them, the tags a matching point carries, and the point kinds that suit. */
const PROFILES: ReadonlyArray<{
  id: string;
  words: readonly string[];
  tags: readonly string[];
  kinds: readonly LocationKind[];
  why: string;
}> = [
  {
    id: 'emergency',
    words: ['emergency', 'injury', 'injured', 'first aid', 'ambulance'],
    tags: ['emergency', 'hospital'],
    kinds: ['hospital'],
    why: 'an emergency needs the nearest hospital',
  },
  {
    id: 'delivery',
    words: [
      'deliver',
      'truck',
      'driver',
      'concrete',
      'pump',
      'crane',
      'excavat',
      'skip',
      'steel',
      'formwork',
      'materials',
      'haul',
      'cartage',
    ],
    tags: ['delivery', 'deliveries', 'trucks', 'concrete', 'materials', 'heavy'],
    kinds: ['gate', 'laydown'],
    why: 'deliveries and heavy vehicles use the delivery entrance',
  },
  {
    id: 'visitor',
    words: [
      'visitor',
      'client',
      'inspector',
      'certifier',
      'consultant',
      'architect',
      'engineer',
      'auditor',
      'tour',
    ],
    tags: ['visitor', 'visitors', 'inspection', 'inspections', 'client'],
    kinds: ['site_office', 'parking'],
    why: 'visitors sign in at the site office',
  },
  {
    id: 'trade',
    words: [
      'labour',
      'trade',
      'electric',
      'plumb',
      'carpent',
      'tiler',
      'painter',
      'framer',
      'crew',
      'induction',
      'worker',
    ],
    tags: ['workers', 'trades', 'staff', 'crew', 'induction'],
    kinds: ['gate', 'parking'],
    why: 'workers use the main worker gate',
  },
];

export interface AccessSuggestion<P extends AccessPoint = AccessPoint> {
  point: P;
  /** One sentence the person can read before confirming. */
  reason: string;
  /** False when nothing matched and the project's default point is offered. */
  specific: boolean;
}

/**
 * Nova's rule for the access point that fits who is arriving. The role and the day's task are matched to a kind of
 * arrival (delivery, visitor, trade, emergency), then to the points that say they are for it (their tags), then to
 * the kind of point. Nothing matched: the default point. The person always confirms; this only proposes.
 */
export function suggestAccessPoint<P extends AccessPoint>(
  points: readonly P[],
  arrival: Arrival,
): AccessSuggestion<P> | null {
  if (!points.length) return null;
  const text = `${arrival.role ?? ''} ${arrival.task ?? ''}`.toLowerCase();
  const profile = PROFILES.find((pr) => pr.words.some((w) => text.includes(w)));
  const fallback = (): AccessSuggestion<P> | null => {
    const point =
      points.find((p) => p.isDefault) ?? points.find((p) => p.kind === 'site_office') ?? points[0];
    return point
      ? {
          point,
          reason: `No access point is marked for this, so the default is ${point.name}.`,
          specific: false,
        }
      : null;
  };
  if (!profile) return fallback();

  let best: { point: P; score: number } | null = null;
  for (const p of points) {
    // A hospital is only ever suggested for an emergency.
    if (p.kind === 'hospital' && profile.id !== 'emergency') continue;
    const tagHit = p.usedFor.some((t) => {
      const tag = t.toLowerCase();
      return profile.tags.some((x) => tag.includes(x) || x.includes(tag)) || text.includes(tag);
    });
    const kindRank = profile.kinds.indexOf(p.kind);
    const score =
      (tagHit ? 4 : 0) + (kindRank >= 0 ? 2 - kindRank * 0.5 : 0) + (p.isDefault ? 0.1 : 0);
    if (score >= 1.5 && (!best || score > best.score)) best = { point: p, score };
  }
  if (!best) return fallback();
  return {
    point: best.point,
    reason: `${profile.why[0]!.toUpperCase()}${profile.why.slice(1)}.`,
    specific: true,
  };
}
