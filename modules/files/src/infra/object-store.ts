import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';

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
  presignGet(
    key: string,
    p: { contentDisposition: string; expiresInS: number; contentType?: string },
  ): Promise<string>;
  /** Reads a whole object, for server-side processing (Nova title blocks); null when it doesn't exist. */
  get(key: string): Promise<Uint8Array | null>;
  /** Streams an object, for copies and archives too big to hold in memory; null when it doesn't exist. */
  getStream(key: string): Promise<Readable | null>;
  /** Uploads a stream of unknown length (multipart). Used by the data export for the finished archive. */
  putStream(key: string, body: Readable, p: { contentType: string }): Promise<void>;
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
    async getStream(key) {
      try {
        const r = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
        return r.Body ? (r.Body as Readable) : null;
      } catch (e) {
        if ((e as { name?: string }).name === 'NoSuchKey') return null;
        throw e;
      }
    },
    async putStream(key, body, p) {
      await new Upload({
        client: s3,
        params: { Bucket, Key: key, Body: body, ContentType: p.contentType },
      }).done();
    },
    async presignGet(key, p) {
      return getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentDisposition: p.contentDisposition,
          ...(p.contentType ? { ResponseContentType: p.contentType } : {}),
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
    async getStream(key) {
      const b = objects.get(key)?.bytes;
      return b ? Readable.from([Buffer.from(b)]) : null;
    },
    async putStream(key, body) {
      const chunks: Buffer[] = [];
      for await (const c of body) chunks.push(Buffer.from(c as Uint8Array));
      const bytes = Buffer.concat(chunks);
      objects.set(key, { size: bytes.length, sha256Base64: null, bytes });
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
      return `memory://download/${key}?disposition=${encodeURIComponent(p.contentDisposition)}&expires=${p.expiresInS}${p.contentType ? `&type=${encodeURIComponent(p.contentType)}` : ''}`;
    },
    put(key, size, sha256Base64, bytes) {
      objects.set(key, { size, sha256Base64, bytes: bytes ?? null });
    },
    keys: () => [...objects.keys()],
  };
  return store;
}

/**
 * A store that can only add: no read, no delete, no overwrite. Used for evidence in a bucket with Object Lock, where the
 * worker's role may only put. The key must already hold everything that makes the bytes unique (a hash of them), so an
 * object that already exists at the key is the same object and a retry is safe.
 */
export interface WriteOnceStore {
  /** Returns the SHA-256 S3 computed for the stored bytes. `created` is false when the key already existed. */
  putIfAbsent(
    key: string,
    body: Uint8Array,
    p: { contentType: string; sha256Base64: string },
  ): Promise<{ created: boolean; sha256Base64: string | null }>;
}

/** Sends no retention or legal-hold headers: the bucket's default lock covers every object. */
export function createS3WriteOnceStore(cfg: S3StoreConfig): WriteOnceStore {
  const s3 = new S3Client({
    region: cfg.region,
    ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
    forcePathStyle: cfg.forcePathStyle ?? Boolean(cfg.endpoint),
    ...(cfg.credentials ? { credentials: cfg.credentials } : {}),
  });
  return {
    async putIfAbsent(key, body, p) {
      try {
        const res = await s3.send(
          new PutObjectCommand({
            Bucket: cfg.bucket,
            Key: key,
            Body: body,
            ContentType: p.contentType,
            ChecksumSHA256: p.sha256Base64,
            IfNoneMatch: '*',
          }),
        );
        return { created: true, sha256Base64: res.ChecksumSHA256 ?? null };
      } catch (e) {
        // 412: the key exists. Because the key carries the content hash, that is the same bytes from an earlier try.
        if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412)
          return { created: false, sha256Base64: null };
        throw e;
      }
    },
  };
}
