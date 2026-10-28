// F5 defect photo tagging (ai/01 F5): the rules around the model's suggestion. Pure, no IO. The model suggests a
// trade, a title and a priority; code finds who to assign it to (companies on the project with that trade) and which
// open defects are already pinned nearby, so neither can be invented. The person checks all of it before saving.
import {
  DEFECT_TRADES,
  DEFECT_TYPES,
  type DefectTagGap,
  type DefectTagOutput,
  type DefectTradeId,
  type DefectTypeId,
} from '@archova/ai-prompts';
import { defectLabel } from '@archova/domain';
import { normaliseForMatch } from './citations';
import { numbersIn } from './diary-summary';

/**
 * Beginnings of the words a company writes its trades in ("Painting & decorating", "Hydraulic services") that mean
 * each trade. Matched at the start of a word, so "paint" covers painter and painting.
 */
const TRADE_STEMS: Record<DefectTradeId, readonly string[]> = {
  concrete: ['concret'],
  formwork: ['formwork', 'form work'],
  reinforcement: ['reinforc', 'steel fix', 'rebar'],
  structural_steel: ['structural steel', 'steel erect', 'steelwork', 'steel fabric'],
  masonry: ['brick', 'block', 'mason'],
  carpentry: ['carpent', 'framing', 'framer'],
  roofing: ['roof'],
  cladding: ['cladding', 'facade', 'façade'],
  glazing: ['glaz', 'window', 'glass'],
  waterproofing: ['waterproof'],
  plastering: ['plasterer', 'plastering', 'render'],
  plasterboard: ['plasterboard', 'plasterer', 'drywall', 'gyprock', 'ceiling'],
  painting: ['paint', 'decorat'],
  tiling: ['tile', 'tiling', 'tiler'],
  flooring: ['floor', 'carpet'],
  joinery: ['joinery', 'joiner', 'cabinet'],
  doors: ['door', 'hardware'],
  plumbing: ['plumb', 'hydraulic'],
  electrical: ['electric'],
  mechanical: ['mechanical', 'hvac', 'air con', 'air-con', 'refrigerat', 'ventilat'],
  fire_services: ['fire', 'sprinkler'],
  lifts: ['lift', 'elevator'],
  landscaping: ['landscap', 'garden'],
  civil: ['civil', 'drainage', 'stormwater', 'earthwork', 'paving'],
  cleaning: ['clean'],
};

const tradeLabel = new Map<string, string>(DEFECT_TRADES.map((t) => [t.id, t.label]));
const typeLabel = new Map<string, string>(DEFECT_TYPES.map((t) => [t.id, t.label]));
export const labelOfTrade = (id: DefectTradeId): string => tradeLabel.get(id) ?? id;
export const labelOfType = (id: DefectTypeId): string => typeLabel.get(id) ?? id;

const words = (text: string) => ` ${normaliseForMatch(text).replace(/[^a-z0-9ç-]+/g, ' ')}`;

/** Whether any trade a company (or a defect) lists means this Nova trade. */
export function listsTrade(listed: readonly string[], trade: DefectTradeId): boolean {
  const stems = TRADE_STEMS[trade];
  return listed.some((t) => {
    const w = words(t);
    return stems.some((s) => w.includes(` ${s}`));
  });
}

export interface ProjectCompany {
  id: string;
  name: string;
  trades: readonly string[];
}

export interface SuggestedCompany {
  id: string;
  name: string;
  /** The Nova trade that matched, as a defect stores it. */
  trade: string;
}

/** Assignees suggested at most. */
const COMPANIES = 3;

/**
 * Companies on the project that list the suggested trade first, then ones that list an alternative. Several
 * companies can share a trade, so the person picks; none is ever chosen for them.
 */
export function suggestCompanies(
  companies: readonly ProjectCompany[],
  trades: readonly DefectTradeId[],
): SuggestedCompany[] {
  const out: SuggestedCompany[] = [];
  const seen = new Set<string>();
  for (const trade of trades)
    for (const c of companies) {
      if (seen.has(c.id) || !listsTrade(c.trades, trade)) continue;
      seen.add(c.id);
      out.push({ id: c.id, name: c.name, trade: labelOfTrade(trade) });
    }
  return out.slice(0, COMPANIES);
}

/** A live defect pinned on a drawing (`defects.api.openNear`). */
export interface NearbyDefect {
  id: string;
  number: number;
  title: string;
  status: string;
  trade: string | null;
  assigneeCompanyId: string | null;
  pin: { x: number; y: number };
}

export interface DuplicateCandidate extends NearbyDefect {
  /** As the register shows it (`DEF-0042`). */
  numberLabel: string;
  /** Distance from the new pin as a fraction of the sheet. */
  distance: number;
  /** It is the same trade as the suggestion, so more likely the same defect. */
  sameTrade: boolean;
}

/** How near counts as the same spot: about a room's width on a floor plan. */
export const DUPLICATE_RADIUS = 0.06;
const DUPLICATES = 5;

/** Open defects within reach of the pin, nearest first, so the person can see the defect is already logged. */
export function duplicateCandidates(
  pin: { x: number; y: number },
  defects: readonly NearbyDefect[],
  trade: DefectTradeId | null,
): DuplicateCandidate[] {
  return defects
    .map((d) => ({
      ...d,
      numberLabel: defectLabel(d.number),
      distance: Math.hypot(d.pin.x - pin.x, d.pin.y - pin.y),
      sameTrade: !!trade && !!d.trade && listsTrade([d.trade], trade),
    }))
    .filter((d) => d.distance <= DUPLICATE_RADIUS)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, DUPLICATES);
}

export interface ReviewedDefectTag {
  title: string;
  description: string;
  trade: DefectTradeId | null;
  alternativeTrades: DefectTradeId[];
  defectType: DefectTypeId | null;
  priority: DefectTagOutput['priority'];
  gaps: DefectTagGap[];
  /** Numbers in the title or description found in neither the note nor the sheet text, for the person to check. */
  unsupportedNumbers: string[];
}

export function reviewDefectTag(
  out: DefectTagOutput,
  input: { note: string; pinText: readonly string[] },
): ReviewedDefectTag {
  const hay = normaliseForMatch(
    [input.note, ...input.pinText].join('\n').replace(/,/g, ''),
  ).replace(/\s+/g, '');
  const unsupportedNumbers = [
    ...new Set(numbersIn(`${out.title}\n${out.description}`).filter((n) => !hay.includes(n))),
  ];
  const alternativeTrades = [...new Set(out.alternativeTrades)]
    .filter((t) => t !== out.trade)
    .slice(0, 2);
  const gaps = new Set(out.gaps);
  // Nothing says where it is: a typed note might, a pin does.
  if (!input.pinText.length && !input.note.trim()) gaps.add('location');
  if (!out.trade) gaps.add('trade');
  return {
    title: out.title.trim(),
    description: out.description.trim(),
    trade: out.trade,
    alternativeTrades,
    defectType: out.defectType,
    priority: out.priority,
    gaps: [...gaps],
    unsupportedNumbers,
  };
}
