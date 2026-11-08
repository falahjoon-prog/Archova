// Observation types: a built-in catalogue (group -> types) that a builder can extend with their own types and
// tune per project (hide a type, require an attachment). Pure, no IO.
import type { ObservationType } from './observation';

export interface BuiltInType {
  key: string;
  /** The heading it appears under in the picker. */
  group: string;
  name: string;
  /** The register category (the four values an observation is filed under). */
  category: ObservationType;
  requiresAttachment: boolean;
  /** Words in a checklist item or section that point to this type, for the suggestion. */
  hints: readonly string[];
}

export const BUILT_IN_TYPES: readonly BuiltInType[] = [
  {
    key: 'commissioning',
    group: 'Commissioning',
    name: 'Commissioning',
    category: 'quality',
    requiresAttachment: false,
    hints: ['commission', 'test', 'handover'],
  },
  {
    key: 'conforming',
    group: 'Environmental',
    name: 'Conforming',
    category: 'environmental',
    requiresAttachment: false,
    hints: [],
  },
  {
    key: 'environmental_non_conformance',
    group: 'Environmental',
    name: 'Non-Conformance',
    category: 'environmental',
    requiresAttachment: false,
    hints: ['dust', 'spill', 'erosion', 'sediment', 'waste', 'noise', 'environment'],
  },
  {
    key: 'quality_finding',
    group: 'Quality',
    name: 'Finding',
    category: 'quality',
    requiresAttachment: false,
    hints: ['finish', 'defect', 'tolerance', 'spec'],
  },
  {
    key: 'hold_point',
    group: 'Quality',
    name: 'Hold Point',
    category: 'quality',
    requiresAttachment: false,
    hints: ['hold', 'witness', 'sign off', 'pour', 'inspection before'],
  },
  {
    key: 'safety_hazard',
    group: 'Safety',
    name: 'Safety Hazard',
    category: 'safety',
    requiresAttachment: true,
    hints: [
      'safety',
      'hazard',
      'ppe',
      'fall',
      'edge',
      'trip',
      'guard',
      'scaffold',
      'exclusion',
      'housekeeping',
      'debris',
    ],
  },
  {
    key: 'safety_near_miss',
    group: 'Safety',
    name: 'Near Miss',
    category: 'safety',
    requiresAttachment: false,
    hints: ['near miss', 'close call'],
  },
  {
    key: 'commercial_variation',
    group: 'Commercial',
    name: 'Variation Risk',
    category: 'commercial',
    requiresAttachment: false,
    hints: ['variation', 'scope', 'extra'],
  },
];

/** A stored row: either a custom type (name set) or an override of a built-in one (key set). */
export interface TypeRow {
  id: string;
  /** Null for the whole organisation. */
  projectId: string | null;
  /** The built-in key this row overrides, or null for a custom type. */
  key: string | null;
  group: string | null;
  name: string | null;
  category: ObservationType | null;
  requiresAttachment: boolean | null;
  hidden: boolean;
}

export interface ResolvedType {
  /** A built-in key, or `custom:<id>` for a custom type. */
  key: string;
  group: string;
  name: string;
  category: ObservationType;
  requiresAttachment: boolean;
  builtIn: boolean;
  hidden: boolean;
}

export const customKey = (id: string) => `custom:${id}`;

/**
 * The types a project offers. A project's own override beats the organisation's; custom types from either level
 * are added. Hidden types stay in the list (so an admin can show them again) but are flagged.
 */
export function resolveTypes(rows: readonly TypeRow[], projectId: string): ResolvedType[] {
  const applies = rows.filter((r) => r.projectId === null || r.projectId === projectId);
  const out: ResolvedType[] = BUILT_IN_TYPES.map((b) => {
    const org = applies.find((r) => r.key === b.key && r.projectId === null);
    const own = applies.find((r) => r.key === b.key && r.projectId === projectId);
    const pick = <T>(f: (r: TypeRow) => T | null | undefined, base: T): T =>
      (own && f(own) != null ? f(own) : org && f(org) != null ? f(org) : base) as T;
    return {
      key: b.key,
      group: b.group,
      name: b.name,
      category: b.category,
      requiresAttachment: pick((r) => r.requiresAttachment, b.requiresAttachment),
      builtIn: true,
      hidden: pick((r) => r.hidden, false),
    };
  });
  for (const r of applies) {
    if (r.key !== null || !r.name || !r.category) continue;
    out.push({
      key: customKey(r.id),
      group: r.group?.trim() || 'Custom',
      name: r.name,
      category: r.category,
      requiresAttachment: r.requiresAttachment ?? false,
      builtIn: false,
      hidden: r.hidden,
    });
  }
  return out;
}

export interface PickerGroup {
  group: string;
  types: ResolvedType[];
}

/** The picker: a "Recents" group first (the person's latest types), then each group in order, filtered by `q`. */
export function pickerGroups(
  types: readonly ResolvedType[],
  recentKeys: readonly string[],
  q: string,
): PickerGroup[] {
  const needle = q.trim().toLowerCase();
  const visible = types.filter(
    (t) => !t.hidden && (!needle || `${t.name} ${t.group}`.toLowerCase().includes(needle)),
  );
  const groups = new Map<string, ResolvedType[]>();
  for (const t of visible) groups.set(t.group, [...(groups.get(t.group) ?? []), t]);
  const recents = recentKeys
    .map((k) => visible.find((t) => t.key === k))
    .filter((t): t is ResolvedType => !!t)
    .slice(0, 3);
  return [
    ...(recents.length ? [{ group: 'Recents', types: recents }] : []),
    ...[...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, ts]) => ({ group, types: ts })),
  ];
}

/** Why an observation can't be saved with its type, or null. */
export function typeProblem(
  type: Pick<ResolvedType, 'requiresAttachment' | 'name'> | undefined,
  fileCount: number,
): { code: 'observation.attachment_required'; message: string } | null {
  if (type?.requiresAttachment && fileCount === 0)
    return {
      code: 'observation.attachment_required',
      message: `An attachment is required for ${type.name}.`,
    };
  return null;
}

export interface TypeSuggestion {
  key: string;
  /** Why this type: the history it came from, or the words that matched. */
  reason: 'previous_observations' | 'keywords';
}

/**
 * The likely type for an observation raised from a checklist item. It prefers what people chose before for the
 * same item, then falls back to words in the item and its section. A rule, not a model: a person always picks.
 */
export function suggestType(
  types: readonly ResolvedType[],
  ctx: { prompt: string; section: string; history: readonly string[] },
): TypeSuggestion | null {
  const usable = types.filter((t) => !t.hidden);
  const counts = new Map<string, number>();
  for (const k of ctx.history) counts.set(k, (counts.get(k) ?? 0) + 1);
  const best = [...counts.entries()]
    .filter(([k]) => usable.some((t) => t.key === k))
    .sort((a, b) => b[1] - a[1])[0];
  if (best) return { key: best[0], reason: 'previous_observations' };
  const text = `${ctx.section} ${ctx.prompt}`.toLowerCase();
  let match: { key: string; score: number } | null = null;
  for (const b of BUILT_IN_TYPES) {
    if (!usable.some((t) => t.key === b.key)) continue;
    const score = b.hints.filter((h) => text.includes(h)).length;
    if (score > 0 && (!match || score > match.score)) match = { key: b.key, score };
  }
  return match ? { key: match.key, reason: 'keywords' } : null;
}
