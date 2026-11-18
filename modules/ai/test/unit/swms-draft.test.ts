import { describe, expect, it } from 'vitest';
import type { SwmsDraftOutput, SwmsHrcw } from '@archova/ai-prompts';
import { isVague, reviewSwmsDraft, toSwmsContent, hasClaim } from '../../src/domain/swms-draft';

const INPUT =
  '14 Harbour Street, Pyrmont NSW\nInstall edge protection\nLevel 3 slab north edge\nHoist then stair at grid C\nTower crane\nSteel fixers';
const base = (over: Partial<SwmsDraftOutput> = {}): SwmsDraftOutput => ({
  workDescription: 'Install edge protection at 14 Harbour Street, Pyrmont.',
  hazards: [
    { category: 'fall_2m', hazard: 'Open slab edge', risk: 'A worker falls to the level below.' },
  ],
  controls: [
    {
      category: 'fall_2m',
      level: 'administrative',
      description: 'The supervisor checks the edge protection before each shift.',
    },
    {
      category: 'fall_2m',
      level: 'engineer',
      description: 'Install edge protection on every open edge of the level 3 slab.',
    },
  ],
  implementation:
    'The supervisor checks controls each shift and reviews this SWMS when the work changes.',
  siteSpecific:
    'Pyrmont site, Level 3 slab north edge, tower crane and steel fixers working nearby.',
  fallControlsConsidered: null,
  gaps: [],
  references: [],
  ...over,
});
const ctx = (categories: SwmsHrcw[] = ['fall_2m']) => ({
  inputText: INPUT,
  categories,
  passageText: new Map<string, string>(),
  citations: [],
});

describe('SWMS draft review (compliance/08 §3)', () => {
  it('orders controls by the hierarchy and builds SWMS content', () => {
    const r = reviewSwmsDraft(base(), ctx());
    expect(r.controls.map((c) => c.level)).toEqual(['engineer', 'administrative']);
    const content = toSwmsContent(r, { fall_2m: 'Falls over 2 m' }, true);
    expect(content.controlMeasures).toHaveLength(2);
    expect(content.hazardsAndRisks).toBe(
      'Falls over 2 m: Open slab edge. A worker falls to the level below.',
    );
    expect(content.whsPlanApplies).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('removes vague controls and claims, and keeps them out of the content', () => {
    const r = reviewSwmsDraft(
      base({
        controls: [
          {
            category: 'fall_2m',
            level: 'ppe',
            description: 'Use appropriate PPE as required for the job.',
          },
          {
            category: 'fall_2m',
            level: 'engineer',
            description: 'Install edge protection on every open edge of the slab.',
          },
          {
            category: 'fall_2m',
            level: 'engineer',
            description: 'This makes the slab edge fully safe for all workers.',
          },
        ],
      }),
      ctx(),
    );
    expect(r.controls).toHaveLength(1);
    expect(r.warnings.map((w) => w.code).sort()).toEqual([
      'banned_wording_removed',
      'vague_control_removed',
    ]);
  });

  it('drops anything outside the chosen high-risk codes', () => {
    const r = reviewSwmsDraft(
      base({
        hazards: [
          { category: 'fall_2m', hazard: 'Open slab edge', risk: 'A worker falls.' },
          { category: 'asbestos', hazard: 'Fibres', risk: 'Exposure.' },
        ],
      }),
      ctx(),
    );
    expect(r.hazards.map((h) => h.category)).toEqual(['fall_2m']);
    expect(
      r.warnings.some((w) => w.code === 'out_of_scope_removed' && w.category === 'asbestos'),
    ).toBe(true);
  });

  it('flags a code with no hazard or control, and an unchecked number, without fixing them', () => {
    const r = reviewSwmsDraft(
      base({
        hazards: [],
        controls: [
          {
            category: 'mobile_plant',
            level: 'isolate',
            description: 'Keep a 6 m exclusion zone around the crane.',
          },
        ],
      }),
      ctx(['fall_2m', 'mobile_plant']),
    );
    const codes = r.warnings.map((w) => `${w.code}:${w.category ?? ''}`);
    expect(codes).toContain('category_without_hazard:fall_2m');
    expect(codes).toContain('category_without_control:fall_2m');
    expect(codes).toContain('category_without_hazard:mobile_plant');
    expect(codes.some((c) => c.startsWith('unverified_number'))).toBe(true);
  });

  it('allows the 2 m threshold and numbers from the inputs, and asks for fall controls when only admin or PPE are used', () => {
    const r = reviewSwmsDraft(
      base({
        controls: [
          {
            category: 'fall_2m',
            level: 'administrative',
            description: 'Workers over 2 m clip on at grid C before they step out.',
          },
        ],
      }),
      ctx(),
    );
    expect(r.warnings.map((w) => w.code)).toEqual([
      'only_admin_or_ppe',
      'fall_controls_not_recorded',
    ]);
  });

  it('flags a site section that fits any site', () => {
    const r = reviewSwmsDraft(
      base({ siteSpecific: 'Work is done carefully by trained workers.' }),
      ctx(),
    );
    expect(r.warnings.map((w) => w.code)).toContain('not_site_specific');
  });

  it('never accepts claims of compliance', () => {
    expect(hasClaim('This SWMS is compliant with the regulation.')).toBe(true);
    expect(hasClaim('Workers must comply with the exclusion zone.')).toBe(false);
    expect(isVague('Wear suitable PPE.')).toBe(true);
    expect(isVague('Install edge protection on every open edge before formwork is stripped.')).toBe(
      false,
    );
  });
});
