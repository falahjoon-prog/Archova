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
  /** Reads a whole object, for server-side processing (Nova title blocks); null when it doesn't exist. */
  get(key: string): Promise<Uint8Array | null>;
}

export interface S3StoreConfig {
  bucket: string;
  region: string;
  /** Custom endpoint (MinIO locally). */
  endpoint?: string;
  forcePathStyle?: boolean;
  /** Keys for S3-compatible storage outside AWS (Linode); unset, the SDK's default chain is used. */
  credentials?: S3Credentials;
}

export interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export function createS3ObjectStore(cfg: S3StoreConfig): ObjectStore {
  const s3 = new S3Client({
    region: cfg.region,
    ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
    forcePathStyle: cfg.forcePathStyle ?? Boolean(cfg.endpoint),
    ...(cfg.credentials ? { credentials: cfg.credentials } : {}),
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
    async get(key) {
      try {
        const r = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
        return r.Body ? await r.Body.transformToByteArray() : null;
      } catch (e) {
        if ((e as { name?: string }).name === 'NoSuchKey') return null;
        throw e;
      }
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
  const objects = new Map<
    string,
    { size: number; sha256Base64: string | null; bytes: Uint8Array | null }
  >();
  const store: ObjectStore & {
    put(key: string, size: number, sha256Base64: string | null, bytes?: Uint8Array): void;
    keys(): string[];
  } = {
    async presignPut(key, p) {
      return {
        url: `memory://upload/${key}`,
        headers: { 'content-type': p.contentType, 'x-amz-checksum-sha256': p.sha256Base64 },
      };
    },
    async head(key) {
      const o = objects.get(key);
      return o ? { size: o.size, sha256Base64: o.sha256Base64 } : null;
    },
    async get(key) {
      return objects.get(key)?.bytes ?? null;
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
    put(key, size, sha256Base64, bytes) {
      objects.set(key, { size, sha256Base64, bytes: bytes ?? null });
    },
    keys: () => [...objects.keys()],
  };
  return store;
}
