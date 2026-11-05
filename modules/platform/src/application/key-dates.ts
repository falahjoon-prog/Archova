import { and, desc, eq } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, versionConflict, type TenantScope } from '@archova/kernel';
import { daysBetween, isLocalDate, localDateOf } from '@archova/time';
import {
  keyDateChanges,
  projectKeyDates,
  type KeyDateReason,
  type KeyDateSection,
} from '../infra/tables';
import type { ProjectService } from './projects';

type KeyDatesRow = typeof projectKeyDates.$inferSelect;
export type KeyDateChangeRow = typeof keyDateChanges.$inferSelect;

export const MAX_SECTIONS = 20;
const DATE_FIELDS = ['possessionDate', 'pcTarget', 'pcActual', 'dlpEnd'] as const;
type DateField = (typeof DATE_FIELDS)[number];

export interface SectionInput {
  id?: string;
  name: string;
  targetDate?: string | null;
  actualDate?: string | null;
}

export interface KeyDatesPatch {
  possessionDate?: string | null;
  pcTarget?: string | null;
  pcActual?: string | null;
  dlpEnd?: string | null;
  ldRatePerDay?: string | null;
  sections?: SectionInput[];
  reason?: KeyDateReason;
  note?: string | null;
}

export interface KeyDatesView {
  projectId: string;
  possessionDate: string | null;
  pcTarget: string | null;
  pcActual: string | null;
  dlpEnd: string | null;
  ldRatePerDay: string | null;
  currency: string;
  sections: KeyDateSection[];
  /** Whole days from today (the project's zone) to the PC target; negative when it has passed. Null once PC is reached or no target. */
  daysToPc: number | null;
  daysToDlpEnd: number | null;
  version: number;
  updatedAt: string | null;
}

const bad = (path: string, message: string) =>
  new AppError('validation_failed', message, [{ path, message }]);

