import { and, eq, gte, lte } from 'drizzle-orm';
import type { TenantScope } from '@archova/kernel';
import type { LocalDate } from '@archova/time';
import { attendanceSessions, equipmentLogs } from '../infra/tables';

export type SiteActivitySource = 'attendance' | 'equipment';

/**
 * Days in a range with logged site activity (a sign-in or an equipment log), for `diary`'s "no daily log"
 * flag. Dates are the project's local dates already, so nothing here converts time zones.
 */
export function createSiteActivityService() {
  async function siteActivityDays(
    scope: TenantScope,
    projectId: string,
    from: LocalDate,
    to: LocalDate,
  ): Promise<Map<LocalDate, SiteActivitySource[]>> {
    const out = new Map<LocalDate, SiteActivitySource[]>();
    const add = (date: string, source: SiteActivitySource) => {
      const list = out.get(date as LocalDate) ?? [];
      if (!list.includes(source)) list.push(source);
      out.set(date as LocalDate, list);
    };
    const sessions = await scope.tx
      .selectDistinct({ date: attendanceSessions.localDate })
      .from(attendanceSessions)
      .where(
        and(
          eq(attendanceSessions.projectId, projectId),
          gte(attendanceSessions.localDate, from),
          lte(attendanceSessions.localDate, to),
        ),
      );
    for (const s of sessions) add(s.date, 'attendance');
    const logs = await scope.tx
      .selectDistinct({ date: equipmentLogs.logDate })
      .from(equipmentLogs)
      .where(
        and(
          eq(equipmentLogs.projectId, projectId),
          gte(equipmentLogs.logDate, from),
          lte(equipmentLogs.logDate, to),
        ),
      );
    for (const l of logs) add(l.date, 'equipment');
    return out;
  }
  return { siteActivityDays };
}
