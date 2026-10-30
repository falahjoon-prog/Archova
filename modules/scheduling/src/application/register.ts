import { encodeId } from '@archova/domain';
import type { Database, TenantContext } from '@archova/kernel';
import type { DiaryApi } from '@archova/mod-diary';
import type { RfisApi } from '@archova/mod-rfis';
import {
  diaryRow,
  filterRows,
  rfiRows,
  sortRows,
  totals,
  type DelayCause,
  type RegisterFilter,
  type RegisterRow,
} from '../domain/register';

/** Most rows read from each source; past it the answer says `truncated`. */
export const SOURCE_LIMIT = 1000;

export interface SchedulingDeps {
  database: Database;
  diary: Pick<DiaryApi, 'delayLines'>;
  rfis: Pick<RfisApi, 'timeImpacts'>;
}

export function createRegisterService(deps: SchedulingDeps) {
  async function build(ctx: TenantContext, projectId: string, f: RegisterFilter) {
    return deps.database.withTenantTx(
      ctx,
      async (scope) => {
        let truncated = false;
        const rows: RegisterRow[] = [];
        if (f.source !== 'rfi') {
          const lines = await deps.diary.delayLines(scope, projectId, {
            ...(f.from ? { from: f.from } : {}),
            ...(f.to ? { to: f.to } : {}),
            ...(f.cause ? { type: f.cause } : {}),
            limit: SOURCE_LIMIT,
          });
          if (lines) {
            if (lines.length > SOURCE_LIMIT) truncated = true;
            for (const l of lines.slice(0, SOURCE_LIMIT))
              rows.push(
                diaryRow(
                  { ...l, type: l.type as DelayCause, hours: Number(l.hours) },
                  encodeId('diaryDelay', l.id),
                ),
              );
          }
        }
        // RFIs are design information; a different cause filter leaves them out without a query.
        if (f.source !== 'diary' && (!f.cause || f.cause === 'design')) {
          const impacts = await deps.rfis.timeImpacts(scope, projectId, { limit: SOURCE_LIMIT });
          if (impacts.truncated) truncated = true;
          for (const r of impacts.rows)
            rows.push(...rfiRows(r, encodeId('rfi', r.id), impacts.today, impacts.timeZone));
        }
        const data = sortRows(filterRows(rows, f));
        return { data, totals: totals(data), truncated };
      },
      { readOnly: true },
    );
  }
  return { build };
}

export type RegisterService = ReturnType<typeof createRegisterService>;
