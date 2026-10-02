import { AppError } from './errors';

/** `ETag` value for a row version (api.md §3). */
export const etag = (version: number) => `"${version}"`;

/** Parses `If-Match`. Missing → 428; malformed → 412. */
export function parseIfMatch(header: string | undefined): number {
  if (!header)
    throw new AppError('precondition_required', 'If-Match header is required for updates.');
  const m = /^(?:W\/)?"(\d+)"$/.exec(header.trim());
  if (!m) throw new AppError('version_conflict', 'If-Match does not match the current version.');
  return Number(m[1]);
}
