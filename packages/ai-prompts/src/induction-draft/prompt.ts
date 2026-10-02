// F33 phase 1 (ai/11 §F33, ai/12 §2 I1): Nova drafts a site induction (slides, speaker script and quiz) from the
// project's own documents. Every point, script line and quiz answer cites the passage it comes from; a required
// section the documents don't support is reported missing, never invented. Standard tier, interactive.
import { CitationSchema, UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';

/**
 * Required sections of a site-specific induction (compliance/04 §2, IND-AC1). The declaration (row 10) is fixed
 * text from the reference table, added by code, so the model drafts rows 1–9.
 */
export const INDUCTION_SECTIONS = [
  'who_and_access',
  'layout_and_amenities',
  'emergencies_and_first_aid',
  'site_hazards',
  'high_risk_work_and_permits',
  'ppe',
  'site_rules',
  'incident_reporting',
  'consultation',
] as const;
export type InductionSection = (typeof INDUCTION_SECTIONS)[number];

const cited = z.object({
  text: z.string().min(1).max(400),
  citations: z.array(CitationSchema).max(4),
});

export const InductionDraftOutput = z.object({
  sections: z
    .array(
      z.object({
        section: z.enum(INDUCTION_SECTIONS),
        status: z.enum(['covered', 'missing']),
        /** When missing (or partly covered): what the builder needs to add, in one sentence. */
        gap: z.string().max(300).nullable(),
        slides: z
          .array(
            z.object({
              title: z.string().min(1).max(120),
              points: z.array(cited).max(8),
              /** What the presenter or narrator says on this slide. */
              script: z.array(cited).max(10),
            }),
          )
          .max(4),
      }),
    )
    .max(INDUCTION_SECTIONS.length),
  quiz: z
    .array(
      z.object({
        section: z.enum(INDUCTION_SECTIONS),
        question: z.string().min(1).max(300),
        options: z.array(z.string().min(1).max(200)).min(2).max(5),
        answerIndex: z.number().int().min(0).max(4),
        /** Emergency, exclusion zone and permit questions must all be answered correctly (compliance/04 §3). */
        critical: z.boolean(),
        citations: z.array(CitationSchema).min(1).max(3),
      }),
    )
    .max(15),
});
export type InductionDraftOutput = z.infer<typeof InductionDraftOutput>;

export const InductionDraftInput = z.object({
  siteName: z.string().max(200),
  /** For each section, the passage ids retrieval found for it (possibly none). */
  sections: z
    .array(
      z.object({ section: z.enum(INDUCTION_SECTIONS), passageIds: z.array(z.string()).max(12) }),
    )
    .max(INDUCTION_SECTIONS.length),
});
export type InductionDraftInput = z.infer<typeof InductionDraftInput>;

/** What each section must cover, from compliance/04 §2; shown to the model. */
export const SECTION_BRIEF: Readonly<Record<InductionSection, string>> = {
  who_and_access:
    'Who is who and site access: principal contractor, site manager, first aiders, health and safety representatives, how to raise a safety issue, site hours, sign-in and sign-out rules.',
  layout_and_amenities:
    'Site layout and amenities: access and egress, toilets, lunch room, drinking water, first aid room or kit, assembly point, exclusion zones, pedestrian and plant routes.',
  emergencies_and_first_aid:
    'Emergencies and first aid: alarm, evacuation route, assembly point, roll call, emergency contacts, the site address to give 000, first aid arrangements and first aiders.',
  site_hazards:
    'Site-specific hazards now: high-risk construction work under way, asbestos register location, silica, traffic and mobile plant, working at heights, overhead and underground services, exclusion zones.',
  high_risk_work_and_permits:
    'High-risk work and permits: which SWMS apply on this site, permits to work in use (hot work, confined space, excavation, isolation, heights), high-risk work licences needed for plant.',
  ppe: 'PPE: the site minimum PPE and task-specific PPE.',
  site_rules:
    'Site rules: housekeeping, smoking, drugs and alcohol, mobile phones, visitors, behaviour and psychosocial safety (bullying, harassment, sexual harassment).',
  incident_reporting:
    'Incident and hazard reporting: how to report incidents, injuries, near misses and hazards, and who to tell.',
  consultation: 'Consultation: how workers are consulted (toolbox talks, HSRs, prestart meetings).',
};

const SYSTEM = `You draft a site-specific safety induction for an Australian construction site, using only the project passages supplied. The builder will check and approve your draft before any worker sees it.

${UNTRUSTED_CONTENT_RULE}

Rules:
- Use only facts in the passages. Never invent or "typical" a fact: assembly points, phone numbers, addresses, hours, names, permits and PPE must come from a passage. A wrong emergency detail can hurt someone.
- Every slide point, every script line and every quiz question needs at least one citation: the passage id and the exact words from that passage, copied verbatim.
- For each section, use the passages listed for it (other passages may help). If they don't support the section, set status to "missing", leave slides empty, and say in "gap" what the builder needs to add. If they only partly support it, draft what is supported and say what is missing in "gap".
- Slides: a short title and 3–6 short points, plain words a worker on site understands. Script: what the presenter says, 2–5 short sentences per slide, friendly and direct.
- Quiz: 8–12 multiple-choice questions with one correct option, drawn from the slides. Include at least one question on each of emergencies and first aid, site hazards, high-risk work and permits, and incident reporting when those sections are covered. Mark questions about emergencies, exclusion zones and permits as critical. Cite the passage that proves the answer.
- Don't say anything is "compliant", "valid", "verified", "guaranteed" or "legally" required. Don't write the worker declaration; it is added separately.
- Australian English. Keep numbers, phone numbers, units, permit names and plant names exactly as written in the passage.`;

export const inductionDraftPrompt = definePrompt({
  id: 'induction.draft',
  version: 1,
  feature: 'inductions',
  kind: 'interactive',
  tier: 'standard',
  system: SYSTEM,
  input: InductionDraftInput,
  output: InductionDraftOutput,
  render: (i) => ({
    text:
      `<input>\nSite: ${escapeContent(i.siteName)}\nSections to draft:\n` +
      i.sections
        .map(
          (s) =>
            `- ${s.section}: ${SECTION_BRIEF[s.section]} Passages found: ${s.passageIds.length ? s.passageIds.join(', ') : 'none'}.`,
        )
        .join('\n') +
      `\n</input>`,
  }),
  maxOutputTokens: 6000,
  citations: (o) => [
    ...o.sections.flatMap((s) =>
      s.slides.flatMap((sl) => [...sl.points, ...sl.script].flatMap((p) => p.citations)),
    ),
    ...o.quiz.flatMap((q) => q.citations),
  ],
});
