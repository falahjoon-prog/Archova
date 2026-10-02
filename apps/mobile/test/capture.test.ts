import { describe, expect, it } from 'vitest';
import { localDateOf } from '@archova/time';
import {
  buildCapture,
  deviceTimeZone,
  MAX_FIX_AGE_MS,
  positionToFix,
  type DevicePosition,
} from '../lib/capture/capture';

const takenAt = new Date('2026-10-02T23:30:00.000Z'); // 9:30 am on 3 Oct in Brisbane
const position = (over: Partial<DevicePosition['coords']> = {}, ageMs = 5_000): DevicePosition => ({
  coords: { latitude: -27.4698, longitude: 153.0251, accuracy: 8, heading: -1, ...over },
  timestamp: takenAt.getTime() - ageMs,
});

describe('capture', () => {
  it('records the instant, the device zone and the fix as the device reported them', () => {
    const capture = buildCapture({
      takenAt,
      timeZone: 'Australia/Brisbane',
      position: position(),
      compassHeading: 371.5,
    });
    expect(capture).toEqual({
      takenAt: '2026-10-02T23:30:00.000Z',
      timeZone: 'Australia/Brisbane',
      location: {
        lat: -27.4698,
        lng: 153.0251,
        accuracyM: 8,
        headingDeg: 11.5,
        source: 'device',
      },
    });
    // The instant is unambiguous; which day it is depends on the zone it is shown in.
    expect(localDateOf(capture.takenAt!, 'Australia/Brisbane')).toBe('2026-10-03');
    expect(localDateOf(capture.takenAt!, 'Australia/Perth')).toBe('2026-10-03');
    expect(localDateOf(capture.takenAt!, 'UTC')).toBe('2026-10-02');
  });

  it('leaves the location out rather than guess', () => {
    expect(positionToFix(null, takenAt)).toBeNull();
    expect(positionToFix(position({}, MAX_FIX_AGE_MS + 1), takenAt)).toBeNull();
    expect(positionToFix(position({ accuracy: 2_000 }), takenAt)).toBeNull();
    expect(positionToFix(position({ latitude: Number.NaN }), takenAt)).toBeNull();
    expect(buildCapture({ takenAt, timeZone: null, position: null })).toEqual({
      takenAt: '2026-10-02T23:30:00.000Z',
    });
  });

  it('treats a negative heading as unknown', () => {
    expect(positionToFix(position({ heading: -1 }), takenAt)?.headingDeg).toBeNull();
    expect(positionToFix(position({ heading: 90 }), takenAt)?.headingDeg).toBe(90);
  });

  it('reads the device zone and rejects invalid ones', () => {
    expect(deviceTimeZone(() => 'Australia/Sydney')).toBe('Australia/Sydney');
    expect(deviceTimeZone(() => 'Not/AZone')).toBeNull();
    expect(deviceTimeZone(() => undefined)).toBeNull();
  });
});
