import { GetObjectTaggingCommand, S3Client } from '@aws-sdk/client-s3';

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
