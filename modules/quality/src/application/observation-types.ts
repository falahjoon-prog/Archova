import { and, asc, desc, eq, isNotNull, isNull, or } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import {
  BUILT_IN_TYPES,
  customKey,
  pickerGroups,
  resolveTypes,
  suggestType,
  type ResolvedType,
  type TypeRow,
} from '../domain/observation-types';
import type { ObservationType } from '../domain/observation';
import { inspections, observations, observationTypes, templateItems } from '../infra/tables';
import { uniqueViolation } from './errors';
import type { QualityDeps } from './shared';

const CUSTOM = 'custom:';

/** Every type this project offers, with the project's overrides applied. */
export async function loadTypes(
  scope: TenantScope,
  projectId: string,
): Promise<{ types: ResolvedType[]; rows: TypeRow[] }> {
  const rows = (await scope.tx
    .select()
    .from(observationTypes)
    .where(
      and(
        isNull(observationTypes.deletedAt),
        or(isNull(observationTypes.projectId), eq(observationTypes.projectId, projectId)),
      ),
    )
    .orderBy(asc(observationTypes.name))) as (typeof observationTypes.$inferSelect)[];
  const typeRows: TypeRow[] = rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    key: r.key,
    group: r.group,
    name: r.name,
    category: r.category,
    requiresAttachment: r.requiresAttachment,
    hidden: r.hidden,
  }));
  return { types: resolveTypes(typeRows, projectId), rows: typeRows };
}

export interface TypeInput {
  name?: string;
  group?: string;
  category?: ObservationType;
  requiresAttachment?: boolean | null;
  hidden?: boolean;
}

