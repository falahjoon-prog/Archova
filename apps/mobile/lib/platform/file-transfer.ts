// Sends a file to its presigned URL in a native background session (iOS background URLSession, Android
// WorkManager), so an upload keeps going when the app is closed (mobile 03 §3.1).

import * as LegacyFileSystem from 'expo-file-system/legacy';
import type { FileTransfer } from '../files/upload-queue';

export const backgroundFileTransfer: FileTransfer = {
  async put(url, headers, localUri) {
    try {
      const result = await LegacyFileSystem.uploadAsync(url, localUri, {
        httpMethod: 'PUT',
        headers,
        uploadType: LegacyFileSystem.FileSystemUploadType.BINARY_CONTENT,
        sessionType: LegacyFileSystem.FileSystemSessionType.BACKGROUND,
      });
      return { status: result.status };
    } catch {
      return { status: 0 };
    }
  },
};
