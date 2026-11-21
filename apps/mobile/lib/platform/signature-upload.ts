// Draws a saved signature to a PNG and sends it to storage; used when a queued pre-task plan is replayed.
import type { ApiClient } from '@archova/api-client';
import { saveSignature, uploadSignature } from '../../features/toolbox';
import type { SignatureUploader } from '../actions/pretask-send';
import { createUploadApi } from '../files/api';
import { backgroundFileTransfer } from './file-transfer';

export function createSignatureUploader(api: ApiClient, orgId: string): SignatureUploader {
  return async (key, projectId, strokes) => {
    const image = await saveSignature(key.replace(/[^0-9A-Za-z_-]/g, '-'), strokes);
    const file = await uploadSignature(createUploadApi(api, orgId), backgroundFileTransfer, {
      projectId,
      idempotencyKey: key,
      image,
    });
    return file.id;
  };
}
