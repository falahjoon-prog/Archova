// The "this sheet has been replaced" banner (DOC-AC6): a superseded revision names the one that replaced it.
// Pure, so it runs in Node tests.

export interface RevisionForBanner {
  status: string;
  rev: string;
  supersededBy: { revisionId: string; rev: string; at: string } | null;
}

export interface SupersededNotice {
  message: string;
  /** The revision to open instead. */
  latestRevisionId: string;
}

export function supersededNotice(r: RevisionForBanner): SupersededNotice | null {
  if (r.status !== 'superseded') return null;
  if (!r.supersededBy) {
    return { message: `Rev ${r.rev} is out of date.`, latestRevisionId: '' };
  }
  return {
    message: `Rev ${r.rev} is out of date. Rev ${r.supersededBy.rev} replaced it. Do not build from this sheet.`,
    latestRevisionId: r.supersededBy.revisionId,
  };
}
