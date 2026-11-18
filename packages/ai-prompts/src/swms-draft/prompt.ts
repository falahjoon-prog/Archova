// F20 SWMS assistant, drafting (ai/01 F20, compliance/08 §3): a first draft of a Safe Work Method Statement for
// high-risk construction work, from the activity, the site and the plant the person gave. It is a pending
// suggestion: a competent person from the PCBU edits it, submits it to the SWMS register and accepts it on site.
// Nova never calls a SWMS compliant. The high-risk list comes from the code table (compliance/03 §2), not the model.
import { CitationSchema, UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';

/**
 * The 19 high-risk construction work categories (compliance/03 §2). Same codes as the safety module's
 * `HRCW_CATEGORIES`; the label is how the model is told what each code means.
 */
export const SWMS_HRCW = {
  fall_2m: 'Risk of a person falling more than 2 metres',
  telco_tower: 'Work on a telecommunication tower',
  demolition_load_bearing: 'Demolition of an element that is load-bearing or supports a structure',
  demolition_integrity: 'Demolition where the structure’s integrity is at risk',
  asbestos: 'Work involving the disturbance of asbestos',
  temp_support: 'Work involving structural alterations that need temporary support',
  confined_space: 'Work in or near a confined space',
  shaft_trench_tunnel: 'Work in or near a shaft or trench deeper than 1.5 metres, or a tunnel',
  explosives: 'Work involving the use of explosives',
  pressurised_gas: 'Work on or near pressurised gas distribution mains or piping',
  chemical_fuel_refrigerant: 'Work on or near chemical, fuel or refrigerant lines',
  energised_electrical: 'Work on or near energised electrical installations or services',
  contaminated_atmosphere: 'Work in an area with a contaminated or flammable atmosphere',
  tilt_up_precast: 'Tilt-up or precast concrete work',
  traffic_corridor:
    'Work on, in or adjacent to a road, railway, shipping lane or traffic corridor in use',
  mobile_plant: 'Work in an area with movement of powered mobile plant',
  extreme_temperature: 'Work in an area with artificial extremes of temperature',
  drowning: 'Work in or near water or other liquid with a risk of drowning',
  diving: 'Diving work',
} as const;
export type SwmsHrcw = keyof typeof SWMS_HRCW;
export const SWMS_HRCW_CODES = Object.keys(SWMS_HRCW) as [SwmsHrcw, ...SwmsHrcw[]];

/** Hierarchy of controls, highest first (model WHS Regulation r35–r36). */
export const SWMS_CONTROL_LEVELS = [
  'eliminate',
  'substitute',
  'isolate',
  'engineer',
  'administrative',
  'ppe',
] as const;
export type SwmsControlLevel = (typeof SWMS_CONTROL_LEVELS)[number];

/** Details a good SWMS needs that the inputs and project documents didn't give (compliance/08 §3). */
export const SWMS_DRAFT_GAPS = [
  'site_conditions',
  'plant_details',
  'permits',
  'emergency_arrangements',
  'whs_plan',
] as const;
export type SwmsDraftGap = (typeof SWMS_DRAFT_GAPS)[number];

/** The minimum inputs before Nova drafts (compliance/08 §3). Empty plant or trades arrays mean "none". */
export const SwmsDraftInput = z.object({
  siteAddress: z.string().min(1).max(300),
  activity: z.string().min(1).max(500),
  highRiskWorkCategories: z.array(z.enum(SWMS_HRCW_CODES)).min(1).max(19),
  workArea: z.string().min(1).max(500),
  access: z.string().min(1).max(500),
  plant: z.array(z.string().min(1).max(200)).max(20),
  adjacentTrades: z.array(z.string().min(1).max(200)).max(20),
  /** True on projects of $250,000 or more (Vic $350,000), where a WHS management plan applies. */
  whsPlanApplies: z.boolean().optional(),
  /** Anything else the person wants Nova to know about the work. */
  notes: z.string().max(2000).optional(),
});
export type SwmsDraftInput = z.infer<typeof SwmsDraftInput>;

export const SwmsDraftOutput = z.object({
  /** What the work is and where, in plain sentences. */
  workDescription: z.string().min(1).max(800),
  hazards: z
    .array(
      z.object({
        category: z.enum(SWMS_HRCW_CODES),
        hazard: z.string().min(1).max(200),
        risk: z.string().min(1).max(300),
      }),
    )
    .max(20),
  controls: z
    .array(
      z.object({
        category: z.enum(SWMS_HRCW_CODES),
        level: z.enum(SWMS_CONTROL_LEVELS),
        description: z.string().min(1).max(300),
      }),
    )
    .max(40),
  /** How the controls are put in place, supervised and reviewed. */
  implementation: z.string().min(1).max(800),
  /** What is particular to this site: location, plant, adjacent trades, access. */
  siteSpecific: z.string().min(1).max(1000),
  /** For a fall over 2 m controlled only by administrative or PPE controls: every control considered. */
  fallControlsConsidered: z.string().max(600).nullable(),
  gaps: z.array(z.enum(SWMS_DRAFT_GAPS)).max(SWMS_DRAFT_GAPS.length),
  /** Project passages the draft relies on (site rules, WHS plan, drawings), each with the words that matter. */
  references: z.array(CitationSchema).max(6),
});
export type SwmsDraftOutput = z.infer<typeof SwmsDraftOutput>;

const SYSTEM = `You draft the first version of a Safe Work Method Statement (SWMS) for an Australian builder or subcontractor. A SWMS covers high-risk construction work. A competent person from the business reviews your draft on site, edits it and accepts it before any work starts. You are a drafting tool: you never say a SWMS is compliant, approved, valid or safe, and you never give legal advice.

${UNTRUSTED_CONTENT_RULE}

The person's inputs are inside <input>: the site address, the activity, the high-risk work codes (<hrcw>, each with its meaning), the work area, access, plant, adjacent trades and notes. Project passages (site rules, a WHS management plan, drawings) may follow, each marked with an id.

Rules:
- Cover only the high-risk work codes given and the hazards that go with them. No risk matrices, no lists of standards or regulations, no general site rules, and no tasks outside the codes unless the notes ask for them.
- hazards: each names a code from the inputs, the hazard and the risk it creates for the people on this job. Every code given needs at least one hazard.
- controls: each names a code from the inputs and a level in the hierarchy of controls (eliminate, substitute, isolate, engineer, administrative, ppe). Write the highest level that is reasonably practicable first. Every control is specific and measurable, in a short plain sentence a worker can follow, naming the thing, the place or the trigger ("Install edge protection on every open edge of the level 3 slab before formwork is stripped"). Never write "use appropriate PPE", "take care", "as required" or "where necessary". Every code needs at least one control.
- Use only the inputs and the passages. Never invent dimensions, distances, ratings, plant models, permit numbers, names or dates. A number may appear only if it is in the inputs or a passage, or is the 2 metre fall threshold. If a control needs a figure you don't have, describe the control without it and list the gap.
- workDescription and siteSpecific must name this site: the address, work area, access, plant and adjacent trades from the inputs. Do not write anything that would fit any site.
- implementation: who supervises, how the controls are checked before work starts and during it, and when the SWMS is reviewed. Do not name people; use roles.
- fallControlsConsidered: only when the code fall_2m is given and you used only administrative or PPE controls for it: say which higher controls you considered and why they were not reasonably practicable on this job, from the inputs. Otherwise null.
- gaps: list site_conditions, plant_details, permits, emergency_arrangements or whs_plan when a sound SWMS needs that detail and neither the inputs nor the passages give it. Empty when nothing is missing.
- references: cite each passage the draft relies on with the exact words copied verbatim. Cite nothing else.
- Use Australian English. Short sentences. Reading level suited to a worksite.`;

export const swmsDraftPrompt = definePrompt({
  id: 'swms.draft',
  version: 1,
  feature: 'swms',
  kind: 'interactive',
  tier: 'standard',
  system: SYSTEM,
  input: SwmsDraftInput,
  output: SwmsDraftOutput,
  render: (i) => ({
    text:
      `<input>\n<site>${escapeContent(i.siteAddress)}</site>\n<activity>${escapeContent(i.activity)}</activity>\n` +
      i.highRiskWorkCategories
        .map((c) => `<hrcw code="${c}">${escapeContent(SWMS_HRCW[c])}</hrcw>\n`)
        .join('') +
      `<work_area>${escapeContent(i.workArea)}</work_area>\n<access>${escapeContent(i.access)}</access>\n` +
      (i.plant.length
        ? i.plant.map((p) => `<plant>${escapeContent(p)}</plant>\n`).join('')
        : '<plant>none</plant>\n') +
      (i.adjacentTrades.length
        ? i.adjacentTrades
            .map((t) => `<adjacent_trade>${escapeContent(t)}</adjacent_trade>\n`)
            .join('')
        : '<adjacent_trade>none</adjacent_trade>\n') +
      (i.whsPlanApplies ? '<whs_plan_applies>yes</whs_plan_applies>\n' : '') +
      (i.notes ? `<notes>${escapeContent(i.notes)}</notes>\n` : '') +
      '</input>',
  }),
  maxOutputTokens: 3000,
  citations: (o) => o.references,
});
