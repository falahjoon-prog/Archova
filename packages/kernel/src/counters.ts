import { sql } from 'drizzle-orm';
import type { TenantScope } from './db';

/**
 * Issues the next human number (`RFI-042`) for an entity type in a project from `shared.counters`
 * (schema README "Human numbers"). Runs in the creating transaction; the row lock serialises
 * concurrent creates in the same project only.
 */
export async function nextNumber(
  scope: TenantScope,
  projectId: string,
  entityType: string,
): Promise<number> {
  const res = await scope.tx.execute<{ value: number }>(sql`
    insert into shared.counters (org_id, project_id, entity_type, next_value)
    values (${scope.ctx.orgId}, ${projectId}, ${entityType}, 2)
    on conflict (project_id, entity_type) do update set next_value = shared.counters.next_value + 1
    returning next_value - 1 as value`);
  return Number(res.rows[0]!.value);
}

/** After an import keeps original numbers, moves the counter past them (X49: max + 1). Never moves it back. */
export async function ensureCounterAbove(
  scope: TenantScope,
  projectId: string,
  entityType: string,
  used: number,
): Promise<void> {
  await scope.tx.execute(sql`
    insert into shared.counters (org_id, project_id, entity_type, next_value)
    values (${scope.ctx.orgId}, ${projectId}, ${entityType}, ${used + 1})
    on conflict (project_id, entity_type)
      do update set next_value = greatest(shared.counters.next_value, excluded.next_value)`);
}
