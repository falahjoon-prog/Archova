// Voice log (mobile F14 follow-up): a site person speaks the day's notes in one go and Nova splits the transcript into
// the records the diary and safety registers use: a diary note, delays, safety observations and tasks. Nova never writes
// anything: the phone shows each proposed record for the person to untick or edit, and saves the ones they keep through
// the same offline commands as typing. Every item quotes the words it comes from and code drops one whose quote isn't
// in the transcript, a number the quote doesn't contain, or a due date the quote doesn't give.
import { UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';

const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The longest transcript one run reads (about 15 minutes of speech). */
export const VOICE_LOG_MAX = 12000;

export const VOICE_LOG_KINDS = ['note', 'delay', 'observation', 'task'] as const;
export const VOICE_DELAY_TYPES = [
  'weather',
  'client',
  'design',
  'subcontractor',
  'authority',
  'industrial',
  'other',
] as const;

export const VoiceLogInput = z.object({
  /** The diary day the person is logging, in the project's time zone. */
  date: LocalDate,
  transcript: z.string().min(1).max(VOICE_LOG_MAX),
});
export type VoiceLogInput = z.infer<typeof VoiceLogInput>;

export const VoiceLogOutput = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(VOICE_LOG_KINDS),
        text: z.string().min(1).max(600),
        /** The words of the transcript this item comes from, copied exactly. */
        quote: z.string().min(1).max(500),
        /** Delays only: hours lost, only when the quote says how long. */
        hours: z.number().min(0).max(24).nullable(),
        /** Delays only. */
        delayType: z.enum(VOICE_DELAY_TYPES).nullable(),
        /** Observations only: "serious" for an injury, a near miss or an immediate danger. */
        severity: z.enum(['minor', 'serious']).nullable(),
        /** Tasks only, and only when the quote gives a date or day. */
        dueDate: LocalDate.nullable(),
      }),
    )
    .max(60),
});
export type VoiceLogOutput = z.infer<typeof VoiceLogOutput>;

const SYSTEM = `You turn what a site supervisor said into their diary at the end of an Australian building site day into separate records for them to review. The diary may later be relied on in a dispute, so accuracy matters more than completeness.

${UNTRUSTED_CONTENT_RULE}

The input is the diary date and a speech-to-text transcript, which may have no punctuation and small recognition errors. Produce one item for each separate thing the transcript records.

Rules:
- kind "note" is what happened on site: work done, progress, visitors, inspections, deliveries, conditions. Merge related facts into one clear sentence per topic.
- kind "delay" is time lost to something outside the crew's control. Set delayType to the nearest of weather, client, design, subcontractor, authority, industrial or other. Set hours only when the quote says how long (a number or "half an hour"); otherwise null. Never work out hours from other facts.
- kind "observation" is a safety hazard, unsafe act, near miss or injury someone saw or reported. severity is "serious" for an injury, a near miss or an immediate danger, otherwise "minor".
- kind "task" is something someone must still do ("order more formwork", "get the electrician back Monday"). dueDate only when the quote gives a date or a day you can resolve from the diary date; otherwise null.
- text is plain, factual and short. Use only facts in the transcript. Never add causes, quantities, names, times or outcomes it does not give. Copy numbers, names and dates exactly as spoken.
- quote is the words of the transcript the item comes from, copied exactly, character for character, from one place. An item without a quote must not be written.
- hours, delayType, severity and dueDate are null on kinds they do not apply to.
- Do not write an item twice. Skip filler, greetings and anything you cannot tie to a quote.
- Keep items in the order they were spoken.`;

export const voiceLogPrompt = definePrompt({
  id: 'voice.log',
  version: 1,
  feature: 'diary_summary',
  kind: 'interactive',
  tier: 'standard',
  system: SYSTEM,
  input: VoiceLogInput,
  output: VoiceLogOutput,
  render: (i) => ({
    text: [
      '<input>',
      `Date: ${i.date}`,
      `<transcript>\n${escapeContent(i.transcript)}\n</transcript>`,
      '</input>',
    ].join('\n'),
  }),
  maxOutputTokens: 4000,
});
