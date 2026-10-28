import type { Access, CollectionBeforeChangeHook, FieldHook } from 'payload';

export type Role = 'author' | 'editor' | 'admin';

const roleOf = (user: unknown): Role | undefined => (user as { role?: Role } | null)?.role;

export const isStaff: Access = ({ req }) => Boolean(req.user);
export const isAdmin: Access = ({ req }) => roleOf(req.user) === 'admin';

/** The public sees published content only; signed-in staff also see drafts. */
export const publishedOrStaff: Access = ({ req }) =>
  req.user ? true : { _status: { equals: 'published' } };

/** WEB-AC3: authors write drafts, editors and admins publish. */
export const onlyEditorsPublish: CollectionBeforeChangeHook = ({ data, req }) => {
  if (data._status === 'published' && req.user && roleOf(req.user) === 'author') {
    throw new Error('Authors can save drafts. An editor or admin publishes.');
  }
  return data;
};

export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Fills the slug from the title when the editor leaves it empty. */
export const slugFromTitle: FieldHook = ({ value, data }) =>
  typeof value === 'string' && value.length > 0
    ? slugify(value)
    : slugify(String(data?.title ?? ''));
