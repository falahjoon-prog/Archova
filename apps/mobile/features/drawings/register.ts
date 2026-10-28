// Rows for the drawing register (DOC-AC5): one per sheet, showing its current revision.
import type { DrawingSheet as Sheet } from '@archova/contracts';

export interface RegisterRow {
  id: string;
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

export function registerRows(sheets: readonly Sheet[]): RegisterRow[] {
  return sheets.map((s) => {
    const rev = s.currentRevision;
    const parts = [
      s.discipline,
      rev ? `Rev ${rev.rev}` : 'No current revision',
      rev?.issuedFor ? issuedForLabel[rev.issuedFor] : null,
    ].filter((p): p is string => Boolean(p));
    return {
      id: s.id,
      title: `${s.sheetNumber} · ${s.title}`,
      subtitle: parts.join(' · '),
      hasRevision: rev !== null,
    };
  });
}
