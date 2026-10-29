// Defect pins on a drawing sheet (DEF-AC; pins are held as normalised 0..1 sheet coordinates).
// Pure so it runs in Node tests; the viewer draws them with `pinToScreen`.

/** The part of a defect the sheet needs; structural, so this feature does not import the defects feature. */
export interface PinnableDefect {
  id: string;
  number: number | null;
  title: string;
  status: string;
  priority: string;
  drawingRevisionId: string | null;
  pinX: number | null;
  pinY: number | null;
}

export interface SheetPin {
  defectId: string;
  /** "#12" once the server has numbered the defect, else a short mark for one still waiting to sync. */
  label: string;
  title: string;
  pinX: number;
  pinY: number;
  priority: string;
  /** Closed or void defects stay on the sheet but are drawn quietly. */
  resolved: boolean;
}

const RESOLVED = new Set(['closed', 'void']);

export function pinsOnRevision(defects: readonly PinnableDefect[], revisionId: string): SheetPin[] {
  return (
    defects
      .filter(
        (d) =>
          d.drawingRevisionId === revisionId &&
          d.pinX !== null &&
          d.pinY !== null &&
          d.status !== 'draft',
      )
      .map((d) => ({
        defectId: d.id,
        label: d.number === null ? 'New' : `#${d.number}`,
        title: d.title,
        pinX: d.pinX as number,
        pinY: d.pinY as number,
        priority: d.priority,
        resolved: RESOLVED.has(d.status),
      }))
      // Resolved pins first, so open ones are drawn on top.
      .sort((a, b) => Number(b.resolved) - Number(a.resolved))
  );
}
