import {
  HARM_SOURCES,
  INJURY_OUTCOMES,
  INJURY_TYPES,
  type HarmSource,
  type InjuryOutcome,
  type InjuryType,
} from '@archova/domain';

/** Chart colours are CSS variables on `.ia-viz` (see ui styles). A category keeps its colour whatever the filter. */
export const OTHER_COLOUR = 'var(--ia-other)';

const slot = (n: number) => `var(--ia-s${n})`;

// The first seven categories each own a categorical slot; everything else folds into "Other" (grey).
export function harmSourceColour(key: string): string {
  const i = (HARM_SOURCES as readonly string[]).indexOf(key as HarmSource);
  return i >= 0 && i < 7 ? slot(i + 1) : OTHER_COLOUR;
}

export function injuryTypeColour(key: string): string {
  const i = (INJURY_TYPES as readonly string[]).indexOf(key as InjuryType);
  return i >= 0 && i < 7 ? slot(i + 1) : OTHER_COLOUR;
}

const OUTCOME_COLOURS: Record<InjuryOutcome, string> = {
  first_aid: 'var(--ia-good)',
  medical_treatment: 'var(--ia-warning)',
  restricted_work: 'var(--ia-serious)',
  lost_time: 'var(--ia-critical)',
  fatality: 'var(--ia-seq-5)',
};
export const outcomeColour = (key: string) =>
  (INJURY_OUTCOMES as readonly string[]).includes(key)
    ? OUTCOME_COLOURS[key as InjuryOutcome]
    : OTHER_COLOUR;

/** Body map shading: 0 is a neutral wash, then five sequential steps scaled to the busiest part. */
export function heatColour(count: number, max: number): string {
  if (count <= 0 || max <= 0) return 'var(--ia-seq-0)';
  const step = Math.min(5, Math.max(1, Math.ceil((count / max) * 5)));
  return `var(--ia-seq-${step})`;
}
