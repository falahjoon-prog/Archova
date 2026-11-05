// What a full export contains. Every tenant table (RLS on, with an org_id) is exported unless it is named here, so a
// new module's tables are in the next export without anyone remembering to add them. The integration test fails when
// an exported column looks like a secret and nobody has reviewed it, so leaving something out is a decision on record.

export interface CatalogColumn {
  name: string;
  /** `format_type` of the column, e.g. `timestamp with time zone`, `jsonb`, `bytea`. */
  type: string;
}

export interface CatalogTable {
  schema: string;
  name: string;
  columns: readonly CatalogColumn[];
}

export interface PlannedTable extends CatalogTable {
  /** `<schema>.<table>`, also the file name stem under `data/`. */
  id: string;
}

/** Infrastructure, not the customer's records: queues, idempotency keys, sign-in links, platform-only holds. */
export const EXCLUDED_SCHEMAS: ReadonlySet<string> = new Set(['shared', 'sync', 'identity']);

/** Tables left out on purpose, with the reason that goes in the manifest. */
export const EXCLUDED_TABLES: Readonly<Record<string, string>> = {
  'ai.ai_chunks': 'Search index built from other records; rebuilt on import.',
  'ai.ai_index_entries': 'Search index built from other records; rebuilt on import.',
  'ai.ai_requests': 'Operational log of model calls.',
  'ai.ai_translations': 'Cache of machine translations.',
  'files.upload_sessions': 'Uploads in flight; the finished files are in files.file_objects.',
  'integrations.accounting_connections': 'Holds sign-in credentials for Xero or MYOB.',
  'integrations.folder_connections': 'Holds sign-in credentials for Drive or SharePoint.',
  'integrations.webhook_subscriptions': 'Holds webhook signing secrets.',
  'integrations.webhook_deliveries': 'Delivery attempts, operational.',
  'integrations.import_rows': 'Staging rows from imports, purged after each import.',
  'workforce.compliance_access_requests': 'One-time sign-in codes; short-lived.',
};

/** Columns dropped from tables that are otherwise exported (secrets, and values only the platform can read). */
export const EXCLUDED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  'platform.invitations': ['token_hash'],
  'workforce.gates': ['qr_token_hash'],
  'workforce.compliance_documents': ['number_sealed'],
  'workforce.worker_credentials': ['number_sealed'],
};

/** A column that looks like a credential. Exporting one needs a line in {@link REVIEWED_COLUMNS}. */
export const SENSITIVE_COLUMN =
  /secret|password|passwd|token|cipher|_sealed$|embedding|salt|credential|private_key|_hash$/i;

/** Columns that match {@link SENSITIVE_COLUMN} and were checked: a content checksum, or evidence kept on purpose. */
export const REVIEWED_COLUMNS: ReadonlySet<string> = new Set([
  'correspondence.items.content_hash',
  'financials.evidence_records.evidence_hash',
  'financials.evidence_timestamps.token',
  // The timestamp authority's public token over a send proof; checked like the seal timestamp above.
  'financials.evidence_send_timestamps.token',
  'ai.ai_translations.source_hash',
  'workforce.induction_completions.translation_hash',
  'workforce.induction_completions.evidence_hash',
  'workforce.induction_versions.content_hash',
]);

export interface Plan {
  include: PlannedTable[];
  excluded: Array<{ table: string; reason: string }>;
}

export function planTables(catalog: readonly CatalogTable[]): Plan {
  const include: PlannedTable[] = [];
  const excluded: Plan['excluded'] = [];
  for (const t of [...catalog].sort((a, b) =>
    `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`),
  )) {
    const id = `${t.schema}.${t.name}`;
    if (EXCLUDED_SCHEMAS.has(t.schema)) continue;
    const why = EXCLUDED_TABLES[id];
    if (why) {
      excluded.push({ table: id, reason: why });
      continue;
    }
    const dropped = new Set(EXCLUDED_COLUMNS[id] ?? []);
    include.push({ ...t, id, columns: t.columns.filter((c) => !dropped.has(c.name)) });
  }
  return { include, excluded };
}

/** `schema.table.column` for each exported column that looks like a credential and has not been reviewed. */
export function unreviewedSensitiveColumns(plan: Plan): string[] {
  const out: string[] = [];
  for (const t of plan.include)
    for (const c of t.columns) {
      const key = `${t.id}.${c.name}`;
      if (SENSITIVE_COLUMN.test(c.name) && !REVIEWED_COLUMNS.has(key)) out.push(key);
    }
  return out;
}
