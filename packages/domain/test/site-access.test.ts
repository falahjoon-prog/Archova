import { describe, expect, it } from 'vitest';
import { directionsUrl, suggestAccessPoint, type AccessPoint } from '../src';

const pt = (
  id: string,
  kind: AccessPoint['kind'],
  usedFor: string[] = [],
  isDefault = false,
): AccessPoint => ({
  id,
  name: id,
  kind,
  usedFor,
  isDefault,
});
const points = [
  pt('Site office', 'site_office', ['visitors'], true),
  pt('Gate 2 (Smith St)', 'gate', ['deliveries', 'concrete']),
  pt('Worker gate', 'gate', ['workers']),
  pt('Royal Hospital', 'hospital'),
];

describe('directionsUrl', () => {
  it('prefers the pin and encodes the destination', () => {
    expect(directionsUrl({ address: '1 A St', point: { lat: -33.86, lng: 151.2 } })).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=-33.86%2C151.2',
    );
    expect(directionsUrl({ address: '1 A St & B' })).toContain('1%20A%20St%20%26%20B');
  });
  it('is null without an address or pin', () => {
    expect(directionsUrl({ address: '  ' })).toBeNull();
  });
});

describe('suggestAccessPoint', () => {
  it('sends concrete trucks to the delivery gate', () => {
    const s = suggestAccessPoint(points, {
      role: 'Concrete pump driver',
      task: 'Level 3 slab pour',
    });
    expect(s?.point.id).toBe('Gate 2 (Smith St)');
    expect(s?.specific).toBe(true);
  });
  it('sends visitors to the office', () => {
    expect(suggestAccessPoint(points, { role: 'Client rep' })?.point.id).toBe('Site office');
  });
  it('sends trades to the worker gate', () => {
    expect(suggestAccessPoint(points, { role: 'Electrician' })?.point.id).toBe('Worker gate');
  });
  it('only suggests the hospital for an emergency', () => {
    expect(suggestAccessPoint(points, { task: 'Injury, needs ambulance' })?.point.id).toBe(
      'Royal Hospital',
    );
    expect(suggestAccessPoint(points, { role: 'Driver' })?.point.kind).not.toBe('hospital');
  });
  it('falls back to the default when nothing matches', () => {
    const s = suggestAccessPoint(points, { role: 'Surveyor' });
    expect(s).toMatchObject({ specific: false, point: { id: 'Site office' } });
  });
  it('falls back when no point fits the arrival', () => {
    const s = suggestAccessPoint([pt('Office', 'site_office', [], true)], { role: 'Truck driver' });
    expect(s).toMatchObject({ specific: false, point: { id: 'Office' } });
  });
  it('has nothing to suggest without points', () => {
    expect(suggestAccessPoint([], { role: 'Driver' })).toBeNull();
  });
});
