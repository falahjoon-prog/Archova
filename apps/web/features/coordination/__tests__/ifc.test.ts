import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { IfcAPI } from 'web-ifc';
import { detectClashes } from '../lib/clash';
import { createIfcApi, friendlyType, parseIfc } from '../viewer/ifc';

const fixture = readFileSync(fileURLToPath(new URL('./fixtures/two-boxes.ifc', import.meta.url)));

let api: IfcAPI;
beforeAll(async () => {
  api = await createIfcApi();
}, 60_000);

describe('parseIfc', () => {
  it('reads elements with their GlobalId, name, type and bounds', () => {
    const els = parseIfc(api, new Uint8Array(fixture));
    expect(els.map((e) => e.guid).sort()).toEqual([
      '1aaaaaaaaaaaaaaaaaaaaa',
      '2bbbbbbbbbbbbbbbbbbbbb',
    ]);
    const wall = els.find((e) => e.name === 'Wall A')!;
    expect(wall.ifcType).toBe('IFCWALL');
    expect(wall.box.max[1] - wall.box.min[1]).toBeCloseTo(3, 3);
  });

  it('feeds clash detection across two models', () => {
    const els = parseIfc(api, new Uint8Array(fixture));
    const a = els.filter((e) => e.name === 'Wall A').map((e) => ({ ...e, modelId: 'arch' }));
    const b = els.filter((e) => e.name === 'Duct B').map((e) => ({ ...e, modelId: 'mech' }));
    const { clashes } = detectClashes([...a, ...b]);
    expect(clashes).toHaveLength(1);
    expect(clashes[0]!.volume).toBeGreaterThan(0);
  });

  it('refuses bytes that are not IFC', () => {
    expect(() => parseIfc(api, new TextEncoder().encode('not a model'))).toThrow();
  });

  it('names types in plain words', () => {
    expect(friendlyType('IFCDUCTSEGMENT')).toBe('Ductsegment');
  });
});
