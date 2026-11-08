// Checks Nova's announcement draft against the notes it came from. A date, time, number, weekday or month in the
// draft that the notes don't contain is not allowed through: the sentence goes, and the person is told. Pure, no IO.
import type { AnnouncementDraftOutput } from '@archova/ai-prompts';

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const WORDS =
  /\b(mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\b|\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\b(today|tomorrow|tonight|yesterday)\b/gi;

const num = (s: string) => Number(s.replace(/,/g, ''));

/** The numbers and day/month words in a text, for comparing the draft with the notes. */
function facts(text: string) {
  return {
    numbers: new Set([...text.matchAll(NUMBER)].map((m) => num(m[0]))),
    words: new Set([...text.matchAll(WORDS)].map((m) => m[0].toLowerCase().slice(0, 3))),
  };
}

function supported(text: string, from: ReturnType<typeof facts>): boolean {
  const f = facts(text);
  for (const n of f.numbers) if (!from.numbers.has(n)) return false;
  // "today"/"tomorrow" are relative and carry no fact of their own unless the notes use them.
  for (const w of f.words) if (!from.words.has(w)) return false;
  return true;
}

export interface ReviewedAnnouncementDraft extends AnnouncementDraftOutput {
  notes: string[];
}

export function reviewAnnouncementDraft(
  out: AnnouncementDraftOutput,
  notesText: string,
): ReviewedAnnouncementDraft {
  const from = facts(notesText);
  const notes: string[] = [];
  let title = out.title.trim().replace(/\s+/g, ' ');
  if (!supported(title, from)) {
    title = 'Project update';
    notes.push("The title had a date or number your notes don't mention, so it was replaced.");
  }
  // Keep the line breaks the model chose; check sentence by sentence inside each line.
  let dropped = 0;
  const lines = out.body
    .split('\n')
    .map((line) => {
      const sentences = line.split(/(?<=[.!?])\s+/).filter(Boolean);
      const kept = sentences.filter((s) => supported(s, from));
      dropped += sentences.length - kept.length;
      return kept.join(' ');
    })
    .filter((l) => l.trim());
  if (dropped > 0)
    notes.push(
      `Removed ${dropped} sentence${dropped === 1 ? '' : 's'} with a date, day or number your notes don't mention.`,
    );
  return { title, body: lines.join('\n'), priority: out.priority, notes };
}
