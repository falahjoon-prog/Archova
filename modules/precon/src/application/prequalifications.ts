import { and, desc, eq } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, recordRetention, versionConflict, type TenantScope } from '@archova/kernel';
import { localDateOf } from '@archova/time';
import {
  addMonths,
  companyStanding,
  qualification,
  scoreAnswers,
  transition,
  validateAnswers,
  type Answers,
  type PrequalAction,
  type Qualification,
} from '../domain/prequal';
import { prequalifications, templates } from '../infra/tables';
import { uniqueViolation } from './errors';
import { PRECON_TIME_ZONE, type PreconDeps } from './shared';

export type PrequalRow = typeof prequalifications.$inferSelect;
export type TemplateRow = typeof templates.$inferSelect;

export interface PrequalView {
  row: PrequalRow;
  template: TemplateRow;
  qualification: Qualification;
}

export interface RegisterEntry {
  row: PrequalRow;
  templateName: string;
  qualification: Qualification;
}

const clean = (trades: readonly string[] | undefined) => [
  ...new Set((trades ?? []).map((t) => t.trim()).filter(Boolean)),
];

export function createPrequalService(deps: PreconDeps) {
  const now = deps.now ?? (() => new Date());
  const today = () => localDateOf(now(), PRECON_TIME_ZONE);

  /** Audit trail: ids and the decision only, never the answers. */
  const audit = (
    scope: TenantScope,
    action: 'created' | 'submitted' | 'approved' | 'rejected',
    r: PrequalRow,
  ) =>
    scope.events.add({
      type: `precon.prequalification.${action}.v1`,
      entityType: 'prequalification',
      entityId: r.id,
      entityVersion: r.version,
      data: { companyId: r.companyId, actorId: scope.ctx.userId },
    });

  async function load(scope: TenantScope, id: string): Promise<PrequalView> {
    const [hit] = await scope.tx
      .select({ row: prequalifications, template: templates })
      .from(prequalifications)
      .innerJoin(templates, eq(templates.id, prequalifications.templateId))
      .where(eq(prequalifications.id, id))
      .limit(1);
    if (!hit) throw new AppError('prequal.not_found');
    return { ...hit, qualification: qualification(hit.row.status, hit.row.expiresOn, today()) };
  }

  const get = load;

  async function list(
    scope: TenantScope,
    opts: { companyId?: string; status?: PrequalRow['status'] },
  ) {
    const rows = await scope.tx
      .select({ row: prequalifications, templateName: templates.name })
      .from(prequalifications)
      .innerJoin(templates, eq(templates.id, prequalifications.templateId))
      .where(
        and(
          opts.companyId ? eq(prequalifications.companyId, opts.companyId) : undefined,
          opts.status ? eq(prequalifications.status, opts.status) : undefined,
        ),
      )
      .orderBy(desc(prequalifications.createdAt))
      .limit(500);
    const t = today();
    return rows.map((r): RegisterEntry => ({
      ...r,
      qualification: qualification(r.row.status, r.row.expiresOn, t),
    }));
  }

  /** One line per company: where it stands today, so a builder sees who may be invited to bid or put on site. */
  async function register(scope: TenantScope, opts: { state?: Qualification; trade?: string }) {
    const all = await list(scope, {});
    const byCompany = new Map<string, RegisterEntry[]>();
    for (const e of all) {
      const group = byCompany.get(e.row.companyId) ?? [];
      group.push(e);
      byCompany.set(e.row.companyId, group);
    }
    const t = today();
    const out: RegisterEntry[] = [];
    for (const group of byCompany.values()) {
      const standing = companyStanding(
        group.map((g) => ({ ...g.row, g })),
        t,
      );
      if (!standing) continue;
      const entry = standing.form.g;
      if (opts.state && standing.state !== opts.state) continue;
      if (opts.trade) {
        const want = opts.trade.trim().toLowerCase();
        if (!entry.row.trades.some((x) => x.toLowerCase() === want)) continue;
      }
      out.push({ ...entry, qualification: standing.state });
    }
    // Soonest expiry first, so renewals surface; companies with no date (pending, rejected) last.
    return out.sort((a, b) => (a.row.expiresOn ?? '9999').localeCompare(b.row.expiresOn ?? '9999'));
  }

  async function create(
    scope: TenantScope,
    input: { companyId: string; templateId: string; trades?: string[] },
  ) {
    if (!(await deps.platform.companyExists(scope, input.companyId)))
      throw new AppError('validation_failed', 'Choose a company in your directory.', [
        { path: 'companyId', message: 'Not a company in this organisation' },
      ]);
    const [template] = await scope.tx
      .select()
      .from(templates)
      .where(eq(templates.id, input.templateId))
      .limit(1);
    if (!template || template.deletedAt) throw new AppError('prequal_template.not_found');
    if (!template.published)
      throw new AppError('prequal_template.not_published', 'Publish the form before using it.');
    try {
      const [row] = await scope.tx
        .insert(prequalifications)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          companyId: input.companyId,
          templateId: template.id,
          templateVersion: template.version,
          trades: clean(input.trades),
          createdBy: scope.ctx.userId,
          updatedBy: scope.ctx.userId,
        })
        .returning();
      audit(scope, 'created', row!);
      return load(scope, row!.id);
    } catch (e) {
      if (uniqueViolation(e) === 'prequalifications_one_open')
        throw new AppError(
          'prequal.open_exists',
          'This company already has an unfinished form on this template.',
        );
      throw e;
    }
  }

  async function update(
    scope: TenantScope,
    id: string,
    expected: number,
    input: { answers?: Answers; trades?: string[] },
  ) {
    const cur = await load(scope, id);
    if (cur.row.version !== expected) throw versionConflict();
    if (cur.row.status !== 'draft')
      throw new AppError('prequal.invalid_state', 'Only a draft can be edited.');
    if (input.answers) {
      const issues = validateAnswers(cur.template.questions, input.answers, false);
      if (issues.length) throw new AppError('validation_failed', 'Check the answers.', issues);
    }
    const [row] = await scope.tx
      .update(prequalifications)
      .set({
        ...(input.answers ? { answers: input.answers } : {}),
        ...(input.trades ? { trades: clean(input.trades) } : {}),
        version: cur.row.version + 1,
        updatedAt: now(),
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(prequalifications.id, id), eq(prequalifications.version, expected)))
      .returning();
    if (!row) throw versionConflict();
    return load(scope, row.id);
  }

  function step(cur: PrequalView, expected: number, action: PrequalAction) {
    if (cur.row.version !== expected) throw versionConflict();
    const t = transition(cur.row.status, action);
    if (!t.ok)
      throw new AppError(
        'prequal.invalid_state',
        `A ${cur.row.status} form cannot be ${action === 'submit' ? 'submitted' : action === 'approve' ? 'approved' : 'rejected'}.`,
      );
    return t.to;
  }

  async function submit(scope: TenantScope, id: string, expected: number) {
    const cur = await load(scope, id);
    const to = step(cur, expected, 'submit');
    const issues = validateAnswers(cur.template.questions, cur.row.answers, true);
    if (issues.length)
      throw new AppError('prequal.incomplete', 'Answer every required question first.', issues);
    const score = scoreAnswers(cur.template.questions, cur.row.answers);
    const at = now();
    const [row] = await scope.tx
      .update(prequalifications)
      .set({
        status: to,
        scorePoints: score.points,
        scoreMax: score.maxPoints,
        concerns: score.concerns,
        submittedBy: scope.ctx.userId,
        submittedAt: at,
        version: cur.row.version + 1,
        updatedAt: at,
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(prequalifications.id, id), eq(prequalifications.version, expected)))
      .returning();
    if (!row) throw versionConflict();
    audit(scope, 'submitted', row);
    return load(scope, row.id);
  }

  /** A decided form, and the frozen question set it was answered against, are kept for the retention period. */
  async function keep(scope: TenantScope, row: typeof prequalifications.$inferSelect) {
    const anchor = new Date(
      Math.max(row.decidedAt?.getTime() ?? 0, Date.parse(`${row.expiresOn ?? ''}T00:00:00Z`) || 0),
    );
    for (const [recordType, recordId] of [
      ['precon.prequalifications', row.id],
      ['precon.prequal_templates', row.templateId],
    ] as const)
      await recordRetention(scope, {
        recordType,
        recordId,
        category: 'prequalification_7y',
        anchor,
      });
  }

  async function approve(
    scope: TenantScope,
    id: string,
    expected: number,
    input: { note?: string; expiresOn?: string },
  ) {
    const cur = await load(scope, id);
    const to = step(cur, expected, 'approve');
    const t = today();
    const expiresOn = input.expiresOn ?? addMonths(t, cur.template.validityMonths);
    if (expiresOn < t || expiresOn > addMonths(t, 60))
      throw new AppError('validation_failed', 'Choose an expiry from today up to five years out.', [
        { path: 'expiresOn', message: 'Out of range' },
      ]);
    const at = now();
    const [row] = await scope.tx
      .update(prequalifications)
      .set({
        status: to,
        decidedBy: scope.ctx.userId,
        decidedAt: at,
        decisionNote: input.note?.trim() || null,
        validFrom: t,
        expiresOn,
        version: cur.row.version + 1,
        updatedAt: at,
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(prequalifications.id, id), eq(prequalifications.version, expected)))
      .returning();
    if (!row) throw versionConflict();
    audit(scope, 'approved', row);
    await keep(scope, row);
    return load(scope, row.id);
  }

  async function reject(scope: TenantScope, id: string, expected: number, note: string) {
    const cur = await load(scope, id);
    const to = step(cur, expected, 'reject');
    if (!note.trim())
      throw new AppError('prequal.reason_required', 'Say why the form was not approved.', [
        { path: 'note', message: 'Required' },
      ]);
    const at = now();
    const [row] = await scope.tx
      .update(prequalifications)
      .set({
        status: to,
        decidedBy: scope.ctx.userId,
        decidedAt: at,
        decisionNote: note.trim(),
        version: cur.row.version + 1,
        updatedAt: at,
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(prequalifications.id, id), eq(prequalifications.version, expected)))
      .returning();
    if (!row) throw versionConflict();
    audit(scope, 'rejected', row);
    await keep(scope, row);
    return load(scope, row.id);
  }

  return { list, register, get, create, update, submit, approve, reject };
}

export type PrequalService = ReturnType<typeof createPrequalService>;
