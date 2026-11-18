// F20 SWMS drafting (ai/01 F20, compliance/08 §3): the checks between the model's draft and the competent person who
// edits it. Pure rules, no IO. The draft covers only the high-risk work codes the person gave; controls come out in
// the order of the hierarchy of controls; a control that is vague is removed; a number nobody supplied, or a
// category with no hazard or no control, is flagged for the reviewer rather than fixed. The output is shaped like the
// safety module's `SwmsContent`, so the person can submit it to the register after editing. Nothing here says a
// SWMS is compliant.
import {
  SWMS_CONTROL_LEVELS,
  type SwmsControlLevel,
  type SwmsDraftGap,
  type SwmsDraftOutput,
  type SwmsHrcw,
} from '@archova/ai-prompts';
import { normaliseForMatch, type CheckedCitation } from './citations';
import { numbersIn } from './diary-summary';

/** Shown with every draft; fixed wording, never the model's (compliance/08 §1.2). */
export const SWMS_DRAFT_NOTICE =
  'Draft written by Nova. A competent person from your business must read it, edit it for this site and accept it before any work starts. Nova does not check that it meets the WHS Regulation.';

export interface SwmsDraftWarning {
  code:
    | 'vague_control_removed'
    | 'banned_wording_removed'
    | 'out_of_scope_removed'
    | 'unverified_number'
    | 'category_without_hazard'
    | 'category_without_control'
    | 'only_admin_or_ppe'
    | 'fall_controls_not_recorded'
    | 'not_site_specific';
  message: string;
  category?: SwmsHrcw;
}

export interface ReviewedSwmsDraft {
  highRiskWorkCategories: SwmsHrcw[];
  hazards: Array<{ category: SwmsHrcw; hazard: string; risk: string }>;
  /** In hierarchy order, highest first. */
  controls: Array<{ category: SwmsHrcw; level: SwmsControlLevel; description: string }>;
  workDescription: string;
  implementation: string;
  siteSpecific: string;
  fallControlsConsidered: string | null;
  gaps: SwmsDraftGap[];
  references: CheckedCitation[];
  warnings: SwmsDraftWarning[];
}

/** Words that would claim more than a draft can (compliance/08 §1.1). */
const BANNED = [
  /\bcompliant\b/i,
  /\bcomplies with\b/i,
  /\bin compliance with\b/i,
  /\b(?:is|are|will be|remains?|made) (?:fully |completely |totally )?safe\b/i,
  /\b(?:fully|completely|totally|100%|entirely) safe\b/i,
  /\bsafe to (?:proceed|start|begin|work)\b/i,
  /\b(?:this|the) (?:swms|draft|document) (?:is|has been) (?:approved|valid|accepted)\b/i,
  /\bmeets? (?:all |the )?(?:legal|regulatory|statutory|whs) (?:requirements?|obligations?|duties)\b/i,
  /\bguarantee[sd]?\b/i,
];
export const hasClaim = (text: string) => BANNED.some((re) => re.test(text));

/** Controls that name no thing, place or trigger (compliance/08 §3). */
const VAGUE = [
  /\b(?:appropriate|suitable|adequate|necessary|relevant|proper)\s+(?:ppe|controls?|equipment|measures?|precautions?|protection|safety)\b/i,
  /\bas (?:required|needed|necessary|appropriate)\b/i,
  /\bwhere (?:required|necessary|applicable|appropriate|possible)\b/i,
  /\b(?:take|exercise) (?:due )?care\b/i,
  /\bbe (?:careful|aware|vigilant)\b/i,
  /\bcommon sense\b/i,
];
const MIN_CONTROL_CHARS = 25;
export const isVague = (text: string) =>
  text.trim().length < MIN_CONTROL_CHARS || VAGUE.some((re) => re.test(text));

/** 2 metres is the regulation's own fall threshold, so it may be written without a source. */
const KNOWN_NUMBERS = new Set(['2']);

export interface SwmsDraftContext {
  /** Everything the person typed, joined: addresses, activity, plant and the rest. */
  inputText: string;
  categories: readonly SwmsHrcw[];
  /** Passage text by id, with titles, for the number check. */
  passageText: ReadonlyMap<string, string>;
  /** The model's citations that passed the gateway's check. */
  citations: readonly CheckedCitation[];
}

const levelRank = (l: SwmsControlLevel) => SWMS_CONTROL_LEVELS.indexOf(l);

