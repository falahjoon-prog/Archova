// Names and the manifest inside the zip.

import type { Plan } from './plan';

export const FORMAT_VERSION = 1;

/** A file name that is safe on Windows, macOS and Linux, keeping the extension. */
export function safeFilename(name: string, max = 100): string {
  const cleaned = Array.from(name, (c) =>
    c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? '_' : c,
  )
    .join('')
    .trim()
    .replace(/^\.+/, '_');
  if (!cleaned) return 'file';
  if (cleaned.length <= max) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const ext = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, max - ext.length) + ext;
}

/** `files/<module>/<file id>-<name>`: the id keeps two files with the same name apart. */
export const filePath = (f: { module: string; id: string; filename: string }) =>
  `files/${safeFilename(f.module, 40)}/${f.id}-${safeFilename(f.filename)}`;

export interface ManifestTable {
  path: string;
  table: string;
  rows: number;
  columns: string[];
  sha256: string;
}

export interface ManifestFile {
  path: string | null;
  id: string;
  projectId: string | null;
  module: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  /** `included`, or `skipped` with the reason. */
  status: 'included' | 'skipped';
  reason?: string;
  /** True when the bytes read from storage did not match the checksum recorded at upload. */
  checksumMismatch?: boolean;
}

export interface Manifest {
  formatVersion: number;
  generatedAt: string;
  org: Record<string, unknown>;
  requestedBy: string;
  tables: ManifestTable[];
  files: ManifestFile[];
  excludedTables: Plan['excluded'];
}

export function readme(org: { name: string }, generatedAt: Date): string {
  return `Archova data export
====================
Organisation: ${org.name}
Generated:    ${generatedAt.toISOString()}

What is in this zip
-------------------
data/<schema>/<table>.csv   Every record the organisation holds, one CSV per table (UTF-8, comma separated,
                            first row is the column names). Dates and times are ISO 8601 in UTC. Structured
                            fields (lists, JSON) are written as JSON text. Text that a spreadsheet could run as a
                            formula (it starts with = + - @) has a leading apostrophe added.
data/people.csv             Names, emails and roles of the people who belong to the organisation.
files/<module>/...          Every uploaded file (drawings, documents, photos, evidence) exactly as uploaded.
                            File names are prefixed with the file's id, which is how the CSVs refer to it.
manifest.json               Row counts and SHA-256 checksums for every CSV and file, files that could not be
                            included and why, and the tables left out on purpose (secrets and sign-in credentials).

Checking it
-----------
The SHA-256 of the whole zip is shown next to the download in Archova. Each CSV and file has its own checksum in
manifest.json. Sealed payment-claim evidence is included with its signatures and timestamps so it can be verified
outside Archova.

Not included: passwords and sign-in credentials, API tokens and webhook secrets, connection credentials for Xero,
MYOB, Google Drive and SharePoint, and internal search indexes. Archova's own operational logs are not customer
records and are not included.
`;
}
