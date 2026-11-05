import {
  FolderProviderError,
  type FolderProvider,
  type FolderProviderName,
  type FolderRef,
} from './types';

interface Node {
  id: string;
  parent: string | null;
  name: string;
  folder: boolean;
  bytes?: Uint8Array;
}

/** In-memory SharePoint or Drive for tests and for local development before the real apps are registered. */
export function createFakeFolderProvider(name: FolderProviderName = 'm365') {
  const nodes = new Map<string, Node>();
  let seq = 0;
  const mk = (parent: string | null, n: string, folder: boolean, bytes?: Uint8Array) => {
    const node: Node = {
      id: `fake-${++seq}`,
      parent,
      name: n,
      folder,
      ...(bytes ? { bytes } : {}),
    };
    nodes.set(node.id, node);
    return node;
  };
  const child = (parent: string, n: string) =>
    [...nodes.values()].find((x) => x.parent === parent && x.name === n);
  const failures: FolderProviderError[] = [];

  const provider: FolderProvider = {
    async resolveTarget({ url, projectName }) {
      const f = failures.shift();
      if (f) throw f;
      if (name === 'm365') {
        if (!url?.startsWith('https://')) {
          throw new FolderProviderError(
            name,
            400,
            'bad_target',
            false,
            'Not a SharePoint folder address',
          );
        }
        const root = mk(null, 'Shared Documents', true);
        const n = mk(root.id, url.split('/').pop() ?? 'folder', true);
        return { driveId: 'fake-drive', folderId: n.id, name: n.name, webUrl: url };
      }
      const n = mk(null, `Archova - ${projectName}`, true);
      return { driveId: null, folderId: n.id, name: n.name, webUrl: `https://drive.fake/${n.id}` };
    },
    async ensureSubfolder(parent: FolderRef, n) {
      return { folderId: (child(parent.folderId, n) ?? mk(parent.folderId, n, true)).id };
    },
    async uploadFile(parent, file) {
      const f = failures.shift();
      if (f) throw f;
      const existing = child(parent.folderId, file.name);
      if (existing) {
        existing.bytes = file.bytes;
        return { remoteId: existing.id, webUrl: null };
      }
      return { remoteId: mk(parent.folderId, file.name, false, file.bytes).id, webUrl: null };
    },
    async moveFile(_drive, remoteId, _from, to) {
      const n = nodes.get(remoteId);
      if (!n) throw new FolderProviderError(name, 404, 'missing', false, 'Remote file is gone');
      n.parent = to;
    },
  };
  return {
    provider,
    /** Queue an error for the next resolve or upload call. */
    failNext: (e: FolderProviderError) => failures.push(e),
    /** Names of the files in a folder, for assertions. */
    list: (folderId: string) =>
      [...nodes.values()]
        .filter((x) => x.parent === folderId && !x.folder)
        .map((x) => x.name)
        .sort(),
    folderIdByName: (n: string) => [...nodes.values()].find((x) => x.folder && x.name === n)?.id,
  };
}
