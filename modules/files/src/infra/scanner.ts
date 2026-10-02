/**
 * Malware scanning port (backend 06 §3). Production runs ClamAV in the files worker on the S3 event;
 * apps/api refuses to start in production with the `none` scanner.
 */
export interface MalwareScanner {
  readonly name: string;
  scan(key: string): Promise<'clean' | 'infected'>;
}

export const noScanner: MalwareScanner = {
  name: 'none',
  scan: async () => 'clean',
};
