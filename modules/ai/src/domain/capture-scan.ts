// Site Capture "Ask Nova about this view": the rules around the model's output. Pure, no IO. The model lists what it
// sees in a still from a 360 tour; code keeps the wording an observation (never a finding of fault or breach), caps
// the list and drops repeats. Nothing here raises an issue: a person confirms an observation and raises it themselves.
import {
  CAPTURE_CATEGORIES,
  type CaptureCategoryId,
  type CaptureConfidence,
  type CaptureScanOutput,
} from '@archova/ai-prompts';
import { numbersIn } from './diary-summary';
import { JUDGING, PERSON_NAME } from './hazard-scan';

const label = new Map<string, string>(CAPTURE_CATEGORIES.map((c) => [c.id, c.label]));
export const labelOfCapture = (id: string): string => label.get(id) ?? id;

/** Said with every scan: Nova reads one still, not the tour. */
export const CAPTURE_DISCLAIMER =
  'Nova read the still you uploaded, not the live 360 tour, and a 360 still can be distorted. It flags what it can see for you to check against the plans; it does not decide that a rule was broken.';

export interface ReviewedObservation {
  category: CaptureCategoryId;
  observation: string;
  confidence: CaptureConfidence;
}

export interface ReviewedCaptureScan {
  observations: ReviewedObservation[];
  stillUnclear: boolean;
  /** Observations left out because their wording judged instead of observing, or named a person. */
  dropped: number;
  /** Numbers in the observations that the person didn't type; a number is only legible text, so check it. */
  unsupportedNumbers: string[];
}

export const MAX_OBSERVATIONS = 8;
const RANK: Record<CaptureConfidence, number> = { high: 0, medium: 1, low: 2 };

/** Keeps observations, drops judgments, removes repeats, puts the surest first. */
export function reviewCaptureScan(
  output: CaptureScanOutput,
  context: { note: string },
): ReviewedCaptureScan {
  let dropped = 0;
  const seen = new Set<string>();
  const kept: ReviewedObservation[] = [];
  for (const o of output.observations) {
    const observation = o.observation.trim();
    if (!observation || JUDGING.test(observation) || PERSON_NAME.test(observation)) {
      dropped += 1;
      continue;
    }
    const key = `${o.category}|${observation
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ category: o.category, observation, confidence: o.confidence });
  }
  const observations = kept
    .map((o, i) => ({ o, i }))
    .sort((a, b) => RANK[a.o.confidence] - RANK[b.o.confidence] || a.i - b.i)
    .slice(0, MAX_OBSERVATIONS)
    .map((x) => x.o);
  const said = new Set(numbersIn(context.note));
  const unsupportedNumbers = [
    ...new Set(observations.flatMap((o) => numbersIn(o.observation)).filter((n) => !said.has(n))),
  ];
  return { observations, stillUnclear: output.stillUnclear, dropped, unsupportedNumbers };
}

export type CaptureObservationStatus = 'open' | 'confirmed' | 'dismissed';
