// The upload operations through the typed API client (no hand-written fetch, mobile 01 §1.2).

import { ApiError, unwrap, type ApiClient } from '@archova/api-client';
import { UploadHttpError, type UploadApi } from './upload-queue';

function asUploadError(error: unknown): unknown {
  if (error instanceof ApiError) return new UploadHttpError(error.status, error.code);
  // fetch rejects with a TypeError when there is no network.
  if (error instanceof TypeError) return new UploadHttpError(0);
  return error;
}

export function createUploadApi(api: ApiClient, orgId: string): UploadApi {
  return {
    async createUpload(body, idempotencyKey) {
      try {
        return unwrap(
          await api.POST('/v1/orgs/{orgId}/uploads', {
            params: { path: { orgId }, header: { 'Idempotency-Key': idempotencyKey } },
            body,
          }),
        );
      } catch (error) {
        throw asUploadError(error);
      }
    },
    async completeUpload(uploadId) {
      try {
        return unwrap(
          await api.POST('/v1/orgs/{orgId}/uploads/{uploadId}/complete', {
            params: { path: { orgId, uploadId } },
          }),
        );
      } catch (error) {
        throw asUploadError(error);
      }
    },
  };
}