export function createKeyDateService(deps: { projects: ProjectService; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());

  function view(projectId: string, row: KeyDatesRow | null, timeZone: string): KeyDatesView {
    const today = localDateOf(now(), timeZone);
    const pcTarget = row?.pcTarget ?? null;
    const dlpEnd = row?.dlpEnd ?? null;
    return {
      projectId,
      possessionDate: row?.possessionDate ?? null,
      pcTarget,
      pcActual: row?.pcActual ?? null,
      dlpEnd,
      ldRatePerDay: row?.ldRatePerDay ?? null,
      currency: row?.currency ?? 'AUD',
      sections: row?.sections ?? [],
      daysToPc: pcTarget && !row?.pcActual ? daysBetween(today, pcTarget) : null,
      daysToDlpEnd: dlpEnd ? daysBetween(today, dlpEnd) : null,
      version: row?.version ?? 0,
      updatedAt: row ? row.updatedAt.toISOString() : null,
    };
  }

  async function find(scope: TenantScope, projectId: string) {
    const [row] = await scope.tx
      .select()
      .from(projectKeyDates)
      .where(eq(projectKeyDates.projectId, projectId))
      .limit(1);
    return row ?? null;
  }

  async function get(scope: TenantScope, projectId: string): Promise<KeyDatesView> {
    const project = await deps.projects.get(scope, projectId);
    return view(projectId, await find(scope, projectId), project.timezone);
  }

  function checkOrder(next: Record<DateField, string | null>) {
    const { possessionDate, pcTarget, pcActual, dlpEnd } = next;
    if (possessionDate && pcTarget && pcTarget < possessionDate)
      throw bad('pcTarget', 'PC target is before site possession.');
    if (dlpEnd && pcTarget && dlpEnd < pcTarget)
      throw bad('dlpEnd', 'The defects liability period ends before PC target.');
    if (dlpEnd && pcActual && dlpEnd < pcActual)
      throw bad('dlpEnd', 'The defects liability period ends before actual PC.');
  }

  function cleanSections(input: SectionInput[], before: KeyDateSection[]): KeyDateSection[] {
    if (input.length > MAX_SECTIONS) throw bad('sections', `At most ${MAX_SECTIONS} sections.`);
    const known = new Set(before.map((s) => s.id));
    const names = new Set<string>();
    return input.map((s, i) => {
      const name = s.name.trim();
      if (!name) throw bad(`sections/${i}/name`, 'A section needs a name.');
      if (names.has(name.toLowerCase()))
        throw bad(`sections/${i}/name`, 'Section names must differ.');
      names.add(name.toLowerCase());
      for (const f of ['targetDate', 'actualDate'] as const) {
        const v = s[f];
        if (v !== null && v !== undefined && !isLocalDate(v))
          throw bad(`sections/${i}/${f}`, 'Not a date.');
      }
      if (s.id && !known.has(s.id)) throw bad(`sections/${i}/id`, 'Unknown section.');
      return {
        id: s.id ?? uuidv7(),
        name,
        targetDate: s.targetDate ?? null,
        actualDate: s.actualDate ?? null,
      };
    });
  }

  /** The change rows a patch makes, and whether any already-set target moves (which needs a reason, SCH-AC1). */
  function diff(before: KeyDatesRow | null, next: KeyDatesRow) {
    const changes: Array<
      Pick<KeyDateChangeRow, 'field' | 'sectionId' | 'sectionName' | 'oldValue' | 'newValue'> & {
        movesTarget?: boolean;
      }
    > = [];
    let targetMoved = false;
    for (const f of DATE_FIELDS) {
      const a = before?.[f] ?? null;
      const b = next[f] ?? null;
      if (a === b) continue;
      const movesTarget = f === 'pcTarget' && a !== null;
      changes.push({
        field: f,
        sectionId: null,
        sectionName: null,
        oldValue: a,
        newValue: b,
        movesTarget,
      });
      if (movesTarget) targetMoved = true;
    }
    const a = before?.ldRatePerDay ?? null;
    const b = next.ldRatePerDay ?? null;
    if (a !== b)
      changes.push({
        field: 'ldRatePerDay',
        sectionId: null,
        sectionName: null,
        oldValue: a,
        newValue: b,
      });
    const was = new Map((before?.sections ?? []).map((s) => [s.id, s]));
    const kept = new Set<string>();
    for (const s of next.sections) {
      const prev = was.get(s.id);
      kept.add(s.id);
      const ref = { sectionId: s.id, sectionName: s.name };
      if (!prev) {
        changes.push({ field: 'sectionAdded', ...ref, oldValue: null, newValue: s.name });
        continue;
      }
      if (prev.name !== s.name)
        changes.push({ field: 'sectionRenamed', ...ref, oldValue: prev.name, newValue: s.name });
      if (prev.targetDate !== s.targetDate) {
        const movesTarget = prev.targetDate !== null;
        changes.push({
          field: 'sectionTarget',
          ...ref,
          oldValue: prev.targetDate,
          newValue: s.targetDate,
          movesTarget,
        });
        if (movesTarget) targetMoved = true;
      }
      if (prev.actualDate !== s.actualDate)
        changes.push({
          field: 'sectionActual',
          ...ref,
          oldValue: prev.actualDate,
          newValue: s.actualDate,
        });
    }
    for (const prev of was.values())
      if (!kept.has(prev.id))
        changes.push({
          field: 'sectionRemoved',
          sectionId: prev.id,
          sectionName: prev.name,
          oldValue: prev.name,
          newValue: null,
        });
    return { changes, targetMoved };
  }

  /** Optimistic concurrency like projects: `expectedVersion` is 0 until the first save. */
  async function update(
    scope: TenantScope,
    projectId: string,
    expectedVersion: number,
    patch: KeyDatesPatch,
  ): Promise<KeyDatesView> {
    const project = await deps.projects.get(scope, projectId);
    const current = await find(scope, projectId);
    if ((current?.version ?? 0) !== expectedVersion) throw versionConflict();
    const userId = scope.ctx.userId;
    const next: KeyDatesRow = {
      projectId,
      orgId: scope.ctx.orgId,
      possessionDate: current?.possessionDate ?? null,
      pcTarget: current?.pcTarget ?? null,
      pcActual: current?.pcActual ?? null,
      dlpEnd: current?.dlpEnd ?? null,
      ldRatePerDay: current?.ldRatePerDay ?? null,
      currency: current?.currency ?? 'AUD',
      sections: current?.sections ?? [],
      createdAt: current?.createdAt ?? now(),
      updatedAt: now(),
      createdBy: current?.createdBy ?? userId,
      updatedBy: userId,
      version: (current?.version ?? 0) + 1,
    };
    for (const f of DATE_FIELDS) {
      const v = patch[f];
      if (v === undefined) continue;
      if (v !== null && !isLocalDate(v)) throw bad(f, 'Not a date.');
      next[f] = v;
    }
    if (patch.ldRatePerDay !== undefined) next.ldRatePerDay = patch.ldRatePerDay;
    if (patch.sections !== undefined)
      next.sections = cleanSections(patch.sections, current?.sections ?? []);
    checkOrder(next);
    const { changes, targetMoved } = diff(current, next);
    if (!changes.length) return view(projectId, current, project.timezone);
    if (targetMoved && !patch.reason)
      throw bad('reason', 'Say why a target date moved: EOT granted, variation or other.');
    const rows = current
      ? await scope.tx
          .update(projectKeyDates)
          .set(next)
          .where(
            and(
              eq(projectKeyDates.projectId, projectId),
              eq(projectKeyDates.version, expectedVersion),
            ),
          )
          .returning()
      : await scope.tx.insert(projectKeyDates).values(next).returning();
    const row = rows[0];
    if (!row) throw versionConflict();
    await scope.tx.insert(keyDateChanges).values(
      changes.map(({ movesTarget, ...c }) => ({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        ...c,
        // The reason belongs to moved targets; other edits (first-time entries, actuals) carry the note only.
        reason: movesTarget ? (patch.reason ?? null) : null,
        note: patch.note ?? null,
        changedBy: userId,
      })),
    );
    scope.events.add({
      type: 'platform.project.key_dates_changed.v1',
      projectId,
      entityType: 'project_key_dates',
      entityId: projectId,
      entityVersion: row.version,
      data: { projectId, changed: [...new Set(changes.map((c) => c.field))] },
    });
    return view(projectId, row, project.timezone);
  }

  async function changes(scope: TenantScope, projectId: string): Promise<KeyDateChangeRow[]> {
    await deps.projects.get(scope, projectId);
    return scope.tx
      .select()
      .from(keyDateChanges)
      .where(eq(keyDateChanges.projectId, projectId))
      .orderBy(desc(keyDateChanges.changedAt), desc(keyDateChanges.id))
      .limit(200);
  }

  return { get, update, changes };
}

export type KeyDateService = ReturnType<typeof createKeyDateService>;
