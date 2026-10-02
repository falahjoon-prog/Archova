import { describe, expect, it } from 'vitest';
import { distanceMetres, geofenceStatus, isGeoPoint } from '../src';

const sydneyOperaHouse = { lat: -33.8568, lng: 151.2153 };
const sydneyHarbourBridge = { lat: -33.8523, lng: 151.2108 };
const perth = { lat: -31.9523, lng: 115.8613 };

describe('geo', () => {
  it('validates points', () => {
    expect(isGeoPoint(sydneyOperaHouse)).toBe(true);
    expect(isGeoPoint({ lat: -91, lng: 0 })).toBe(false);
    expect(isGeoPoint({ lat: Number.NaN, lng: 0 })).toBe(false);
    expect(isGeoPoint({ lat: '1', lng: 0 })).toBe(false);
  });

  it('measures distance', () => {
    expect(distanceMetres(sydneyOperaHouse, sydneyHarbourBridge)).toBeGreaterThan(600);
    expect(distanceMetres(sydneyOperaHouse, sydneyHarbourBridge)).toBeLessThan(700);
    expect(distanceMetres(sydneyOperaHouse, perth) / 1000).toBeCloseTo(3290, -1);
  });

  it('allows for GPS accuracy at the fence line', () => {
    const fence = { centre: sydneyOperaHouse, radiusM: 700 };
    expect(geofenceStatus({ ...sydneyHarbourBridge, accuracyM: 5 }, fence)).toBe('inside');
    expect(geofenceStatus({ ...sydneyHarbourBridge, accuracyM: 100 }, fence)).toBe('uncertain');
    expect(geofenceStatus(perth, fence)).toBe('outside');
  });
});
