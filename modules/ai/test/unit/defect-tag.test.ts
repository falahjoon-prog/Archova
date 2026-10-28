import { describe, expect, it } from 'vitest';
import type { DefectTagOutput } from '@archova/ai-prompts';
import {
  duplicateCandidates,
  listsTrade,
  reviewDefectTag,
  suggestCompanies,
  type NearbyDefect,
} from '../../src/domain/defect-tag';

const out = (over: Partial<DefectTagOutput> = {}): DefectTagOutput => ({
  title: 'Paint runs on wall, Bedroom 2',
  description: 'The photo shows runs in the topcoat on the plasterboard wall.',
  trade: 'painting',
  alternativeTrades: [],
  defectType: 'paint_finish',
  priority: 'medium',
  gaps: [],
  ...over,
});

describe('listsTrade', () => {
  it('reads the words a company writes its trades in', () => {
    expect(listsTrade(['Painting & decorating'], 'painting')).toBe(true);
    expect(listsTrade(['Painter'], 'painting')).toBe(true);
    expect(listsTrade(['Hydraulic services'], 'plumbing')).toBe(true);
    expect(listsTrade(['Air-conditioning'], 'mechanical')).toBe(true);
    expect(listsTrade(['Wall and floor tiling'], 'tiling')).toBe(true);
    expect(listsTrade(['Wall and floor tiling'], 'flooring')).toBe(true);
  });
  it('does not match inside another word, or a different trade', () => {
    expect(listsTrade(['Electrical'], 'painting')).toBe(false);
    expect(listsTrade(['Structural steel'], 'reinforcement')).toBe(false);
    expect(listsTrade(['Plasterboard'], 'plastering')).toBe(false);
    expect(listsTrade(['Prefabrication'], 'roofing')).toBe(false);
    expect(listsTrade([], 'painting')).toBe(false);
  });
  it('lets a plasterer cover both plastering and plasterboard', () => {
    expect(listsTrade(['Plasterer'], 'plasterboard')).toBe(true);
    expect(listsTrade(['Plasterer'], 'plastering')).toBe(true);
  });
});

describe('suggestCompanies', () => {
  const companies = [
    { id: 'c1', name: 'Brush Co', trades: ['Painting'] },
    { id: 'c2', name: 'Tile It', trades: ['Tiling', 'Waterproofing'] },
    { id: 'c3', name: 'Coat Pty', trades: ['Painting & decorating'] },
    { id: 'c4', name: 'Sparks', trades: ['Electrical'] },
  ];
  it('lists the suggested trade first, then alternatives, and never picks one', () => {
    expect(suggestCompanies(companies, ['painting', 'waterproofing'])).toEqual([
      { id: 'c1', name: 'Brush Co', trade: 'Painting' },
      { id: 'c3', name: 'Coat Pty', trade: 'Painting' },
      { id: 'c2', name: 'Tile It', trade: 'Waterproofing' },
    ]);
  });
  it('lists nobody when no company on the project has the trade', () => {
    expect(suggestCompanies(companies, ['lifts'])).toEqual([]);
    expect(suggestCompanies(companies, [])).toEqual([]);
  });
});

describe('duplicateCandidates', () => {
  const at = (id: string, x: number, y: number, trade: string | null): NearbyDefect => ({
    id,
    number: 42,
    title: 'Paint runs',
    status: 'open',
    trade,
    assigneeCompanyId: null,
    pin: { x, y },
  });
  it('keeps open defects within reach, nearest first, and marks the same trade', () => {
    const found = duplicateCandidates(
      { x: 0.5, y: 0.5 },
      [
        at('far', 0.9, 0.9, 'Painting'),
        at('b', 0.52, 0.5, 'Electrical'),
        at('a', 0.5, 0.505, 'Painting'),
      ],
      'painting',
    );
    expect(found.map((d) => d.id)).toEqual(['a', 'b']);
    expect(found.map((d) => d.sameTrade)).toEqual([true, false]);
    expect(found[0]!.distance).toBeCloseTo(0.005, 3);
    expect(found[0]!.numberLabel).toBe('DEF-0042');
  });
  it('treats an unknown trade as not the same', () => {
    const [d] = duplicateCandidates({ x: 0.5, y: 0.5 }, [at('a', 0.5, 0.5, null)], 'painting');
    expect(d!.sameTrade).toBe(false);
    const [e] = duplicateCandidates({ x: 0.5, y: 0.5 }, [at('a', 0.5, 0.5, 'Painting')], null);
    expect(e!.sameTrade).toBe(false);
  });
  it('shows at most five', () => {
    const many = Array.from({ length: 9 }, (_, i) => at(`d${i}`, 0.5 + i * 0.001, 0.5, 'Painting'));
    expect(duplicateCandidates({ x: 0.5, y: 0.5 }, many, 'painting')).toHaveLength(5);
  });
});

describe('reviewDefectTag', () => {
  it('lists numbers found in neither the note nor the sheet text', () => {
    const r = reviewDefectTag(
      out({ title: 'Cracked tile 600 x 600, Bed 2', description: 'The photo shows a 3 mm gap.' }),
      { note: 'cracked tile in bed 2', pinText: ['BED 2'] },
    );
    expect(r.unsupportedNumbers.sort()).toEqual(['3', '600']);
    const ok = reviewDefectTag(out({ title: 'Cracked tile 600 x 600' }), {
      note: 'tile 600 x 600 cracked',
      pinText: [],
    });
    expect(ok.unsupportedNumbers).toEqual([]);
  });
  it('asks for a location when neither a note nor a pin gives one, and a trade when none was settled', () => {
    const r = reviewDefectTag(out({ trade: null }), { note: '', pinText: [] });
    expect(r.gaps.sort()).toEqual(['location', 'trade']);
    expect(reviewDefectTag(out(), { note: 'bed 2', pinText: [] }).gaps).toEqual([]);
    expect(reviewDefectTag(out(), { note: '', pinText: ['BED 2'] }).gaps).toEqual([]);
  });
  it('drops an alternative that repeats the trade or another alternative', () => {
    const r = reviewDefectTag(
      out({ alternativeTrades: ['painting', 'plasterboard', 'plasterboard'] }),
      { note: 'x', pinText: [] },
    );
    expect(r.alternativeTrades).toEqual(['plasterboard']);
  });
});
