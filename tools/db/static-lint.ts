// Static checks on migration SQL (backend 01 §4, infrastructure 03 §5).
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { ROOT, sourceMigrations } from './sources';

/**
 * Merged migrations can't be edited (applied files are checksummed), so a file that predates a rule it breaks is
 * listed here with the reason. Don't add new files.
 */
const NON_CONCURRENT_INDEX_OK = new Set([
  // Index on a column added in the same file, on a table with no rows referencing it yet (#308).
  'modules/financials/db/migrations/20261105090000_financials_contract_source.sql',
]);

export function lintMigrationFiles(): string[] {
  const problems: string[] = [];
  for (const m of sourceMigrations()) {
    const sql = readFileSync(m.path, 'utf8').replace(/--.*$/gm, '');
    const where = relative(ROOT, m.path);
    const created = new Set(
      [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_]+\.[a-z_0-9]+)/gi)].map(
        (x) => x[1]!.toLowerCase(),
      ),
    );
    for (const x of sql.matchAll(
      /create\s+(?:unique\s+)?index\s+(concurrently\s+)?(?:if\s+not\s+exists\s+)?\w+\s+on\s+([a-z_]+\.[a-z_0-9]+)/gi,
    )) {
      const table = x[2]!.toLowerCase();
      if (!x[1] && !created.has(table) && !NON_CONCURRENT_INDEX_OK.has(where)) {
        problems.push(
          `${where}: CREATE INDEX on existing table ${table} must use CONCURRENTLY (and -- archova:no-transaction)`,
        );
      }
    }
    for (const x of sql.matchAll(
      /alter\s+table\s+([a-z_]+\.[a-z_0-9]+)\s+add\s+column\s+[^;]*?not\s+null(?![^;]*default)/gi,
    )) {
      problems.push(
        `${where}: ADD COLUMN ... NOT NULL without DEFAULT on ${x[1]} (expand/contract instead)`,
      );
    }
    for (const x of sql.matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_]+\.[a-z_0-9]+)\s*\(([\s\S]*?)\)\s*(?:partition|;)/gi,
    )) {
      const table = x[1]!.toLowerCase();
      if (
        /\borg_id\s+uuid/i.test(x[2]!) &&
        !new RegExp(`enable_tenant_rls\\('${table}'`, 'i').test(sql)
      ) {
        problems.push(
          `${where}: ${table} has org_id but no kernel.enable_tenant_rls('${table}') call`,
        );
      }
    }
    if (/\bbypassrls\b/i.test(sql) && !/nobypassrls/i.test(sql))
      problems.push(`${where}: migrations never grant BYPASSRLS`);
    if (/^\s*set\s+(?!local\b)/im.test(sql))
      problems.push(`${where}: session-level SET is banned; use SET LOCAL`);
  }
  return problems;
}
