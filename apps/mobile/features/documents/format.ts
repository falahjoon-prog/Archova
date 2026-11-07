import type { LocalDate } from '@archova/time';

export const DOC_STATUS_TEXT: Record<string, string> = {
  draft: 'Draft',
  for_review: 'For review',
  approved: 'Approved',
  for_construction: 'For construction',
  superseded: 'Superseded',
  void: 'Void',
};

export const docStatusLabel = (s: string) => DOC_STATUS_TEXT[s] ?? s;

/** "12 Nov 2026" from a project-local day, with no zone maths. */
export function dayText(date: LocalDate | null): string | null {
  if (!date) return null;
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** One line for a document row: number, revision, status, discipline. */
export function documentSubtitle(d: {
  docNumber: string | null;
  discipline: string | null;
  status: string;
  currentRevision: { rev: string } | null;
}): string {
  return [
    d.docNumber,
    d.currentRevision ? `Rev ${d.currentRevision.rev}` : null,
    docStatusLabel(d.status),
    d.discipline,
  ]
    .filter((x): x is string => Boolean(x))
    .join(', ');
}

/** Folders in tree order (parents before children) with a depth for indenting. */
export function folderRows<T extends { id: string; parentId: string | null; name: string }>(
  folders: readonly T[],
): { folder: T; depth: number }[] {
  const byParent = new Map<string | null, T[]>();
  for (const f of folders) {
    const key = f.parentId !== null && folders.some((x) => x.id === f.parentId) ? f.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), f]);
  }
  const out: { folder: T; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const f of (byParent.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
