export interface Teammate {
  userId: string;
  name: string;
}

/** What goes in the text when someone is mentioned. */
export const mentionText = (t: Teammate) => `@${t.name}`;

/** Adds "@Name " to the text, on a new word. */
export function insertMention(body: string, t: Teammate): string {
  const sep = body.length === 0 || /\s$/.test(body) ? '' : ' ';
  return `${body}${sep}${mentionText(t)} `;
}

/**
 * The people to notify: those picked whose "@Name" is still in the text. Deleting the text un-mentions them, so a
 * person is never told about a message that no longer names them.
 */
export function mentionedIn(body: string, picked: readonly Teammate[]): string[] {
  const lower = body.toLowerCase();
  const ids = picked
    .filter((t) => lower.includes(mentionText(t).toLowerCase()))
    .map((t) => t.userId);
  return [...new Set(ids)];
}
