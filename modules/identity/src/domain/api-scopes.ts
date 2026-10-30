// Scopes for personal access tokens (integrations/06 §2). Coarse, per area, `read` or `write`; `write` includes `read`.
// A scope only narrows a token: the owner's own permissions in the org still apply on top.

export const TOKEN_PREFIX = 'pk_live_';
export const MAX_TOKEN_LIFETIME_DAYS = 365;
export const DEFAULT_TOKEN_LIFETIME_DAYS = 90;

const AREAS = [
  'projects',
  'directory',
  'documents',
  'rfis',
  'submittals',
  'diary',
  'defects',
  'correspondence',
  'meetings',
  'estimating',
  'financials',
] as const;

/** Every scope a token may be created with. Personal tokens never hold `financials:write` (integrations/06 §2). */
export const TOKEN_SCOPES: readonly string[] = AREAS.flatMap((a) =>
  a === 'financials' ? [`${a}:read`] : [`${a}:read`, `${a}:write`],
);

/** Which scope area guards each module's operations. Modules not listed are not offered to tokens. */
const AREA_BY_MODULE: Readonly<Record<string, (typeof AREAS)[number]>> = {
  platform: 'projects',
  documents: 'documents',
  files: 'documents',
  rfis: 'rfis',
  submittals: 'submittals',
  diary: 'diary',
  defects: 'defects',
  estimating: 'estimating',
};

/** The scope an operation needs, or null when tokens may not call it at all. */
export function requiredScope(module: string | null, method: string): string | null {
  const area = module ? AREA_BY_MODULE[module] : undefined;
  if (!area) return null;
  return `${area}:${method === 'GET' || method === 'HEAD' ? 'read' : 'write'}`;
}

export function scopeAllows(granted: readonly string[], needed: string): boolean {
  if (granted.includes(needed)) return true;
  return needed.endsWith(':read') && granted.includes(`${needed.slice(0, -5)}:write`);
}

/** Unknown scopes, in the order given. */
export const unknownScopes = (scopes: readonly string[]) =>
  scopes.filter((s) => !TOKEN_SCOPES.includes(s));
