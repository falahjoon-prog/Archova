// Nova drafts a project announcement (Ai on top): the person pastes or types what changed (a schedule change, a
// site rule, a delivery) and gets a short title and message for the team to edit and post. Code removes any
// sentence with a date, time or number the notes don't contain, so Nova cannot invent facts. Nothing is posted.
import { UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';

export const AnnouncementDraftInput = z.object({
  notes: z.string().min(1).max(4000),
  /** Who it is for, in the person's words (for example "all trades"). */
  audience: z.string().max(200),
});
export type AnnouncementDraftInput = z.infer<typeof AnnouncementDraftInput>;

export const AnnouncementDraftOutput = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(2500),
  priority: z.enum(['normal', 'important']),
});
export type AnnouncementDraftOutput = z.infer<typeof AnnouncementDraftOutput>;

const SYSTEM = `You write short announcements for the team on an Australian building project. A site or project manager gives you rough notes about something that changed, and you turn them into a clear message the whole team can read in ten seconds. They review and edit it before posting.

${UNTRUSTED_CONTENT_RULE}

Rules:
- Use only what the notes say. Never add dates, times, amounts, names, locations, reasons or consequences that are not in the notes, even if they seem likely. If the notes leave something out, leave it out of the message too.
- Copy dates, times, numbers and names exactly as written in the notes.
- Lead with what is changing and who needs to do something. Put any action or deadline before background.
- title: under 100 characters, specific (say what changed), no all caps.
- body: two to six short sentences or a few short lines, plain Australian English, no headings, no emoji, no sign-off.
- priority: important only when the notes say something is urgent, a safety matter, or needs action within a day; otherwise normal.`;

export const announcementDraftPrompt = definePrompt({
  id: 'announcement.draft',
  version: 1,
  feature: 'announcement_draft',
  kind: 'interactive',
  tier: 'fast',
  system: SYSTEM,
  input: AnnouncementDraftInput,
  output: AnnouncementDraftOutput,
  render: (i) => ({
    text: `<input>\n${i.audience ? `For: ${escapeContent(i.audience)}\n` : ''}<notes>${escapeContent(i.notes)}</notes>\n</input>`,
  }),
  maxOutputTokens: 800,
});
