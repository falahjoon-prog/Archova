// F35 site photo hazard signals (ai/11): the rules around the model's output. Pure, no IO. The model lists what it
// sees; code makes sure the wording stays an observation (never a finding of fault or breach), caps the list and
// turns the signals a person confirmed into patterns. Nothing here raises an incident: a safety manager does that.
import {
  HAZARD_CATEGORIES,
  type HazardCategoryId,
  type HazardConfidence,
  type HazardScanOutput,
} from '@archova/ai-prompts';
import { numbersIn } from './diary-summary';

const label = new Map<string, string>(HAZARD_CATEGORIES.map((c) => [c.id, c.label]));
export const labelOfHazard = (id: string): string => label.get(id) ?? id;

/** Said with every scan: a signal is what Nova can see in one photo, not a finding. */
export const HAZARD_DISCLAIMER =
  'Nova flags what it can see in a photo for you to check. It is not a safety inspection and does not decide that a rule was broken.';

/** Wording that judges rather than observes: a signal using it is dropped, not repaired. */
const JUDGING =
  /\b(breach\w*|non-?complian\w*|illegal\w*|unlawful\w*|violat\w*|offence\w*|negligen\w*|contravene\w*|contravention|liable|liability|at fault|stop work|should be|must be|needs? to be|ought to|whs act|regulations?|australian standard|as ?\d{3,4})\b/i;

/** "Is not worn" states a fact about a person Nova can't know from one frame; keep it as what the photo suggests. */
export function soften(text: string): string {
  return text
    .replace(/\b(is|are) not (being )?worn\b/gi, 'appears not to be worn')
    .replace(/\b(is|are) not wearing\b/gi, 'appears not to be wearing')
    .replace(/\bnot wearing\b/gi, 'appears not to be wearing');
}

export interface ReviewedSignal {
  category: HazardCategoryId;
  observation: string;
  confidence: HazardConfidence;
}

export interface ReviewedHazardScan {
  signals: ReviewedSignal[];
  photoUnclear: boolean;
  /** Signals left out because their wording judged instead of observing. */
  dropped: number;
  /** Numbers in the observations that the person didn't type; a number is only legible text, so check it. */
  unsupportedNumbers: string[];
}

/** At most this many signals are kept from one photo. */
export const MAX_SIGNALS = 8;
const RANK: Record<HazardConfidence, number> = { high: 0, medium: 1, low: 2 };

/** Keeps observations, drops judgments, removes repeats, puts the surest first. */
export function reviewHazardScan(
  output: HazardScanOutput,
  context: { note: string },
): ReviewedHazardScan {
  let dropped = 0;
  const seen = new Set<string>();
  const kept: ReviewedSignal[] = [];
  for (const s of output.signals) {
    const observation = soften(s.observation.trim());
    if (!observation || JUDGING.test(observation)) {
      dropped += 1;
      continue;
    }
    const key = `${s.category}|${observation
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ category: s.category, observation, confidence: s.confidence });
  }
  const signals = kept
    .map((s, i) => ({ s, i }))
    .sort((a, b) => RANK[a.s.confidence] - RANK[b.s.confidence] || a.i - b.i)
    .slice(0, MAX_SIGNALS)
    .map((x) => x.s);
  const said = new Set(numbersIn(context.note));
  const unsupportedNumbers = [
    ...new Set(signals.flatMap((s) => numbersIn(s.observation)).filter((n) => !said.has(n))),
  ];
  return { signals, photoUnclear: output.photoUnclear, dropped, unsupportedNumbers };
}

export type HazardSignalStatus = 'open' | 'confirmed' | 'dismissed';

/** A stored signal, as far as the pattern counts need it. */
export interface PatternSignal {
  category: string;
  status: HazardSignalStatus;
  /** The photo it came from (`files` id): the same photo scanned twice counts once. */
  photoId: string;
  createdAt: Date;
}

export type PatternTrend = 'rising' | 'steady' | 'falling';

export interface HazardPattern {
  category: string;
  label: string;
  open: number;
  confirmed: number;
  dismissed: number;
  /** Photos with a confirmed signal in this category. */
  photos: number;
  /** Confirmed in at least `PATTERN_MIN_SIGNALS` signals across at least `PATTERN_MIN_PHOTOS` photos. */
  isPattern: boolean;
  /** Confirmed signals in the later half of the window against the earlier half. */
  trend: PatternTrend;
}

export const PATTERN_MIN_SIGNALS = 3;
export const PATTERN_MIN_PHOTOS = 2;

/**
 * Counts per category over a window ending `now`. Only signals a person confirmed make a pattern; open ones are
 * shown so the manager sees what is waiting, and dismissed ones count against nothing.
 */
export function hazardPatterns(
  signals: readonly PatternSignal[],
  window: { now: Date; days: number },
): HazardPattern[] {
  const from = window.now.getTime() - window.days * 86_400_000;
  const mid = from + (window.days * 86_400_000) / 2;
  const by = new Map<string, PatternSignal[]>();
  for (const s of signals) {
    if (s.createdAt.getTime() < from || s.createdAt.getTime() > window.now.getTime()) continue;
    by.set(s.category, [...(by.get(s.category) ?? []), s]);
  }
  const out: HazardPattern[] = [];
  for (const [category, rows] of by) {
    const confirmed = rows.filter((r) => r.status === 'confirmed');
    const photos = new Set(confirmed.map((r) => r.photoId)).size;
    const late = confirmed.filter((r) => r.createdAt.getTime() >= mid).length;
    const early = confirmed.length - late;
    out.push({
      category,
      label: labelOfHazard(category),
      open: rows.filter((r) => r.status === 'open').length,
      confirmed: confirmed.length,
      dismissed: rows.filter((r) => r.status === 'dismissed').length,
      photos,
      isPattern: confirmed.length >= PATTERN_MIN_SIGNALS && photos >= PATTERN_MIN_PHOTOS,
      trend: late > early ? 'rising' : late < early ? 'falling' : 'steady',
    });
  }
  return out.sort(
    (a, b) =>
      Number(b.isPattern) - Number(a.isPattern) ||
      b.confirmed - a.confirmed ||
      b.open - a.open ||
      a.category.localeCompare(b.category),
  );
}
