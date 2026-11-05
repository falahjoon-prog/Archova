// Pure side of the activity links: turning stored links plus whatever the rfis/submittals modules let the caller
// see into the answer. An item the caller can't see (or that has gone) comes back with `visible: false` and no details.

export type LinkKind = 'rfi' | 'submittal';

export interface LinkRow {
  id: string;
  activityId: string;
  kind: LinkKind;
  targetId: string;
}

/** What a source module hands back for an item the caller can see. */
export interface LinkTarget {
  id: string;
  ref: string;
  title: string;
  status: string;
  dueDate: string | null;
  scheduleImpactDays: number | null;
}

export function resolveLinks(
  rows: readonly LinkRow[],
  found: Readonly<Record<LinkKind, ReadonlyMap<string, LinkTarget>>>,
) {
  return rows.map((r) => {
    const t = found[r.kind].get(r.targetId);
    return {
      row: r,
      visible: t !== undefined,
      ref: t?.ref ?? null,
      title: t?.title ?? null,
      status: t?.status ?? null,
      dueDate: t?.dueDate ?? null,
      scheduleImpactDays: t?.scheduleImpactDays ?? null,
    };
  });
}
