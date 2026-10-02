/** Folder privacy (DOC-US9): a private folder hides itself and everything below it. */
export interface FolderAccessRow {
  id: string;
  parentId: string | null;
  isPrivate: boolean;
  allowedUserIds: readonly string[];
  allowedCompanyIds: readonly string[];
}

export interface Viewer {
  userId: string;
  companyId: string | null;
  /** Document admins (and org owners/admins) see private folders. */
  seesPrivate: boolean;
}

function allowed(f: FolderAccessRow, v: Viewer): boolean {
  if (!f.isPrivate || v.seesPrivate) return true;
  if (f.allowedUserIds.includes(v.userId)) return true;
  return v.companyId !== null && f.allowedCompanyIds.includes(v.companyId);
}

/** Ids of folders the viewer cannot open, including descendants of hidden folders. */
export function hiddenFolderIds(folders: readonly FolderAccessRow[], viewer: Viewer): Set<string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const memo = new Map<string, boolean>();
  const hidden = (id: string, depth = 0): boolean => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const f = byId.get(id);
    // Unknown parents and cycles deeper than any real tree fail closed.
    if (!f || depth > 64) return true;
    const result = !allowed(f, viewer) || (f.parentId !== null && hidden(f.parentId, depth + 1));
    memo.set(id, result);
    return result;
  };
  return new Set(folders.filter((f) => hidden(f.id)).map((f) => f.id));
}
