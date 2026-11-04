// F7 meeting minutes to actions (ai/01 F7, product/07 MTG-US7): the notes someone typed or pasted from a meeting
// become minute items (information, decisions and actions) in the meeting's own sections, with an owner and a due
// date when the notes say so. Nova never writes into the minutes: the person reviews each proposed item and adds the
// ones they want. Every item quotes the words of the notes it comes from and code drops one whose quote isn't there,
// an owner the quote doesn't name, a due date the quote doesn't give, or a number the quote doesn't contain.
import { UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';

const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The longest notes one run reads (about 20 pages of typed minutes). */
export const MINUTES_NOTES_MAX = 40000;

export const MINUTE_ITEM_KINDS = ['information', 'decision', 'action'] as const;

export const MeetingMinutesInput = z.object({
  title: z.string().max(300),
  /** The day the meeting was held, in the project's time zone. */
  date: LocalDate,
  /** The agenda sections the items may go under: `s1` is the first. */
  sections: z
    .array(z.object({ id: z.string().regex(/^s\d{1,2}$/), title: z.string().max(300) }))
    .max(40),
  /** The people at the meeting, so an action's owner is one of them: `a1` is the first. */
  attendees: z
    .array(
      z.object({
        id: z.string().regex(/^a\d{1,3}$/),
        name: z.string().max(200),
        company: z.string().max(200),
      }),
    )
    .max(100),
  notes: z.string().min(1).max(MINUTES_NOTES_MAX),
});
export type MeetingMinutesInput = z.infer<typeof MeetingMinutesInput>;

export const MeetingMinutesOutput = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(MINUTE_ITEM_KINDS),
        /** The section it belongs under, or null when none fits. */
        sectionId: z.string().max(8).nullable(),
        text: z.string().min(1).max(600),
        /** The words of the notes this item comes from, copied exactly. */
        quote: z.string().min(1).max(500),
        /** The attendee an action is assigned to, only when the quote names them or their company. */
        ownerId: z.string().max(8).nullable(),
        /** The due date, only when the quote gives one. */
        dueDate: LocalDate.nullable(),
      }),
    )
    .max(80),
});
export type MeetingMinutesOutput = z.infer<typeof MeetingMinutesOutput>;

const SYSTEM = `You turn the notes of an Australian building project meeting into minute items for the site team to review. The minutes may later be relied on in a dispute, so accuracy matters more than completeness.

${UNTRUSTED_CONTENT_RULE}

The input lists the meeting's sections (s1, s2 ...), the people who attended (a1, a2 ...) and the notes. Produce one item for each decision made, action agreed and piece of information the notes record.

Rules:
- kind is "action" when someone is to do something, "decision" when the meeting agreed or resolved something, and "information" for status updates and facts. Do not turn discussion, opinions or questions that were not resolved into decisions or actions.
- text is one clear sentence in past or present tense for information and decisions, and an instruction for an action ("Confirm the crane booking for Monday"). Use only facts in the notes. Never add causes, quantities, names, times or outcomes that the notes do not give, even if they seem likely. Copy numbers, dates and names exactly as written.
- quote is the words from the notes the item comes from, copied exactly, character for character, from one place in the notes. An item without a quote must not be written.
- sectionId is the section the item fits best, or null when none fits. Never invent a section.
- ownerId is set only for an action, and only when the quote names the person (or their company) responsible. Choose among the attendees listed; if the quote does not name anyone, or names someone not listed, use null. Never guess an owner.
- dueDate is set only when the quote gives a date or a day you can resolve using the meeting date (for example "by Friday" or "next Tuesday" or "12 November"); otherwise null. Write it as YYYY-MM-DD and never before the meeting date.
- Do not write an item twice. Skip pleasantries, attendance, apologies and the time the meeting opened or closed.
- Keep items in the order the notes record them.`;

export const meetingMinutesPrompt = definePrompt({
  id: 'minutes.extract',
  version: 1,
  feature: 'minutes',
  kind: 'interactive',
  tier: 'standard',
  system: SYSTEM,
  input: MeetingMinutesInput,
  output: MeetingMinutesOutput,
  render: (i) => ({
    text: [
      '<input>',
      `Meeting: ${escapeContent(i.title)}`,
      `Date: ${i.date}`,
      ...i.sections.map((s) => `<section id="${s.id}">${escapeContent(s.title)}</section>`),
      ...i.attendees.map(
        (a) =>
          `<attendee id="${a.id}" company="${escapeContent(a.company)}">${escapeContent(a.name)}</attendee>`,
      ),
      `<notes>\n${escapeContent(i.notes)}\n</notes>`,
      '</input>',
    ].join('\n'),
  }),
  maxOutputTokens: 6000,
});
