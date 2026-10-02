'use client';

import { useSheets } from './useDrawings';

export interface SheetOption {
  sheetId: string;
  revisionId: string;
  /** "A-101 Rev C". */
  label: string;
  title: string;
}

/** Current sheets as picker options, so RFIs and defects can reference a drawing revision. */
export function useSheetPicker(projectId: string) {
  const sheets = useSheets(projectId, {});
  const options: SheetOption[] = (sheets.data ?? []).map((s) => ({
    sheetId: s.id,
    revisionId: s.currentRevisionId,
    label: `${s.sheetNumber} Rev ${s.currentRev}`,
    title: s.title,
  }));
  return { options, isPending: sheets.isPending };
}
