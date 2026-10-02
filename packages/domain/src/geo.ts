// Locations (X32): WGS 84 decimal degrees, the frame GPS, EXIF and map SDKs all use.
// Stored as `kernel.latitude` / `kernel.longitude` columns; PostGIS arrives with the first spatial query.

export interface GeoPoint {
  lat: number;
  lng: number;
}

export const GEO_FIX_SOURCES = ['device', 'exif', 'manual', 'geocoded'] as const;
export type GeoFixSource = (typeof GEO_FIX_SOURCES)[number];

/** A position recorded against something (a photo, a diary entry, a check-in), with how good it was. */
export interface GeoFix extends GeoPoint {
  /** Horizontal accuracy radius in metres, as reported by the device. */
  accuracyM?: number | null;
  altitudeM?: number | null;
  /** Compass heading, degrees clockwise from true north. */
  headingDeg?: number | null;
  source: GeoFixSource;
}

/** A project's site: a centre point and a radius. Geofenced features (check-ins, auto-tagging) use it. */
export interface SiteGeofence {
  centre: GeoPoint;
  radiusM: number;
}

export const GEOFENCE_RADIUS_LIMITS = { min: 10, max: 10_000 } as const;

export function isGeoPoint(value: unknown): value is GeoPoint {
  if (typeof value !== 'object' || value === null) return false;
  const { lat, lng } = value as Record<string, unknown>;
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres (haversine; within 0.5% of the ellipsoid, plenty for a site fence). */
export function distanceMetres(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Whether a fix is on site. `inside` and `outside` are certain given the fix's accuracy;
 * `uncertain` means the accuracy circle straddles the fence, so callers ask the person rather than decide.
 */
export function geofenceStatus(
  fix: GeoPoint & { accuracyM?: number | null },
  fence: SiteGeofence,
): 'inside' | 'outside' | 'uncertain' {
  const d = distanceMetres(fix, fence.centre);
  const acc = Math.max(0, fix.accuracyM ?? 0);
  if (d + acc <= fence.radiusM) return 'inside';
  if (d - acc > fence.radiusM) return 'outside';
  return 'uncertain';
}