export function createObservationTypeService(deps: QualityDeps) {
  /** The person's latest types, newest first, for the picker's "Recents". */
  async function recentKeys(scope: TenantScope, projectId: string) {
    const rows = await scope.tx
      .select({ typeKey: observations.typeKey })
      .from(observations)
      .where(
        and(
          eq(observations.projectId, projectId),
          eq(observations.createdBy, scope.ctx.userId),
          isNotNull(observations.typeKey),
        ),
      )
      .orderBy(desc(observations.createdAt))
      .limit(30);
    return [...new Set(rows.map((r) => r.typeKey!))];
  }

  /** The searchable, grouped list a person picks from when raising an observation. */
  async function list(scope: TenantScope, projectId: string, q: string) {
    await deps.platform.getProject(scope, projectId);
    const { types } = await loadTypes(scope, projectId);
    return {
      groups: pickerGroups(types, await recentKeys(scope, projectId), q),
      // Admins also need the hidden ones, to show them again.
      all: types,
    };
  }

  async function addCustom(
    scope: TenantScope,
    projectId: string,
    input: Required<Pick<TypeInput, 'name' | 'category'>> & TypeInput & { orgWide?: boolean },
  ) {
    await deps.platform.getProject(scope, projectId);
    const name = input.name.trim();
    if (
      BUILT_IN_TYPES.some(
        (b) =>
          b.name.toLowerCase() === name.toLowerCase() &&
          b.group === (input.group?.trim() || 'Custom'),
      )
    )
      throw new AppError('observation_type.duplicate', 'That type already exists.');
    const id = uuidv7();
    try {
      await scope.tx.insert(observationTypes).values({
        id,
        orgId: scope.ctx.orgId,
        projectId: input.orgWide ? null : projectId,
        group: input.group?.trim() || 'Custom',
        name,
        category: input.category,
        requiresAttachment: input.requiresAttachment ?? false,
        hidden: false,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      });
    } catch (e) {
      if (uniqueViolation(e) !== null)
        throw new AppError('observation_type.duplicate', 'A type with that name already exists.');
      throw e;
    }
    const { types } = await loadTypes(scope, projectId);
    return types.find((t) => t.key === customKey(id))!;
  }

  /**
   * Change a type for this project: hide it, require an attachment, or (custom types) rename it. A built-in
   * type is never edited; the project gets an override row instead.
   */
  async function update(scope: TenantScope, projectId: string, key: string, patch: TypeInput) {
    await deps.platform.getProject(scope, projectId);
    const now = new Date();
    if (key.startsWith(CUSTOM)) {
      const id = key.slice(CUSTOM.length);
      const [row] = await scope.tx
        .select()
        .from(observationTypes)
        .where(
          and(
            eq(observationTypes.id, id),
            isNull(observationTypes.deletedAt),
            or(isNull(observationTypes.projectId), eq(observationTypes.projectId, projectId)),
          ),
        )
        .limit(1);
      if (!row || row.key !== null) throw new AppError('observation_type.not_found');
      try {
        await scope.tx
          .update(observationTypes)
          .set({
            ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
            ...(patch.group !== undefined ? { group: patch.group.trim() || 'Custom' } : {}),
            ...(patch.category !== undefined ? { category: patch.category } : {}),
            ...(patch.requiresAttachment != null
              ? { requiresAttachment: patch.requiresAttachment }
              : {}),
            ...(patch.hidden !== undefined ? { hidden: patch.hidden } : {}),
            version: row.version + 1,
            updatedAt: now,
            updatedBy: scope.ctx.userId,
          })
          .where(eq(observationTypes.id, id));
      } catch (e) {
        if (uniqueViolation(e) !== null)
          throw new AppError('observation_type.duplicate', 'A type with that name already exists.');
        throw e;
      }
    } else {
      if (!BUILT_IN_TYPES.some((b) => b.key === key))
        throw new AppError('observation_type.not_found');
      const [own] = await scope.tx
        .select()
        .from(observationTypes)
        .where(
          and(
            eq(observationTypes.key, key),
            eq(observationTypes.projectId, projectId),
            isNull(observationTypes.deletedAt),
          ),
        )
        .limit(1);
      const values = {
        ...(patch.requiresAttachment !== undefined
          ? { requiresAttachment: patch.requiresAttachment }
          : {}),
        ...(patch.hidden !== undefined ? { hidden: patch.hidden } : {}),
      };
      if (own)
        await scope.tx
          .update(observationTypes)
          .set({ ...values, version: own.version + 1, updatedAt: now, updatedBy: scope.ctx.userId })
          .where(eq(observationTypes.id, own.id));
      else
        await scope.tx.insert(observationTypes).values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          key,
          hidden: false,
          ...values,
          createdBy: scope.ctx.userId,
          updatedBy: scope.ctx.userId,
        });
    }
    const { types } = await loadTypes(scope, projectId);
    const out = types.find((t) => t.key === key);
    if (!out) throw new AppError('observation_type.not_found');
    return out;
  }

  /** The likely type for an observation raised from a checklist item (a rule over history and the item's words). */
  async function suggest(
    scope: TenantScope,
    projectId: string,
    inspectionId: string,
    templateItemId: string,
  ) {
    const [inspection] = await scope.tx
      .select({ id: inspections.id, templateId: inspections.templateId })
      .from(inspections)
      .where(and(eq(inspections.id, inspectionId), eq(inspections.projectId, projectId)))
      .limit(1);
    if (!inspection) throw new AppError('inspection.not_found');
    const [item] = await scope.tx
      .select()
      .from(templateItems)
      .where(
        and(
          eq(templateItems.id, templateItemId),
          eq(templateItems.templateId, inspection.templateId),
        ),
      )
      .limit(1);
    if (!item) throw new AppError('inspection.not_found');
    // What people chose before for this same checklist line, on any inspection of this project.
    const past = await scope.tx
      .select({ typeKey: observations.typeKey })
      .from(observations)
      .innerJoin(inspections, eq(inspections.id, observations.inspectionId))
      .where(
        and(
          eq(observations.projectId, projectId),
          eq(observations.inspectionItemId, templateItemId),
          isNotNull(observations.typeKey),
        ),
      )
      .limit(50);
    const { types } = await loadTypes(scope, projectId);
    const found = suggestType(types, {
      prompt: item.prompt,
      section: item.section,
      history: past.map((p) => p.typeKey!),
    });
    return found ? { ...found, type: types.find((t) => t.key === found.key)! } : null;
  }

  return { list, addCustom, update, suggest };
}

export type ObservationTypeService = ReturnType<typeof createObservationTypeService>;
