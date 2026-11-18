// Pure rules for conversations: what text is acceptable and who may take part.

export const SUBJECT_MAX = 200;
export const BODY_MAX = 5000;

/** Trims and checks a subject; returns the cleaned text or null when it is empty or too long. */
export function cleanSubject(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, ' ');
  return s.length >= 1 && s.length <= SUBJECT_MAX ? s : null;
}

/** Trims a message body (keeping inner line breaks); null when empty or too long. */
export function cleanBody(raw: string): string | null {
  const s = raw.trim();
  return s.length >= 1 && s.length <= BODY_MAX ? s : null;
}

/** A short single-line preview of a message for the Project home card. */
export function previewOf(body: string, max = 140): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** Conversations are the builder's team chat: outside users (subcontractors, owners) never see them. */
export const canTakePart = (principalType: string): boolean => principalType === 'member';
