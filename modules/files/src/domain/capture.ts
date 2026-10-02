import type { Capture } from '@archova/contracts';
import type { GeoFixSource } from '@archova/domain';

/** Capture columns shared by upload sessions and file objects (infra/tables `captureColumns`). */
export interface CaptureRow {
  takenAt: Date | null;
  takenTz: string | null;
  captureLat: number | null;
  captureLng: number | null;
  captureAccuracyM: number | null;
  captureHeadingDeg: number | null;
  captureSource: GeoFixSource | null;
}

export const NO_CAPTURE: CaptureRow = {
  takenAt: null,
  takenTz: null,
  captureLat: null,
  captureLng: null,
  captureAccuracyM: null,
  captureHeadingDeg: null,
  captureSource: null,
};

/** `timeZone` must already be validated (kernel `resolveTimeZone`). */
export function captureToRow(capture: Capture | undefined, timeZone: string | null): CaptureRow {
  if (!capture) return NO_CAPTURE;
  const loc = capture.location;
  return {
    takenAt: capture.takenAt ? new Date(capture.takenAt) : null,
    takenTz: timeZone,
    captureLat: loc?.lat ?? null,
    captureLng: loc?.lng ?? null,
    captureAccuracyM: loc?.accuracyM ?? null,
    captureHeadingDeg: loc?.headingDeg ?? null,
    captureSource: loc?.source ?? null,
  };
}

export function rowToCapture(row: CaptureRow): Capture | null {
  const capture: Capture = {};
  if (row.takenAt) capture.takenAt = row.takenAt.toISOString();
  if (row.takenTz) capture.timeZone = row.takenTz;
  if (row.captureLat !== null && row.captureLng !== null && row.captureSource) {
    capture.location = {
      lat: row.captureLat,
      lng: row.captureLng,
      accuracyM: row.captureAccuracyM,
      headingDeg: row.captureHeadingDeg,
      source: row.captureSource,
    };
  }
  return Object.keys(capture).length ? capture : null;
}

/** The capture columns of a row, for copying from the upload session onto the file object. */
export const pickCapture = (row: CaptureRow): CaptureRow => ({
  takenAt: row.takenAt,
  takenTz: row.takenTz,
  captureLat: row.captureLat,
  captureLng: row.captureLng,
  captureAccuracyM: row.captureAccuracyM,
  captureHeadingDeg: row.captureHeadingDeg,
  captureSource: row.captureSource,
});
