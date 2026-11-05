import { and, eq, isNull } from 'drizzle-orm';
import type { TenantScope } from '@archova/kernel';
import { DEFAULT_PERMISSION_TEMPLATES, type ToolLevels } from '@archova/domain/permissions';
import { permissionTemplates } from '../infra/tables';

/**
 * Brings an org's seeded permission templates up to date with the defaults (Sam 02 §4) when a tool was added after the
 * org was created, so a new module such as `meetings` is usable by existing orgs. It only fills a tool the template has
 * no level for: a level already set is never changed, and templates the org created itself are untouched. Safe to run
 * repeatedly. Returns how many templates changed.
 */
export async function backfillSeededTemplates(scope: TenantScope): Promise<number> {
  const rows = await scope.tx
    .select()
    .from(permissionTemplates)
    .where(and(eq(permissionTemplates.isSeeded, true), isNull(permissionTemplates.deletedAt)));
  let changed = 0;
  for (const row of rows) {
    const seed = DEFAULT_PERMISSION_TEMPLATES.find((t) => t.key === row.key);
    if (!seed) continue;
    const missing = Object.entries(seed.toolLevels).filter(
      ([tool]) => row.toolLevels[tool as keyof ToolLevels] === undefined,
    );
    if (missing.length === 0) continue;
    await scope.tx
      .update(permissionTemplates)
      .set({
        toolLevels: { ...row.toolLevels, ...Object.fromEntries(missing) },
        updatedAt: new Date(),
        version: row.version + 1,
      })
      .where(eq(permissionTemplates.id, row.id));
    changed += 1;
  }
  return changed;
}
