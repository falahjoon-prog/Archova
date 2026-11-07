// Related items (module `links`): any record can be linked to any other on the same project, from either end.
// The link stores the *forward* reason ("A is caused by B"); each end reads it in its own voice via `linkReasonLabel`.

/**
 * Record types a link can join. A type is listed here once its owning module can say, for the caller, which ids
 * they may open (`LinkSource` in the kernel) and is registered in `packages/compose`. The value is also the id kind
 * (`encodeId(type, uuid)`). To add one: add it here, give the module a `linkSummaries` and register it in compose.
 */
export const LINK_ENTITY_TYPES = [
  'rfi',
  'defect',
  'submittal',
  'correspondence',
  'document',
] as const;
export type LinkEntityType = (typeof LINK_ENTITY_TYPES)[number];

/** Why two records are linked, read as "<from> <reason> <to>". `related` is the plain, symmetric link. */
export const LINK_REASONS = [
  'related',
  'caused_by',
  'blocked_by',
  'responds_to',
  'duplicate_of',
  'supersedes',
] as const;
export type LinkReason = (typeof LINK_REASONS)[number];

/** Who made the link: a person, Nova (suggested then accepted by a person), or a module acting on a conversion. */
export const LINK_ORIGINS = ['user', 'nova', 'system'] as const;
export type LinkOrigin = (typeof LINK_ORIGINS)[number];

/** Most links one record carries; keeps the panel readable and a graph walk bounded. */
export const MAX_LINKS_PER_ENTITY = 100;
export const LINK_NOTE_MAX = 300;

const FORWARD: Record<LinkReason, string> = {
  related: 'Related to',
  caused_by: 'Caused by',
  blocked_by: 'Blocked by',
  responds_to: 'Responds to',
  duplicate_of: 'Duplicate of',
  supersedes: 'Supersedes',
};
const INVERSE: Record<LinkReason, string> = {
  related: 'Related to',
  caused_by: 'Led to',
  blocked_by: 'Blocks',
  responds_to: 'Answered by',
  duplicate_of: 'Has duplicate',
  supersedes: 'Superseded by',
};

/** `side` is where the record being looked at sits: `from` reads the forward voice, `to` the inverse. */
export const linkReasonLabel = (reason: LinkReason, side: 'from' | 'to') =>
  side === 'from' ? FORWARD[reason] : INVERSE[reason];

export const isSymmetricReason = (reason: LinkReason) => reason === 'related';

export const cleanLinkNote = (note: string | null | undefined): string | null => {
  const t = (note ?? '').replace(/\s+/g, ' ').trim();
  return t.length === 0 ? null : t.slice(0, LINK_NOTE_MAX);
};
