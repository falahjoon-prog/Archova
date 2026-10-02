import { GetObjectCommand, GetObjectTaggingCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * Malware scanning port (backend 06 §3, security-licensing/09 §4). Production uses Amazon GuardDuty Malware
 * Protection for S3, which scans each object in the bucket and tags it with the result; another engine (ClamAV)
 * can be swapped in behind this port without touching the files service. apps/api refuses to start in production
 * with the `none` scanner.
 */
export type ScanVerdict =
  /** No threats found: the file can be moved out of quarantine and served. */
  | 'clean'
  /** Threats found: kept in quarantine, never served. */
  | 'infected'
  /** The engine couldn't scan it (unsupported, password-protected, scan failed): never served. */
  | 'unscannable'
  /** No result yet: the file stays `scanning` and is checked again on the next read. */
  | 'pending';

export interface MalwareScanner {
  readonly name: string;
  scan(key: string): Promise<ScanVerdict>;
}

export const noScanner: MalwareScanner = {
  name: 'none',
  scan: async () => 'clean',
};

/** The object tag GuardDuty Malware Protection for S3 writes when tagging is enabled on the protection plan. */
export const GUARDDUTY_SCAN_TAG = 'GuardDutyMalwareScanStatus';

/** Maps GuardDuty's tag value to a verdict. A missing tag means the scan hasn't finished. */
export function guardDutyVerdict(tag: string | undefined): ScanVerdict {
  switch (tag) {
    case undefined:
      return 'pending';
    case 'NO_THREATS_FOUND':
      return 'clean';
    case 'THREATS_FOUND':
      return 'infected';
    // UNSUPPORTED, FAILED, ACCESS_DENIED and any value GuardDuty adds later fail closed (security-licensing/09).
    default:
      return 'unscannable';
  }
}

export interface GuardDutyScannerConfig {
  bucket: string;
  region: string;
  /** Custom endpoint (MinIO locally). */
  endpoint?: string;
}

/** Reads GuardDuty's result tag on the object; the scan itself runs inside AWS on the S3 event. */
export function createGuardDutyScanner(
  cfg: GuardDutyScannerConfig,
  s3: Pick<S3Client, 'send'> = new S3Client({
    region: cfg.region,
    ...(cfg.endpoint ? { endpoint: cfg.endpoint, forcePathStyle: true } : {}),
  }),
): MalwareScanner {
  return {
    name: 'guardduty',
    async scan(key) {
      const r = await s3.send(new GetObjectTaggingCommand({ Bucket: cfg.bucket, Key: key }));
      return guardDutyVerdict(r.TagSet?.find((t) => t.Key === GUARDDUTY_SCAN_TAG)?.Value);
    },
  };
}

export interface ClamAvScannerConfig {
  bucket: string;
  region: string;
  /** Custom endpoint for S3-compatible storage (Linode Object Storage, MinIO). */
  endpoint?: string;
  /** clamd's TCP address, normally a container next to the api. */
  host: string;
  port: number;
  /** Give up after this long and leave the file `pending`; the next read scans it again. */
  timeoutMs?: number;
}

/** Maps clamd's INSTREAM reply to a verdict. Anything but a clean or a FOUND reply fails closed. */
export function clamdVerdict(reply: string): ScanVerdict {
  const r = reply.replace(/\0/g, '').trim();
  if (r === 'stream: OK') return 'clean';
  if (/^stream: .+ FOUND$/.test(r)) return 'infected';
  // "INSTREAM size limit exceeded", encrypted archives (with AlertEncrypted) and any ERROR.
  return 'unscannable';
}

/** Streams bytes to clamd with the INSTREAM command and resolves with its reply. */
export async function clamdInstream(
  host: string,
  port: number,
  body: AsyncIterable<Uint8Array>,
  timeoutMs: number,
): Promise<string> {
  const { connect } = await import('node:net');
  return new Promise<string>((resolve, reject) => {
    const socket = connect({ host, port });
    const chunks: Buffer[] = [];
    let failure: Error | undefined;
    const timer = setTimeout(() => socket.destroy(new Error('clamd timed out')), timeoutMs);
    socket.on('data', (d) => chunks.push(d));
    // clamd answers and hangs up early when a stream is over its size limit, so a write error after it replied
    // is not a failure: the reply is the result. No reply at all (down, timed out) rejects.
    socket.on('error', (err) => (failure = err));
    socket.on('close', () => {
      clearTimeout(timer);
      const reply = Buffer.concat(chunks).toString('utf8');
      if (reply) resolve(reply);
      else reject(failure ?? new Error('clamd closed without a reply'));
    });
    socket.on('connect', async () => {
      try {
        socket.write('zINSTREAM\0');
        for await (const part of body) {
          if (socket.destroyed || !socket.writable) return;
          const len = Buffer.alloc(4);
          len.writeUInt32BE(part.length);
          if (!socket.write(Buffer.concat([len, Buffer.from(part)])))
            await new Promise((r) => socket.once('drain', r).once('close', r));
        }
        if (socket.writable) socket.end(Buffer.alloc(4));
      } catch (err) {
        socket.destroy(err as Error);
      }
    });
  });
}

/**
 * ClamAV for hosts without GuardDuty (the Linode option, infrastructure/09). The api streams the quarantine object
 * from storage to clamd and waits for the verdict; if clamd is down or slow the file stays `pending` and is scanned
 * again on the next read, and fails closed after SCAN_TIMEOUT_MS.
 */
export function createClamAvScanner(
  cfg: ClamAvScannerConfig,
  s3: Pick<S3Client, 'send'> = new S3Client({
    region: cfg.region,
    ...(cfg.endpoint ? { endpoint: cfg.endpoint, forcePathStyle: true } : {}),
  }),
  instream: typeof clamdInstream = clamdInstream,
): MalwareScanner {
  return {
    name: 'clamav',
    async scan(key) {
      try {
        const obj = await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
        const body = obj.Body as AsyncIterable<Uint8Array> | undefined;
        if (!body) return 'pending';
        return clamdVerdict(await instream(cfg.host, cfg.port, body, cfg.timeoutMs ?? 30_000));
      } catch {
        return 'pending';
      }
    },
  };
}
