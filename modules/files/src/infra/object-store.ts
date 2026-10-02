import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Storage port for the files module. S3 in every deployed environment; in-memory for tests. */
export interface ObjectStore {
  /** Presigned PUT that only accepts the declared size, type and SHA-256 (S3 rejects anything else). */
  presignPut(
    key: string,
    p: { contentType: string; contentLength: number; sha256Base64: string; expiresInS: number },
  ): Promise<{
    url: string;
    headers: Record<string, string>;
  }>;
  head(key: string): Promise<{ size: number; sha256Base64: string | null } | null>;
  copy(from: string, to: string): Promise<void>;
  delete(key: string): Promise<void>;
  presignGet(key: string, p: { contentDisposition: string; expiresInS: number }): Promise<string>;
}

export interface S3StoreConfig {
  bucket: string;
  region: string;
  /** Custom endpoint (MinIO locally). */
  endpoint?: string;
  forcePathStyle?: boolean;
}

export function createS3ObjectStore(cfg: S3StoreConfig): ObjectStore {
  const s3 = new S3Client({
    region: cfg.region,
    ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
    forcePathStyle: cfg.forcePathStyle ?? Boolean(cfg.endpoint),
  });
  const Bucket = cfg.bucket;
  return {
    async presignPut(key, p) {
      const cmd = new PutObjectCommand({
        Bucket,
        Key: key,
        ContentType: p.contentType,
        ContentLength: p.contentLength,
        ChecksumSHA256: p.sha256Base64,
      });
      const url = await getSignedUrl(s3, cmd, {
        expiresIn: p.expiresInS,
        signableHeaders: new Set(['content-type', 'content-length', 'x-amz-checksum-sha256']),
      });
      return {
        url,
        headers: { 'content-type': p.contentType, 'x-amz-checksum-sha256': p.sha256Base64 },
      };
    },
    async head(key) {
      try {
        const r = await s3.send(
          new HeadObjectCommand({ Bucket, Key: key, ChecksumMode: 'ENABLED' }),
        );
        return { size: r.ContentLength ?? 0, sha256Base64: r.ChecksumSHA256 ?? null };
      } catch (e) {
        if ((e as { name?: string }).name === 'NotFound') return null;
        throw e;
      }
    },
    async copy(from, to) {
      await s3.send(new CopyObjectCommand({ Bucket, Key: to, CopySource: `${Bucket}/${from}` }));
    },
    async delete(key) {
      await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    async presignGet(key, p) {
      return getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentDisposition: p.contentDisposition,
        }),
        {
          expiresIn: p.expiresInS,
        },
      );
    },
  };
}

/** In-memory store for tests and local runs without MinIO. `put` simulates the client's direct upload. */
export function createMemoryObjectStore() {
  const objects = new Map<string, { size: number; sha256Base64: string | null }>();
  const store: ObjectStore & {
    put(key: string, size: number, sha256Base64: string | null): void;
    keys(): string[];
  } = {
    async presignPut(key, p) {
      return {
        url: `memory://upload/${key}`,
        headers: { 'content-type': p.contentType, 'x-amz-checksum-sha256': p.sha256Base64 },
      };
    },
    async head(key) {
      return objects.get(key) ?? null;
    },
    async copy(from, to) {
      const o = objects.get(from);
      if (!o) throw new Error(`No object ${from}`);
      objects.set(to, { ...o });
    },
    async delete(key) {
      objects.delete(key);
    },
    async presignGet(key, p) {
      return `memory://download/${key}?disposition=${encodeURIComponent(p.contentDisposition)}&expires=${p.expiresInS}`;
    },
    put(key, size, sha256Base64) {
      objects.set(key, { size, sha256Base64 });
    },
    keys: () => [...objects.keys()],
  };
  return store;
}
