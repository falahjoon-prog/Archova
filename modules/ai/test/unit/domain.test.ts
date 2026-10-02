import { describe, expect, it } from 'vitest';
import { checkCitations } from '../../src/domain/citations';
import {
  creditsFor,
  decideBudget,
  effectiveAllowance,
  TASK_CREDITS,
} from '../../src/domain/credits';
import { extractJson } from '../../src/domain/output';
import {
  DEFAULT_PRICES,
  assertAustralianModelId,
  costMicros,
  isAustralianRegion,
} from '../../src/domain/routing';

const passages = [
  {
    id: 'p1',
    source: { type: 'spec_section', id: 'spec-0431', page: 12, title: 'Spec 0431 Waterproofing' },
    text: 'Wet area membranes shall comply with AS 3740—2021 and extend 150 mm up walls.',
  },
  {
    id: 'p2',
    source: { type: 'drawing_revision', id: 'dwg-a201', page: 1, title: 'A-201 Rev C' },
    text: 'Corridor walls to level 3: FRL 90/90/90 <see detail 4>.',
  },
];

describe('citations (ai/03 §4 step 6)', () => {
  it('accepts quotes that appear in a supplied passage, folding dashes, case, whitespace and escapes', () => {
    const r = checkCitations(
      [
        { passageId: 'p1', quote: 'comply with as 3740-2021  and extend 150 mm' },
        { passageId: 'p2', quote: 'FRL 90/90/90 &lt;see detail 4&gt;' },
        { passageId: 'p1', quote: 'Wet area membranes ... 150 mm up walls' },
      ],
      passages,
    );
    expect(r.invalid).toEqual([]);
    expect(r.valid.map((c) => c.source.id)).toEqual(['spec-0431', 'dwg-a201', 'spec-0431']);
  });

  it('rejects unknown passages and invented quotes', () => {
    const r = checkCitations(
      [
        { passageId: 'p9', quote: 'anything' },
        { passageId: 'p2', quote: 'FRL 120/120/120' },
        { passageId: 'p1', quote: '150 mm up walls ... Wet area membranes' },
      ],
      passages,
    );
    expect(r.valid).toEqual([]);
    expect(r.invalid.map((c) => c.reason)).toEqual([
      'unknown_passage',
      'quote_not_found',
      'quote_not_found',
    ]);
  });
});

describe('credits (ai/05 §4–5)', () => {
  it('prices every phase 1 task and refuses unknown tasks', () => {
    expect(creditsFor('qa.answer')).toBe(1);
    expect(creditsFor('drawing.titleblock')).toBe(0);
    expect(() => creditsFor('nope.task')).toThrow(/No credit price/);
    for (const v of Object.values(TASK_CREDITS)) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('applies the lower of the plan allowance and the org cap', () => {
    expect(effectiveAllowance({ planAllowance: null, orgCap: null })).toBeNull();
    expect(effectiveAllowance({ planAllowance: 500, orgCap: null })).toBe(500);
    expect(effectiveAllowance({ planAllowance: null, orgCap: 40 })).toBe(40);
    expect(effectiveAllowance({ planAllowance: 500, orgCap: 40 })).toBe(40);
  });

  it('stops interactive work at the allowance, warns from 80%, and never stops background work', () => {
    const a = { planAllowance: 100, orgCap: null };
    expect(decideBudget('interactive', 1, { ...a, used: 50 })).toEqual({
      allow: true,
      remaining: 49,
      warn: false,
    });
    expect(decideBudget('interactive', 1, { ...a, used: 79 })).toMatchObject({ warn: true });
    expect(decideBudget('interactive', 1, { ...a, used: 99.5 })).toEqual({
      allow: false,
      reason: 'allowance_used',
    });
    expect(decideBudget('background', 0, { ...a, used: 250 })).toMatchObject({ allow: true });
    expect(
      decideBudget('interactive', 1, { planAllowance: null, orgCap: null, used: 1e9 }),
    ).toEqual({ allow: true, remaining: null, warn: false });
  });
});

describe('routing and residency (X25)', () => {
  it('computes cost in micro-dollars from tokens and $/MTok', () => {
    const usage = {
      inputTokens: 10_000,
      outputTokens: 1_000,
      cacheReadTokens: 20_000,
      cacheWriteTokens: 0,
    };
    // 10k × $2 + 1k × $10 + 20k × $0.20 per MTok = $0.034
    expect(costMicros(usage, DEFAULT_PRICES.standard)).toBe(34_000);
  });

  it('allows only Australian regions and in-region or au. model ids', () => {
    expect(isAustralianRegion('ap-southeast-2')).toBe(true);
    expect(isAustralianRegion('ap-southeast-4')).toBe(true);
    expect(isAustralianRegion('ap-southeast-1')).toBe(false);
    expect(isAustralianRegion('us-east-1')).toBe(false);
    expect(() =>
      assertAustralianModelId('au.anthropic.claude-haiku-4-5-20251001-v1:0'),
    ).not.toThrow();
    expect(() => assertAustralianModelId('anthropic.claude-haiku-4-5-20251001-v1:0')).not.toThrow();
    expect(() => assertAustralianModelId('amazon.titan-embed-text-v2:0')).not.toThrow();
    for (const id of [
      'apac.anthropic.claude-sonnet-4-5-v1:0',
      'us.anthropic.claude-sonnet-4-5-v1:0',
      'global.anthropic.claude-sonnet-4-5-v1:0',
    ])
      expect(() => assertAustralianModelId(id)).toThrow(/outside Australia/);
  });
});

describe('output parsing', () => {
  it('reads bare JSON and a single fenced block', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => extractJson('Sure! {"a":1}')).toThrow();
  });
});
