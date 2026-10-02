// When and where something was captured (conventions §Time and §Location, X34): the instant, the device's IANA
// zone and the GPS fix as the device reported them. Screens show times in the project's zone with
// @archova/time; what is stored and sent is exactly what the device said.

import { CaptureSchema, type Capture, type GeoFix } from '@archova/contracts';
import { normalizeTimeZone } from '@archova/time';

/** A position as expo-location reports it (`LocationObject`), reduced to what we use. */
export interface DevicePosition {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    altitude?: number | null;
    heading?: number | null;
  };
  /** Epoch ms the fix was taken. */
  timestamp: number;
}

/** A fix older than this at capture time is not this photo's location. */
export const MAX_FIX_AGE_MS = 2 * 60_000;
/** Worse than this and the fix says little about where on site the photo was taken. */
export const MAX_FIX_ACCURACY_M = 500;

/** The device's IANA zone; null if the runtime reports none or an invalid one. */
export function deviceTimeZone(
  resolve: () => string | undefined = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
): string | null {
  const zone = resolve();
  return zone ? normalizeTimeZone(zone) : null;
}

function normaliseHeading(heading: number | null | undefined): number | null {
  if (heading === null || heading === undefined || !Number.isFinite(heading) || heading < 0) {
    return null; // iOS and Android report -1 when the heading is unknown
  }
  return heading % 360;
}

/** Turn a device fix into the API's GeoFix, or null if it is missing, stale or too vague to be useful. */
export function positionToFix(
  position: DevicePosition | null,
  takenAt: Date,
  compassHeading?: number | null,
): GeoFix | null {
  if (!position) return null;
  const { latitude, longitude, accuracy } = position.coords;
  if (Math.abs(takenAt.getTime() - position.timestamp) > MAX_FIX_AGE_MS) return null;
  if (accuracy !== null && accuracy > MAX_FIX_ACCURACY_M) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return {
    lat: latitude,
    lng: longitude,
    accuracyM: accuracy !== null && accuracy >= 0 ? accuracy : null,
    headingDeg: normaliseHeading(compassHeading ?? position.coords.heading),
    source: 'device',
  };
}

/** The `capture` block sent with an upload and stored on the record. */
export function buildCapture(input: {
  takenAt: Date;
  timeZone: string | null;
  position: DevicePosition | null;
  compassHeading?: number | null;
}): Capture {
  const fix = positionToFix(input.position, input.takenAt, input.compassHeading);
  const capture: Capture = { takenAt: input.takenAt.toISOString() };
  if (input.timeZone) capture.timeZone = input.timeZone;
  if (fix) capture.location = fix;
  return CaptureSchema.parse(capture);
}
