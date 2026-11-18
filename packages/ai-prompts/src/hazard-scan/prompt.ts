// F35 site photo hazard signals: from a site photo already uploaded to the project (diary, incident, inspection),
// list the visual hazard patterns a safety manager should look at: PPE that appears not to be worn, unprotected
// edges, untidy walkways. These are signals for a person to review, never findings: Nova does not say a rule was
// broken, does not cite legislation, does not name or describe people and does not raise an incident.
import { SitePhoto, UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';

/** The hazard patterns Nova looks for. `id` is what the model returns; `label` is what the person reads. */
export const HAZARD_CATEGORIES = [
  { id: 'ppe', label: 'Protective equipment' },
  { id: 'edge_protection', label: 'Unprotected edge or opening' },
  { id: 'work_at_height', label: 'Work at height' },
  { id: 'housekeeping', label: 'Housekeeping and walkways' },
  { id: 'excavation', label: 'Excavation or trench' },
  { id: 'plant_and_people', label: 'Plant and people close together' },
  { id: 'electrical', label: 'Electrical' },
  { id: 'scaffold_and_access', label: 'Scaffold, ladders and access' },
  { id: 'falling_objects', label: 'Falling objects and unsecured loads' },
  { id: 'fire_and_materials', label: 'Fire risk and materials storage' },
  { id: 'barricading_and_signs', label: 'Barricading and signage' },
  { id: 'other', label: 'Other' },
] as const;
export type HazardCategoryId = (typeof HAZARD_CATEGORIES)[number]['id'];
const CATEGORY_IDS = HAZARD_CATEGORIES.map((c) => c.id) as [
  HazardCategoryId,
  ...HazardCategoryId[],
];

export const HAZARD_CONFIDENCE = ['low', 'medium', 'high'] as const;
export type HazardConfidence = (typeof HAZARD_CONFIDENCE)[number];

export const HazardScanInput = z.object({
  /** What the person said or typed about the photo; may be empty. */
  note: z.string().max(1000),
  photo: SitePhoto,
});
export type HazardScanInput = z.infer<typeof HazardScanInput>;

export const HazardScanOutput = z.object({
  signals: z
    .array(
      z.object({
        category: z.enum(CATEGORY_IDS),
        /** What is visible, in one or two plain sentences. */
        observation: z.string().min(1).max(300),
        confidence: z.enum(HAZARD_CONFIDENCE),
      }),
    )
    .max(8),
  /** The photo is too dark, blurred or distant to judge, or is not a site photo. */
  photoUnclear: z.boolean(),
});
export type HazardScanOutput = z.infer<typeof HazardScanOutput>;

const SYSTEM = `You look at a construction site photo and list visual hazard signals for a safety manager to review. You flag what is visible; the safety manager decides whether it matters. You never decide that a rule was broken.

${UNTRUSTED_CONTENT_RULE}

The input has a photo (an image after the text) and an optional <note> the person typed.

Rules:
- Report only what you can see in the photo. If you cannot see it, do not report it. Never guess what is outside the frame.
- Each signal has a category, one of ${HAZARD_CATEGORIES.map((c) => `${c.id} (${c.label})`).join(', ')}.
- observation: one or two plain sentences in Australian English that start from what the photo shows, for example "The photo shows an open slab edge on the right with no visible barrier." For protective equipment write "appears not to be worn" or "is not visible", never "is not worn".
- Do not say a law, code, standard or regulation was breached, do not say "non-compliant", "illegal", "violation" or "unsafe act", do not say who is at fault and do not say what to do about it.
- Never identify or describe any person beyond what they are doing or wearing as it bears on the hazard (for example "one worker near the edge appears to have no hard hat"). No names, ages, faces or other traits.
- State a number, sign text or label only if it is clearly legible, copied exactly.
- confidence: high only when the hazard is plainly visible, low when it is partly hidden, small or distant.
- List the most serious signals first, at most eight. An empty list is right when you see nothing worth flagging; do not invent a signal to fill the list.
- photoUnclear: true when the photo is too dark, blurred or distant to judge, or is not a construction site. Then signals may be empty.`;

export const hazardScanPrompt = definePrompt({
  id: 'safety.hazard_scan',
  version: 1,
  feature: 'safety_hazards',
  kind: 'interactive',
  tier: 'standard',
  system: SYSTEM,
  input: HazardScanInput,
  output: HazardScanOutput,
  render: (i) => ({
    text:
      `<input>\n<note>${escapeContent(i.note)}</note>\n` +
      '<photo>A site photo is attached as an image.</photo>\n</input>',
    images: [i.photo],
  }),
  maxOutputTokens: 1200,
});
