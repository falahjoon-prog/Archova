/**
 * Where module data comes from. Modules whose endpoints are in `@archova/contracts` (documents, drawings, Ask Nova)
 * call the API; the rest use the in-browser preview stores in `shared/mocks` until theirs land.
 * `NEXT_PUBLIC_PREVIEW_DATA=1` keeps every module on preview data, for design reviews without an API, and unit
 * tests always use it. API-backed sources have their own tests with the client mocked.
 */
export const previewDataOnly =
  process.env.NEXT_PUBLIC_PREVIEW_DATA === '1' || process.env.NODE_ENV === 'test';

/** Follows `nextCursor` until the last page. Lists here are bounded per project (a register, a folder). */
export async function allPages<T>(
  fetchPage: (cursor: string | undefined) => Promise<{ data: T[]; nextCursor: string | null }>,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    out.push(...page.data);
    if (!page.nextCursor) return out;
    cursor = page.nextCursor;
  }
}