export function reviewSwmsDraft(output: SwmsDraftOutput, ctx: SwmsDraftContext): ReviewedSwmsDraft {
  const warnings: SwmsDraftWarning[] = [];
  const wanted = new Set<SwmsHrcw>(ctx.categories);
  // Every number the draft may use: the person's inputs and the passages it cites.
  const supplied = normaliseForMatch(
    [ctx.inputText, ...ctx.citations.map((c) => ctx.passageText.get(c.passageId) ?? '')]
      .join('\n')
      .replace(/,/g, ''),
  ).replace(/\s+/g, ' ');
  const unverified = (text: string) =>
    numbersIn(text).filter((n) => !KNOWN_NUMBERS.has(n) && !supplied.includes(n));
  const flagNumbers = (text: string, category?: SwmsHrcw) => {
    const bad = unverified(text);
    if (bad.length)
      warnings.push({
        code: 'unverified_number',
        message: `"${bad.join('", "')}" is not in your inputs or the project documents Nova read. Check it before you keep it.`,
        ...(category ? { category } : {}),
      });
  };

  const seen = new Set<string>();
  const hazards: ReviewedSwmsDraft['hazards'] = [];
  for (const h of output.hazards) {
    if (!wanted.has(h.category)) {
      warnings.push({
        code: 'out_of_scope_removed',
        message: `A hazard for work outside the codes you chose was removed: ${h.hazard}`,
        category: h.category,
      });
      continue;
    }
    if (hasClaim(`${h.hazard} ${h.risk}`)) {
      warnings.push({
        code: 'banned_wording_removed',
        message: `A hazard was removed because it claimed more than a draft can: ${h.hazard}`,
        category: h.category,
      });
      continue;
    }
    const key = `${h.category}|${h.hazard.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    flagNumbers(`${h.hazard} ${h.risk}`, h.category);
    hazards.push({ category: h.category, hazard: h.hazard.trim(), risk: h.risk.trim() });
  }

  const controls: ReviewedSwmsDraft['controls'] = [];
  seen.clear();
  for (const c of output.controls) {
    if (!wanted.has(c.category)) {
      warnings.push({
        code: 'out_of_scope_removed',
        message: `A control for work outside the codes you chose was removed: ${c.description}`,
        category: c.category,
      });
      continue;
    }
    if (hasClaim(c.description)) {
      warnings.push({
        code: 'banned_wording_removed',
        message: `A control was removed because it claimed more than a draft can: ${c.description}`,
        category: c.category,
      });
      continue;
    }
    if (isVague(c.description)) {
      warnings.push({
        code: 'vague_control_removed',
        message: `A control was removed because it was too general to follow: ${c.description}`,
        category: c.category,
      });
      continue;
    }
    const key = `${c.category}|${c.description.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    flagNumbers(c.description, c.category);
    controls.push({ category: c.category, level: c.level, description: c.description.trim() });
  }
  // Array.sort is stable, so the model's order holds within a level.
  controls.sort((a, b) => levelRank(a.level) - levelRank(b.level));

  for (const category of ctx.categories) {
    if (!hazards.some((h) => h.category === category))
      warnings.push({
        code: 'category_without_hazard',
        message: 'No hazard was drafted for this work. Add the hazards and risks.',
        category,
      });
    const own = controls.filter((c) => c.category === category);
    if (own.length === 0)
      warnings.push({
        code: 'category_without_control',
        message: 'No control was drafted for this work. Add the control measures.',
        category,
      });
    else if (own.every((c) => c.level === 'administrative' || c.level === 'ppe'))
      warnings.push({
        code: 'only_admin_or_ppe',
        message:
          'Every control is administrative or PPE. Check whether eliminating, substituting, isolating or engineering the hazard is reasonably practicable.',
        category,
      });
  }

  const prose = {
    workDescription: output.workDescription.trim(),
    implementation: output.implementation.trim(),
    siteSpecific: output.siteSpecific.trim(),
  };
  for (const [field, text] of Object.entries(prose)) {
    if (hasClaim(text))
      warnings.push({
        code: 'banned_wording_removed',
        message: `The ${field} says more than a draft can (for example "compliant" or "safe"). Reword it before you use it.`,
      });
    flagNumbers(text);
  }
  // A site-specific section that shares nothing with the person's inputs fits any site (compliance/03 §5).
  const inputWords = new Set(
    normaliseForMatch(ctx.inputText)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3),
  );
  const shared = normaliseForMatch(prose.siteSpecific)
    .split(/[^a-z0-9]+/)
    .filter((w) => inputWords.has(w));
  if (shared.length < 2)
    warnings.push({
      code: 'not_site_specific',
      message:
        'The site section does not mention your site, work area or plant. A generic SWMS is not acceptable: rewrite it for this site.',
    });

  // The 2 m fall rule (compliance/03 §3): record what else was considered when only administrative or PPE controls are used.
  let fall = output.fallControlsConsidered?.trim() || null;
  if (fall && hasClaim(fall)) fall = null;
  const fallControls = controls.filter((c) => c.category === 'fall_2m');
  if (
    ctx.categories.includes('fall_2m') &&
    fallControls.length > 0 &&
    fallControls.every((c) => c.level === 'administrative' || c.level === 'ppe') &&
    !fall
  )
    warnings.push({
      code: 'fall_controls_not_recorded',
      message:
        'For a fall over 2 m with only administrative or PPE controls, record every control you considered.',
      category: 'fall_2m',
    });
  if (fall) flagNumbers(fall, 'fall_2m');

  const references: CheckedCitation[] = [];
  for (const c of ctx.citations)
    if (!references.some((r) => r.passageId === c.passageId)) references.push(c);

  return {
    highRiskWorkCategories: [...ctx.categories],
    hazards,
    controls,
    ...prose,
    fallControlsConsidered: fall,
    gaps: [...new Set(output.gaps)],
    references,
    warnings,
  };
}

/** The SWMS content (`SwmsContent` in the safety module) a person starts from; they edit it before submitting. */
export function toSwmsContent(
  r: ReviewedSwmsDraft,
  labels: Readonly<Record<string, string>>,
  whsPlanApplies: boolean,
) {
  return {
    workDescription: r.workDescription,
    hazardsAndRisks: r.hazards
      .map((h) => `${labels[h.category] ?? h.category}: ${h.hazard}. ${h.risk}`)
      .join('\n'),
    controlMeasures: r.controls.map((c) => ({ level: c.level, description: c.description })),
    implementation: r.implementation,
    siteSpecific: r.siteSpecific,
    whsPlanApplies,
    ...(r.fallControlsConsidered ? { fallControlsConsidered: r.fallControlsConsidered } : {}),
  };
}
