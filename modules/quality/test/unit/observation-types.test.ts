import { describe, expect, it } from 'vitest';
import {
  customKey,
  pickerGroups,
  resolveTypes,
  suggestType,
  typeProblem,
  type TypeRow,
} from '../../src/domain/observation-types';

const row = (over: Partial<TypeRow>): TypeRow => ({
  id: 'r1',
  projectId: null,
  key: null,
  group: null,
  name: null,
  category: null,
  requiresAttachment: null,
  hidden: false,
  ...over,
});

describe('resolveTypes', () => {
  it('offers the built-in catalogue, with Safety Hazard needing an attachment', () => {
    const t = resolveTypes([], 'p1');
    expect(t.find((x) => x.key === 'safety_hazard')).toMatchObject({
      requiresAttachment: true,
      group: 'Safety',
      builtIn: true,
    });
    expect(t.find((x) => x.key === 'hold_point')?.requiresAttachment).toBe(false);
  });
  it('lets a project override beat the organisation override', () => {
    const t = resolveTypes(
      [
        row({ id: 'o', key: 'hold_point', requiresAttachment: true }),
        row({ id: 'p', projectId: 'p1', key: 'hold_point', requiresAttachment: false }),
        row({ id: 'q', projectId: 'p2', key: 'hold_point', hidden: true }),
      ],
      'p1',
    );
    expect(t.find((x) => x.key === 'hold_point')).toMatchObject({
      requiresAttachment: false,
      hidden: false,
    });
  });
  it('adds custom types from the organisation and this project only', () => {
    const t = resolveTypes(
      [
        row({ id: 'a', name: 'Waterproofing', category: 'quality', group: 'Quality' }),
        row({ id: 'b', projectId: 'p2', name: 'Other site', category: 'quality' }),
      ],
      'p1',
    );
    expect(t.find((x) => x.key === customKey('a'))).toMatchObject({
      builtIn: false,
      name: 'Waterproofing',
    });
    expect(t.some((x) => x.name === 'Other site')).toBe(false);
  });
});

describe('pickerGroups', () => {
  const types = resolveTypes([row({ id: 'h', key: 'conforming', hidden: true })], 'p1');
  it('puts recents first and drops hidden types', () => {
    const g = pickerGroups(types, ['hold_point', 'safety_hazard', 'conforming'], '');
    expect(g[0]).toMatchObject({ group: 'Recents' });
    expect(g[0]!.types.map((t) => t.key)).toEqual(['hold_point', 'safety_hazard']);
    expect(g.flatMap((x) => x.types).some((t) => t.key === 'conforming')).toBe(false);
  });
  it('searches by type or group name', () => {
    const g = pickerGroups(types, [], 'hold');
    expect(g).toHaveLength(1);
    expect(g[0]!.types[0]!.key).toBe('hold_point');
  });
});

describe('typeProblem', () => {
  it('refuses a type that needs an attachment when there is none', () => {
    const hazard = resolveTypes([], 'p1').find((x) => x.key === 'safety_hazard')!;
    expect(typeProblem(hazard, 0)?.code).toBe('observation.attachment_required');
    expect(typeProblem(hazard, 1)).toBeNull();
  });
});

describe('suggestType', () => {
  const types = resolveTypes([], 'p1');
  it('prefers what people chose before for the same item', () => {
    expect(
      suggestType(types, {
        prompt: 'Areas are clean',
        section: 'Housekeeping',
        history: ['quality_finding', 'quality_finding', 'hold_point'],
      }),
    ).toEqual({ key: 'quality_finding', reason: 'previous_observations' });
  });
  it('falls back to words in the item', () => {
    expect(
      suggestType(types, { prompt: 'Edge protection in place', section: 'Safety', history: [] }),
    ).toEqual({
      key: 'safety_hazard',
      reason: 'keywords',
    });
  });
  it('says nothing when nothing fits', () => {
    expect(suggestType(types, { prompt: 'Colour', section: 'Paint', history: [] })).toBeNull();
  });
});
