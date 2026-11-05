// Rows for the drawing register (DOC-AC5): one per sheet, showing its current revision.
import type { DrawingSheet as Sheet } from '@archova/contracts';

export interface RegisterRow {
  id: string;
  /** The current revision to open, or null when there is none. */
  revisionId: string | null;
  title: string;
  subtitle: string;
  /** The sheet has no current revision, so there is nothing to open yet. */
  hasRevision: boolean;
}

const issuedForLabel: Record<string, string> = {
  preliminary: 'Preliminary',
  for_tender: 'For tender',
  for_approval: 'For approval',
  for_construction: 'For construction',
};

export function registerRows(
  sheets: readonly Sheet[],
  /** Revisions saved on this device, which open with no signal. */
  saved: ReadonlySet<string> = new Set(),
): RegisterRow[] {
  return [...sheets]
    .sort((a, b) => a.sheetNumber.localeCompare(b.sheetNumber, undefined, { numeric: true }))
    .map((s) => {
      const rev = s.currentRevision;
      const parts = [
        s.discipline,
        rev ? `Rev ${rev.rev}` : 'No current revision',
        rev?.issuedFor ? issuedForLabel[rev.issuedFor] : null,
        rev && saved.has(rev.id) ? 'Saved offline' : null,
      ].filter((p): p is string => Boolean(p));
      return {
        id: s.id,
        revisionId: rev?.id ?? null,
        title: `${s.sheetNumber} · ${s.title}`,
        subtitle: parts.join(' · '),
        hasRevision: rev !== null,
      };
    });
}
