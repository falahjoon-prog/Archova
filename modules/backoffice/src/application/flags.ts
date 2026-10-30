import { and, desc, eq, inArray } from 'drizzle-orm';
import type { CohortDto, FlagChangeInput, FlagDto } from '@archova/contracts';
import { decodeId, encodeId, uuidv7 } from '@archova/domain';
import {
  AppError,
  FLAG_REGISTRY,
  evaluateFlag,
  type FlagRules,
  type KernelServices,
  type Tx,
} from '@archova/kernel';
import {
  cohortMembers,
  cohorts,
  flagChanges,
  flagTargets,
  flags,
  staffUsers,
  tenantDirectory,
} from '../infra/tables';
import type { StaffContext, StaffService } from './staff';

/** Feature flags and pilot cohorts (backend 09 §5), stored here and read by the kernel evaluator. */
export function createFlagService(
  deps: Pick<KernelServices, 'database'> & { staff: StaffService },
) {
  const tx = <T>(fn: (t: Tx) => Promise<T>) => deps.database.withGlobalTx('backoffice', fn);

  const known = (key: string) => {
    const def = FLAG_REGISTRY.find((f) => f.key === key);
    if (!def) throw new AppError('backoffice.flag_not_found');
    return def;
  };

  async function orgNames(t: Tx, ids: string[]) {
    if (!ids.length) return new Map<string, string>();
    const rows = await t
      .select({ id: tenantDirectory.id, name: tenantDirectory.name })
      .from(tenantDirectory)
      .where(inArray(tenantDirectory.id, ids));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  async function list(): Promise<FlagDto[]> {
    return tx(async (t) => {
      const [rows, targets, cohortRows, changes] = await Promise.all([
        t.select().from(flags),
        t.select().from(flagTargets),
        t.select().from(cohorts),
        t
          .select({
            flagKey: flagChanges.flagKey,
            summary: flagChanges.summary,
            reason: flagChanges.reason,
            at: flagChanges.createdAt,
            by: staffUsers.name,
          })
          .from(flagChanges)
          .innerJoin(staffUsers, eq(staffUsers.id, flagChanges.staffId))
          .orderBy(desc(flagChanges.createdAt)),
      ]);
      const names = await orgNames(
        t,
        targets.filter((x) => x.kind === 'org').map((x) => x.refId),
      );
      const cohortName = new Map(cohortRows.map((c) => [c.id, c.name]));
      return FLAG_REGISTRY.map((def) => {
        const row = rows.find((r) => r.key === def.key);
        const mine = targets.filter((x) => x.flagKey === def.key);
        const last = changes.find((c) => c.flagKey === def.key);
        return {
          key: def.key,
          description: def.description,
          owner: def.owner,
          removeBy: def.removeBy,
          enabledForAll: row?.enabledForAll ?? false,
          percent: row?.percent ?? 0,
          orgs: mine
            .filter((x) => x.kind === 'org')
            .map((x) => ({
              orgId: encodeId('org', x.refId),
              name: names.get(x.refId) ?? 'Unknown',
            })),
          cohorts: mine
            .filter((x) => x.kind === 'cohort')
            .map((x) => ({ id: x.refId, name: cohortName.get(x.refId) ?? 'Unknown' })),
          lastChange: last
            ? {
                summary: last.summary,
                reason: last.reason ?? '',
                by: last.by,
                at: last.at.toISOString(),
              }
            : null,
        };
      });
    });
  }

  async function ensureRow(t: Tx, key: string, by: string) {
    await t.insert(flags).values({ key, updatedBy: by }).onConflictDoNothing();
  }

  async function log(t: Tx, key: string, summary: string, reason: string, by: string) {
    await t
      .insert(flagChanges)
      .values({ id: uuidv7(), flagKey: key, summary, reason, staffId: by });
  }

  async function update(staff: StaffContext, key: string, change: FlagChangeInput) {
    known(key);
    // A change that reaches every org, or a share of them, is Owner-only and needs a fresh password check.
    if (change.scope === 'all' || change.scope === 'percent') {
      if (!staff.roles.includes('owner'))
        throw new AppError(
          'backoffice.owner_required',
          'Only an Owner can change a flag for all orgs or a percentage of them.',
        );
      deps.staff.requireStepUp(staff);
    }
    await tx(async (t) => {
      await ensureRow(t, key, staff.staffId);
      let summary: string;
      if (change.scope === 'all') {
        await t.update(flags).set({ enabledForAll: change.on }).where(eq(flags.key, key));
        summary = change.on ? 'Turned on for all orgs' : 'Turned off for all orgs';
      } else if (change.scope === 'percent') {
        await t.update(flags).set({ percent: change.percent }).where(eq(flags.key, key));
        summary = `Rollout set to ${change.percent}% of orgs`;
      } else {
        const kind = change.scope;
        let refId: string;
        let label: string;
        if (change.scope === 'org') {
          const decoded = decodeId('org', change.orgId);
          if (!decoded) throw new AppError('org.not_found');
          const [org] = await t
            .select({ name: tenantDirectory.name })
            .from(tenantDirectory)
            .where(eq(tenantDirectory.id, decoded));
          if (!org) throw new AppError('org.not_found');
          refId = decoded;
          label = org.name;
        } else {
          const [c] = await t.select().from(cohorts).where(eq(cohorts.id, change.cohortId));
          if (!c) throw new AppError('backoffice.cohort_not_found');
          refId = c.id;
          label = `cohort ${c.name}`;
        }
        if (change.on)
          await t
            .insert(flagTargets)
            .values({ flagKey: key, kind, refId, createdBy: staff.staffId })
            .onConflictDoNothing();
        else
          await t
            .delete(flagTargets)
            .where(
              and(
                eq(flagTargets.flagKey, key),
                eq(flagTargets.kind, kind),
                eq(flagTargets.refId, refId),
              ),
            );
        summary = `${change.on ? 'Turned on' : 'Turned off'} for ${label}`;
      }
      await t
        .update(flags)
        .set({ updatedBy: staff.staffId, updatedAt: new Date() })
        .where(eq(flags.key, key));
      await log(t, key, summary, change.reason, staff.staffId);
    });
  }

  /** Back to the flag's default (off) at once: no approval, always logged. */
  async function kill(staff: StaffContext, key: string, reason: string) {
    known(key);
    await tx(async (t) => {
      await ensureRow(t, key, staff.staffId);
      await t.delete(flagTargets).where(eq(flagTargets.flagKey, key));
      await t
        .update(flags)
        .set({ enabledForAll: false, percent: 0, updatedBy: staff.staffId, updatedAt: new Date() })
        .where(eq(flags.key, key));
      await log(
        t,
        key,
        'Kill switch: back to the default (off) for every org',
        reason,
        staff.staffId,
      );
    });
  }

  async function listCohorts(): Promise<CohortDto[]> {
    return tx(async (t) => {
      const [rows, members] = await Promise.all([
        t.select().from(cohorts).orderBy(cohorts.name),
        t.select().from(cohortMembers),
      ]);
      const names = await orgNames(t, [...new Set(members.map((m) => m.orgId))]);
      return rows.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        members: members
          .filter((m) => m.cohortId === c.id)
          .map((m) => ({ orgId: encodeId('org', m.orgId), name: names.get(m.orgId) ?? 'Unknown' }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }));
    });
  }

  async function logCohort(t: Tx, cohortId: string, summary: string, by: string) {
    await t.insert(flagChanges).values({ id: uuidv7(), cohortId, summary, staffId: by });
  }

  async function createCohort(staff: StaffContext, input: { name: string; description: string }) {
    const id = uuidv7();
    try {
      await tx(async (t) => {
        await t.insert(cohorts).values({ id, ...input, createdBy: staff.staffId });
        await logCohort(t, id, `Created cohort ${input.name}`, staff.staffId);
      });
    } catch (e) {
      if (String((e as { cause?: { code?: string } }).cause?.code ?? '') === '23505')
        throw new AppError('backoffice.cohort_exists', 'A cohort with that name exists.');
      throw e;
    }
    return { id, name: input.name, description: input.description, members: [] };
  }

  async function addMember(staff: StaffContext, cohortId: string, orgRef: string) {
    const orgId = decodeId('org', orgRef);
    if (!orgId) throw new AppError('org.not_found');
    await tx(async (t) => {
      const [c] = await t
        .select({ name: cohorts.name })
        .from(cohorts)
        .where(eq(cohorts.id, cohortId));
      if (!c) throw new AppError('backoffice.cohort_not_found');
      const [org] = await t
        .select({ id: tenantDirectory.id, name: tenantDirectory.name })
        .from(tenantDirectory)
        .where(eq(tenantDirectory.id, orgId));
      if (!org) throw new AppError('org.not_found');
      const added = await t
        .insert(cohortMembers)
        .values({ cohortId, orgId, addedBy: staff.staffId })
        .onConflictDoNothing()
        .returning({ orgId: cohortMembers.orgId });
      if (added.length)
        await logCohort(t, cohortId, `Added ${org.name} to cohort ${c.name}`, staff.staffId);
    });
  }

  async function removeMember(staff: StaffContext, cohortId: string, orgRef: string) {
    const orgId = decodeId('org', orgRef);
    if (!orgId) throw new AppError('org.not_found');
    await tx(async (t) => {
      const removed = await t
        .delete(cohortMembers)
        .where(and(eq(cohortMembers.cohortId, cohortId), eq(cohortMembers.orgId, orgId)))
        .returning({ orgId: cohortMembers.orgId });
      if (!removed.length) return;
      const [c] = await t
        .select({ name: cohorts.name })
        .from(cohorts)
        .where(eq(cohorts.id, cohortId));
      const [org] = await t
        .select({ name: tenantDirectory.name })
        .from(tenantDirectory)
        .where(eq(tenantDirectory.id, orgId));
      await logCohort(
        t,
        cohortId,
        `Removed ${org?.name ?? 'a company'} from cohort ${c?.name ?? 'unknown'}`,
        staff.staffId,
      );
    });
  }

  /** Server-side evaluation for one org: used by the kernel's `ctx.flags.isOn`. Unknown keys are off. */
  async function isOn(key: string, orgId: string): Promise<boolean> {
    if (!FLAG_REGISTRY.some((f) => f.key === key)) return false;
    return tx(async (t) => {
      const [row] = await t.select().from(flags).where(eq(flags.key, key));
      if (!row) return false;
      const [targets, mine] = await Promise.all([
        t.select().from(flagTargets).where(eq(flagTargets.flagKey, key)),
        t
          .select({ id: cohortMembers.cohortId })
          .from(cohortMembers)
          .where(eq(cohortMembers.orgId, orgId)),
      ]);
      const rules: FlagRules = {
        key,
        enabledForAll: row.enabledForAll,
        percent: row.percent,
        orgIds: new Set(targets.filter((x) => x.kind === 'org').map((x) => x.refId)),
        cohortIds: new Set(targets.filter((x) => x.kind === 'cohort').map((x) => x.refId)),
      };
      return evaluateFlag(rules, { id: orgId, cohortIds: mine.map((m) => m.id) });
    });
  }

  return { list, update, kill, listCohorts, createCohort, addMember, removeMember, isOn };
}

export type FlagService = ReturnType<typeof createFlagService>;
