// Native file area for saved drawing sheets (mobile 03 §3.3): app documents, so the OS does not clear it like a cache.
import * as FileSystem from 'expo-file-system/legacy';
import type { SheetFiles } from '../files/sheet-cache';

const folderOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);

export const sheetFiles: SheetFiles = {
  root: `${FileSystem.documentDirectory ?? ''}drawings/`,
  async download(url, to) {
    try {
      await FileSystem.makeDirectoryAsync(folderOf(to), { intermediates: true });
      const result = await FileSystem.downloadAsync(url, to);
      if (result.status !== 200) {
        await FileSystem.deleteAsync(to, { idempotent: true });
        return null;
      }
      const info = await FileSystem.getInfoAsync(to);
      return info.exists ? info.size : null;
    } catch {
      return null;
    }
  },
  async remove(path) {
    try {
      await FileSystem.deleteAsync(path, { idempotent: true });
    } catch {
      // Nothing to delete.
    }
  },
};
