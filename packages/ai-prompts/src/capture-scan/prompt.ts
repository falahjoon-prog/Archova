// Site Capture "Ask Nova about this view": from a still the person took from a 360 tour (a screenshot of the tour
// view, uploaded to the project), list what looks like a defect, missing fire-stopping or incomplete work for a
// person to review. Observations, never findings: Nova does not say a rule was broken, cite legislation, describe
// people or raise an issue. Nova reads the still, not the live embedded tour.
import { SitePhoto, UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';

/** The patterns Nova looks for in a tour still. `id` is what the model returns; `label` is what the person reads. */
export const CAPTURE_CATEGORIES = [
  { id: 'defect', label: 'Visible defect' },
  { id: 'fire_stopping', label: 'Missing or incomplete fire-stopping' },
  { id: 'incomplete_work', label: 'Incomplete work' },
  { id: 'services', label: 'Services and penetrations' },
  { id: 'moisture', label: 'Moisture or water damage' },
  { id: 'finishes', label: 'Finishes and cleanliness' },
  { id: 'other', label: 'Other' },
] as const;
export type CaptureCategoryId = (typeof CAPTURE_CATEGORIES)[number]['id'];
const CATEGORY_IDS = CAPTURE_CATEGORIES.map((c) => c.id) as [
  CaptureCategoryId,
  ...CaptureCategoryId[],
];

export const CAPTURE_CONFIDENCE = ['low', 'medium', 'high'] as const;
export type CaptureConfidence = (typeof CAPTURE_CONFIDENCE)[number];

export const CaptureScanInput = z.object({
  /** What the person said or typed about the view (where it is, what they are checking); may be empty. */
  note: z.string().max(1000),
  photo: SitePhoto,
});
export type CaptureScanInput = z.infer<typeof CaptureScanInput>;

export const CaptureScanOutput = z.object({
  observations: z
    .array(
      z.object({
        category: z.enum(CATEGORY_IDS),
        /** What is visible, in one or two plain sentences. */
        observation: z.string().min(1).max(300),
        confidence: z.enum(CAPTURE_CONFIDENCE),
      }),
    )
    .max(8),
  /** The still is too dark, blurred, distorted or distant to judge, or is not a building interior or site. */
  stillUnclear: z.boolean(),
});
export type CaptureScanOutput = z.infer<typeof CaptureScanOutput>;

const SYSTEM = `You look at a still taken from a 360 tour of a building under construction and list what looks like a defect, missing fire-stopping or incomplete work, for a person to check against the plans. You flag what is visible; the person decides whether it matters. You never decide that a rule was broken. A 360 still can be stretched or distorted near its edges, so treat anything doubtful as low confidence.

${UNTRUSTED_CONTENT_RULE}

The input has a still (an image after the text) and an optional <note> the person typed.

Rules:
- Report only what you can see in the still. If you cannot see it, do not report it. Never guess what is outside the frame or behind a surface.
- Each observation has a category, one of ${CAPTURE_CATEGORIES.map((c) => `${c.id} (${c.label})`).join(', ')}.
- observation: one or two plain sentences in Australian English that start from what the still shows, for example "The still shows a pipe passing through the wall on the left with a visible gap around it and no sealant." Use "appears", "looks" or "is not visible" where the still cannot confirm it.
- Do not say a law, code, standard or regulation was breached, do not say "non-compliant", "illegal", "violation", do not say who is at fault and do not say what to do about it.
- Never identify or describe any person. No names, ages, faces or other traits.
- State a number, sign text or label only if it is clearly legible, copied exactly.
- confidence: high only when the point is plainly visible, low when it is partly hidden, small, distant or distorted.
- List the most significant observations first, at most eight. An empty list is right when you see nothing worth flagging; do not invent an observation to fill the list.
- stillUnclear: true when the still is too dark, blurred, distorted or distant to judge, or is not a building interior or construction site. Then observations may be empty.`;

export const captureScanPrompt = definePrompt({
  id: 'coordination.capture_scan',
  version: 1,
  feature: 'site_capture',
  kind: 'interactive',
  tier: 'standard',
  system: SYSTEM,
  input: CaptureScanInput,
  output: CaptureScanOutput,
  render: (i) => ({
    text:
      `<input>\n<note>${escapeContent(i.note)}</note>\n` +
      '<photo>A still from a 360 tour is attached as an image.</photo>\n</input>',
    images: [i.photo],
  }),
  maxOutputTokens: 1200,
});
