import { compareRevisions } from './revisions';

/** A draft revision in a drawing set, as the publish check sees it. */
export interface DraftSheet {
  id: string;
  sheetNumber: string;
  rev: string;
}

/** What the register already holds for a sheet number. */
export interface ExistingSheet {
  currentRev: string | null;
  revs: readonly string[];
}

export type PublishConflictKind =
  'duplicate_in_set' | 'revision_exists' | 'older_than_current' | 'new_sheet';

export interface PublishConflict {
  revisionId: string;
  sheetNumber: string;
  kind: PublishConflictKind;
  /** Blocking conflicts must be fixed in the set; the others are cleared by confirming or giving a reason. */
  blocking: boolean;
  currentRev: string | null;
}

export const normaliseSheetNumber = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '');

/**
 * Pre-publish checks (DOC-AC3): the same sheet twice in one set or a revision that is already registered
 * block publishing; a revision older than current needs a reason; a sheet number not seen before needs
 * confirming as a new sheet.
 */
export function findPublishConflicts(
  drafts: readonly DraftSheet[],
  existing: ReadonlyMap<string, ExistingSheet>,
): PublishConflict[] {
  const out: PublishConflict[] = [];
  const seen = new Set<string>();
  for (const d of drafts) {
    const number = normaliseSheetNumber(d.sheetNumber);
    const sheet = existing.get(number);
    const base = { revisionId: d.id, sheetNumber: number, currentRev: sheet?.currentRev ?? null };
    if (seen.has(number)) {
      out.push({ ...base, kind: 'duplicate_in_set', blocking: true });
      continue;
    }
    seen.add(number);
    if (!sheet) {
      out.push({ ...base, kind: 'new_sheet', blocking: false });
      continue;
    }
    if (sheet.revs.some((r) => compareRevisions(r, d.rev) === 0)) {
      out.push({ ...base, kind: 'revision_exists', blocking: true });
    } else if (sheet.currentRev && compareRevisions(d.rev, sheet.currentRev) < 0) {
      out.push({ ...base, kind: 'older_than_current', blocking: false });
    }
  }
  return out;
}

/** Conflicts still open after the publisher's confirmations. */
export function unresolvedConflicts(
  conflicts: readonly PublishConflict[],
  input: { confirmNewSheets: boolean; reasons: ReadonlyMap<string, string> },
): PublishConflict[] {
  return conflicts.filter((c) => {
    if (c.blocking) return true;
    if (c.kind === 'new_sheet') return !input.confirmNewSheets;
    return !input.reasons.get(c.revisionId)?.trim();
  });
}
