import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, versionConflict, type TenantScope } from '@archova/kernel';
import { validateQuestions, type Question } from '../domain/prequal';
import { templates } from '../infra/tables';
import { uniqueViolation } from './errors';

export type TemplateRow = typeof templates.$inferSelect;

export interface TemplateFields {
  name?: string;
  validityMonths?: number;
  questions?: Question[];
}

const live = (id: string) => and(eq(templates.id, id), isNull(templates.deletedAt));

export function createTemplateService() {
  const audit = (scope: TenantScope, action: 'created' | 'updated' | 'published', r: TemplateRow) =>
    scope.events.add({
      type: `precon.prequal_template.${action}.v1`,
      entityType: 'prequal_template',
      entityId: r.id,
      entityVersion: r.rowVersion,
      data: { actorId: scope.ctx.userId, templateVersion: r.version },
    });

  function assertQuestions(questions: Question[]) {
    const issues = validateQuestions(questions);
    if (issues.length) throw new AppError('prequal_template.invalid', 'Fix the questions.', issues);
  }

  async function list(scope: TenantScope) {
    return scope.tx
      .select()
      .from(templates)
      .where(isNull(templates.deletedAt))
      .orderBy(asc(templates.name), desc(templates.version));
  }

  async function get(scope: TenantScope, id: string) {
    const [row] = await scope.tx.select().from(templates).where(live(id)).limit(1);
    if (!row) throw new AppError('prequal_template.not_found');
    return row;
  }

  async function create(
    scope: TenantScope,
    input: { name: string; validityMonths?: number; questions: Question[] },
  ) {
    assertQuestions(input.questions);
    try {
      const [row] = await scope.tx
        .insert(templates)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          name: input.name.trim(),
          validityMonths: input.validityMonths ?? 12,
          questions: input.questions,
          createdBy: scope.ctx.userId,
          updatedBy: scope.ctx.userId,
        })
        .returning();
      audit(scope, 'created', row!);
      return row!;
    } catch (e) {
      if (uniqueViolation(e) === 'prequal_templates_version')
        throw new AppError('prequal_template.name_taken', 'A form with that name already exists.');
      throw e;
    }
  }

  async function update(scope: TenantScope, id: string, expected: number, input: TemplateFields) {
    const cur = await get(scope, id);
    if (cur.rowVersion !== expected) throw versionConflict();
    if (cur.published)
      throw new AppError(
        'prequal_template.published',
        'A published form is frozen. Make a new version to change it.',
      );
    if (input.questions) assertQuestions(input.questions);
    try {
      const [row] = await scope.tx
        .update(templates)
        .set({
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.validityMonths !== undefined ? { validityMonths: input.validityMonths } : {}),
          ...(input.questions ? { questions: input.questions } : {}),
          rowVersion: cur.rowVersion + 1,
          updatedAt: new Date(),
          updatedBy: scope.ctx.userId,
        })
        .where(and(live(id), eq(templates.rowVersion, expected)))
        .returning();
      if (!row) throw versionConflict();
      audit(scope, 'updated', row);
      return row;
    } catch (e) {
      if (uniqueViolation(e) === 'prequal_templates_version')
        throw new AppError('prequal_template.name_taken', 'A form with that name already exists.');
      throw e;
    }
  }

  async function publish(scope: TenantScope, id: string, expected: number) {
    const cur = await get(scope, id);
    if (cur.rowVersion !== expected) throw versionConflict();
    if (cur.published) throw new AppError('prequal_template.published');
    assertQuestions(cur.questions);
    const [row] = await scope.tx
      .update(templates)
      .set({
        published: true,
        rowVersion: cur.rowVersion + 1,
        updatedAt: new Date(),
        updatedBy: scope.ctx.userId,
      })
      .where(and(live(id), eq(templates.rowVersion, expected)))
      .returning();
    if (!row) throw versionConflict();
    audit(scope, 'published', row);
    return row;
  }

  /** A draft copy of a published form at the next version number. */
  async function newVersion(scope: TenantScope, id: string) {
    const cur = await get(scope, id);
    if (!cur.published)
      throw new AppError('prequal_template.not_published', 'Publish this form before revising it.');
    const [latest] = await scope.tx
      .select({ version: templates.version })
      .from(templates)
      .where(and(isNull(templates.deletedAt), sql`lower(${templates.name}) = lower(${cur.name})`))
      .orderBy(desc(templates.version))
      .limit(1);
    try {
      const [row] = await scope.tx
        .insert(templates)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          name: cur.name,
          version: (latest?.version ?? cur.version) + 1,
          validityMonths: cur.validityMonths,
          questions: cur.questions,
          createdBy: scope.ctx.userId,
          updatedBy: scope.ctx.userId,
        })
        .returning();
      audit(scope, 'created', row!);
      return row!;
    } catch (e) {
      // Someone else started the next version first; hand back theirs would hide the clash, so say so.
      if (uniqueViolation(e) === 'prequal_templates_version')
        throw new AppError('prequal_template.name_taken', 'A newer version already exists.');
      throw e;
    }
  }

  return { list, get, create, update, publish, newVersion };
}

export type TemplateService = ReturnType<typeof createTemplateService>;
