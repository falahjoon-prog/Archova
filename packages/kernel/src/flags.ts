// Feature flags (backend 09 §5). Flags launch features; licences sell them, so a flag never makes an unlicensed
// module reachable. Keys must exist here with an owner and a removal date, and the owner console edits the rules.

export interface FlagDef {
  key: string;
  description: string;
  owner: string;
  /** The day the flag and its code path should be gone (ISO date). */
  removeBy: string;
}

export const FLAG_REGISTRY: readonly FlagDef[] = [
  {
    key: 'nova_estimating',
    description: 'Nova estimating: quantity take-off and quote comparison suggestions.',
    owner: 'Ari',
    removeBy: '2027-06-30',
  },
  {
    key: 'photo_progress_flags',
    description: 'Photo-to-progress flags on site photos (flags only, never a percentage).',
    owner: 'Ari',
    removeBy: '2027-06-30',
  },
  {
    key: 'subcontractor_wallet',
    description: 'Subcontractor compliance wallet and expiry reminders.',
    owner: 'Ben',
    removeBy: '2027-06-30',
  },
];

export const FLAG_KEYS = FLAG_REGISTRY.map((f) => f.key);

/** What an org's evaluation needs from the stored rules. A killed flag is simply stored with no rules. */
export interface FlagRules {
  key: string;
  enabledForAll: boolean;
  /** 0-100, a stable share of orgs. */
  percent: number;
  orgIds: ReadonlySet<string>;
  cohortIds: ReadonlySet<string>;
}

/** FNV-1a, so the same org always lands in the same bucket for a flag. */
export function flagBucket(key: string, orgId: string): number {
  let h = 0x811c9dc5;
  for (const ch of `${key}:${orgId}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

/** Off unless a rule turns it on for this org. `orgCohortIds` are the pilot cohorts the org belongs to. */
export function evaluateFlag(
  rules: FlagRules | undefined,
  org: { id: string; cohortIds: readonly string[] },
): boolean {
  if (!rules) return false;
  if (rules.enabledForAll) return true;
  if (rules.orgIds.has(org.id)) return true;
  if (org.cohortIds.some((c) => rules.cohortIds.has(c))) return true;
  return rules.percent > 0 && flagBucket(rules.key, org.id) < rules.percent;
}
