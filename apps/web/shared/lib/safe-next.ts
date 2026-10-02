/**
 * Validates a `next` redirect target so sign-in can't be used as an open redirect.
 * Only same-origin absolute paths are allowed (`/acme/projects`, `/v1/oauth/authorize?...`).
 */
export function safeNextPath(next: string | null | undefined, fallback: string): string {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  if ([...next].some((ch) => ch.charCodeAt(0) < 0x20)) return fallback;
  try {
    const url = new URL(next, 'http://archova.invalid');
    if (url.origin !== 'http://archova.invalid') return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/** API paths (e.g. the OAuth authorise step for mobile sign-in) need a full page load, not client navigation. */
export function needsFullNavigation(path: string): boolean {
  return path.startsWith('/v1/') || path.startsWith('/.well-known/');
}
