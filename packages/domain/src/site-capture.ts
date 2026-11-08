// Site capture: 360 tours (Matterport and similar) that people embed in a project by pasting a share link. Pure
// rules shared by the API and the web app, so both agree on which links are accepted and what to call them.

export type CaptureProvider = 'matterport' | 'kuula' | 'ricoh';

export const CAPTURE_PROVIDER_LABEL: Readonly<Record<CaptureProvider, string>> = {
  matterport: 'Matterport',
  kuula: 'Kuula',
  ricoh: 'Ricoh Tours',
};

/**
 * Where each provider's tours are served from. Only these hosts are embedded, so a pasted link can't make the app
 * frame an arbitrary site. The web app's content security policy lists the same hosts (`frame-src`).
 */
export const CAPTURE_HOSTS: Readonly<Record<CaptureProvider, readonly string[]>> = {
  matterport: ['my.matterport.com', 'matterport.com'],
  kuula: ['kuula.co'],
  ricoh: ['theta360.com', 'ricoh360.com'],
};

const matches = (host: string, allowed: string) => host === allowed || host.endsWith(`.${allowed}`);

export interface ParsedCaptureLink {
  provider: CaptureProvider;
  /** The link as the iframe loads it: https, no credentials, no fragment. */
  url: string;
}

/** The provider and clean embed URL for a pasted share link, or null when it is not a link we embed. */
export function parseCaptureLink(raw: string): ParsedCaptureLink | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  const provider = (Object.keys(CAPTURE_HOSTS) as CaptureProvider[]).find((p) =>
    CAPTURE_HOSTS[p].some((h) => matches(host, h)),
  );
  if (!provider) return null;
  // A bare host is not a tour.
  if (u.pathname === '/' && !u.search) return null;
  u.hash = '';
  return { provider, url: u.toString() };
}

/** Every host the web app must allow to be framed, with the wildcard for subdomains. */
export const CAPTURE_FRAME_SOURCES: readonly string[] = Object.values(CAPTURE_HOSTS)
  .flat()
  .flatMap((h) => [`https://${h}`, `https://*.${h}`]);
