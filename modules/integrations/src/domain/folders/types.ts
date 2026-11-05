export type FolderProviderName = 'm365' | 'google';

/** Where a link publishes to. `driveId` is a Microsoft drive id and null for Google. */
export interface FolderTarget {
  driveId: string | null;
  folderId: string;
  name: string;
  webUrl: string | null;
}
export interface FolderRef {
  driveId: string | null;
  folderId: string;
}

/** What the publish job needs from SharePoint or Drive. One-way: nothing here reads a customer's own files. */
export interface FolderProvider {
  /** Microsoft: resolves a pasted SharePoint folder address. Google: creates the folder Archova publishes into. */
  resolveTarget(input: { url?: string; projectName: string }): Promise<FolderTarget>;
  /** The named subfolder, created when missing. */
  ensureSubfolder(parent: FolderRef, name: string): Promise<{ folderId: string }>;
  /** Replaces a file of the same name, so a retried publish never leaves a duplicate. */
  uploadFile(
    parent: FolderRef,
    file: { name: string; contentType: string; bytes: Uint8Array },
  ): Promise<{ remoteId: string; webUrl: string | null }>;
  moveFile(
    drive: string | null,
    remoteId: string,
    fromFolderId: string,
    toFolderId: string,
  ): Promise<void>;
}

/** `auth`: access refused or revoked (a person must reconnect). `missing`: the folder is gone. `other`: retry may help. */
export class FolderProviderError extends Error {
  constructor(
    readonly provider: FolderProviderName,
    readonly status: number,
    readonly kind: 'auth' | 'missing' | 'bad_target' | 'other',
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
  }
}

export const MAX_PUBLISH_BYTES = 100 * 1024 * 1024;

/** Characters SharePoint or Drive refuse or mangle in a file name. */
export function publishedFileName(sheetNumber: string, rev: string, originalName: string): string {
  const dot = originalName.lastIndexOf('.');
  const ext = dot > 0 && originalName.length - dot <= 6 ? originalName.slice(dot) : '';
  const clean = (s: string) =>
    [...s]
      .map((ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|#%~&{}'.includes(ch) ? '-' : ch))
      .join('')
      .trim();
  return `${clean(sheetNumber)}_Rev-${clean(rev)}${clean(ext)}`.slice(0, 120);
}
