import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, recordRetention, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import {
  contentHash,
  MAX_RATE_CENTS,
  DIRECT_COST_CATEGORY,
  isQuantity,
  lineCents,
  statusAfterSigning,
  totalCents,
  totalsByKind,
  type TmKind,
  type TmLineInput,
  type TmRole,
} from '../domain/tm';
import { fromCents, isMoney, toCents } from '../domain/money';
import { tmTicketDirectCosts, tmTicketLines, tmTicketSignoffs, tmTickets } from '../infra/tables';
import type { DirectCostsService } from './directCosts';

export type TmTicketRow = typeof tmTickets.$inferSelect;
export type TmLineRow = typeof tmTicketLines.$inferSelect;
export type TmSignoffRow = typeof tmTicketSignoffs.$inferSelect;

export interface TmSourceRef {
  sourceType: 'timesheet_line' | 'equipment_log';
  sourceId: string;
}
export type TmLineWithSource = TmLineInput & Partial<TmSourceRef>;

/** What the workforce module saw on site that day (builder staff only), for drafting a ticket. */
export interface DayActivity {
  labour: { timesheetLineId: string; worker: string; hours: string; costCodeId: string | null }[];
  equipment: {
    equipmentLogId: string;
    name: string;
    assetNumber: string;
    hours: string;
    operator: string | null;
  }[];
}

export interface TmTicketsDeps {
  access: AccessService;
  directCosts: Pick<DirectCostsService, 'recordDirectCost'>;
  /** Creates a draft variation on a contract (the financials service). */
  createVariation: (
    scope: TenantScope,
    projectId: string,
    contractId: string,
    input: { title: string; description?: string; amount: string },
  ) => Promise<{ variation: { id: string; number: number } }>;
  dayActivity: (scope: TenantScope, projectId: string, date: string) => Promise<DayActivity>;
  /** Files module: the evidence file must be a ready file on this project. */
  getFile: (
    scope: TenantScope,
    fileId: string,
  ) => Promise<{ projectId: string | null; status: string }>;
  now?: () => Date;
}

export interface TmTicketInput {
  title: string;
  description?: string;
  /** yyyy-mm-dd, not in the future. */
  workDate: string;
  location?: string;
  contractor?: string;
  instructedBy?: string;
  origin?: 'manual' | 'nova';
  lines: TmLineWithSource[];
}

const MAX_LINES = 200;

/**
 * T&M (daywork) tickets: labour, equipment and material used on site, signed by the contractor and the principal's
 * representative (two different people), then converted once into direct costs or a draft variation. Builder staff
 * only. Lines freeze at the first signature; each signature stores a hash of what was signed.
 */
export function createTmTicketsService(deps: TmTicketsDeps) {
  const now = deps.now ?? (() => new Date());
  const today = () => now().toISOString().slice(0, 10);

  const need = async (scope: TenantScope, key: string, projectId: string) => {
    await deps.access.assert(scope, key, { projectId });
    if (scope.ctx.principalType !== 'member')
      throw new AppError('access.denied', "Only the builder's staff can work with T&M tickets.");
  };

  async function ticketRow(scope: TenantScope, projectId: string, id: string, lock = false) {
    const q = scope.tx
      .select()
      .from(tmTickets)
      .where(and(eq(tmTickets.id, id), eq(tmTickets.projectId, projectId)))
      .limit(1);
    const [r] = await (lock ? q.for('update') : q);
    if (!r) throw new AppError('financials.tm_ticket.not_found');
    return r;
  }

  const linesOf = (scope: TenantScope, ticketId: string) =>
    scope.tx
      .select()
      .from(tmTicketLines)
      .where(eq(tmTicketLines.ticketId, ticketId))
      .orderBy(asc(tmTicketLines.sort));

  const signoffsOf = (scope: TenantScope, ticketId: string) =>
    scope.tx
      .select()
      .from(tmTicketSignoffs)
      .where(eq(tmTicketSignoffs.ticketId, ticketId))
      .orderBy(asc(tmTicketSignoffs.signedAt));

  function validate(input: TmTicketInput) {
    const bad = (path: string, message: string) =>
      new AppError('validation_failed', message, [{ path, message }]);
    if (!input.title.trim()) throw bad('title', 'Give the ticket a title');
    if (input.workDate > today()) throw bad('workDate', 'Work cannot be dated in the future');
    if (input.lines.length === 0) throw bad('lines', 'Add at least one line');
    if (input.lines.length > MAX_LINES) throw bad('lines', `Use ${MAX_LINES} lines or fewer`);
    input.lines.forEach((l, i) => {
      if (!l.description.trim()) throw bad(`lines.${i}.description`, 'Required');
      if (!l.unit.trim()) throw bad(`lines.${i}.unit`, 'Required');
      if (!isQuantity(l.quantity)) throw bad(`lines.${i}.quantity`, 'Must be more than zero');
      if (!isMoney(l.rate) || toCents(l.rate) > MAX_RATE_CENTS)
        throw bad(`lines.${i}.rate`, 'Invalid amount (up to $1,000,000 a unit)');
      if (Boolean(l.sourceType) !== Boolean(l.sourceId))
        throw bad(`lines.${i}.sourceId`, 'Give both the source type and id, or neither');
    });
  }

  const lockProject = (scope: TenantScope, projectId: string) =>
    scope.tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${'tm_tickets:' + projectId}, 0))`,
    );

  /** Source ids must be real timesheet lines / equipment logs on this project for the ticket's work date. */
  async function verifySources(
    scope: TenantScope,
    projectId: string,
    workDate: string,
    lines: TmLineWithSource[],
  ) {
    const wanted = lines.filter((l) => l.sourceId);
    if (wanted.length === 0) return;
    const day = await deps.dayActivity(scope, projectId, workDate);
    const ok = new Set([
      ...day.labour.map((l) => `timesheet_line:${l.timesheetLineId}`),
      ...day.equipment.map((e) => `equipment_log:${e.equipmentLogId}`),
    ]);
    wanted.forEach((l, i) => {
      if (!ok.has(`${l.sourceType}:${l.sourceId}`))
        throw new AppError(
          'validation_failed',
          'That source record is not on this project for that day.',
          [
            {
              path: `lines.${i}.sourceId`,
              message: 'Not a timesheet or equipment record for that day',
            },
          ],
        );
    });
  }

  /** A timesheet line or equipment log can sit on one live ticket only (the database trigger is the backstop). */
  async function assertSourcesFree(
    scope: TenantScope,
    projectId: string,
    lines: TmLineWithSource[],
    exceptTicketId?: string,
  ) {
    const ids = lines.flatMap((l) => (l.sourceId ? [l.sourceId] : []));
    if (ids.length === 0) return;
    if (new Set(ids).size !== ids.length)
      throw new AppError(
        'financials.tm_ticket.duplicate_source',
        'The same record is on this ticket twice.',
      );
    const taken = await scope.tx
      .select({ id: tmTicketLines.sourceId })
      .from(tmTicketLines)
      .innerJoin(tmTickets, eq(tmTickets.id, tmTicketLines.ticketId))
      .where(
        and(
          eq(tmTicketLines.projectId, projectId),
          inArray(tmTicketLines.sourceId, ids),
          ne(tmTickets.status, 'void'),
          ...(exceptTicketId ? [ne(tmTickets.id, exceptTicketId)] : []),
        ),
      )
      .limit(1);
    if (taken.length)
      throw new AppError(
        'financials.tm_ticket.duplicate_source',
        'A timesheet or equipment record on this ticket is already on another T&M ticket.',
      );
  }

  function buildLines(
    scope: TenantScope,
    projectId: string,
    ticketId: string,
    lines: TmLineWithSource[],
  ) {
    return lines.map((l, i) => ({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId,
      ticketId,
      sort: i + 1,
      kind: l.kind,
      description: l.description.trim(),
      quantity: l.quantity,
      unit: l.unit.trim(),
      rate: l.rate,
      amount: fromCents(lineCents(l.quantity, l.rate)),
      sourceType: l.sourceType ?? null,
      sourceId: l.sourceId ?? null,
    }));
  }

  const detail = async (scope: TenantScope, ticket: TmTicketRow) => ({
    ticket,
    lines: await linesOf(scope, ticket.id),
    signoffs: await signoffsOf(scope, ticket.id),
  });

  async function createTicket(scope: TenantScope, projectId: string, input: TmTicketInput) {
    await need(scope, 'financials.tm_tickets.manage', projectId);
    validate(input);
    await lockProject(scope, projectId);
    await verifySources(scope, projectId, input.workDate, input.lines);
    await assertSourcesFree(scope, projectId, input.lines);
    const [n] = await scope.tx
      .select({ n: sql<number>`coalesce(max(${tmTickets.number}), 0) + 1` })
      .from(tmTickets)
      .where(eq(tmTickets.projectId, projectId));
    const id = uuidv7();
    const rows = buildLines(scope, projectId, id, input.lines);
    const [created] = await scope.tx
      .insert(tmTickets)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        number: Number(n!.n),
        title: input.title.trim(),
        description: input.description?.trim() || null,
        workDate: input.workDate,
        location: input.location?.trim() || null,
        contractor: input.contractor?.trim() || null,
        instructedBy: input.instructedBy?.trim() || null,
        origin: input.origin ?? 'manual',
        total: fromCents(totalCents(rows)),
        createdBy: scope.ctx.userId,
      })
      .returning();
    await scope.tx.insert(tmTicketLines).values(rows);
    await recordRetention(scope, {
      recordType: 'financials.tm_tickets',
      recordId: id,
      projectId,
      category: 'financial_7y',
      anchor: created!.createdAt,
    });
    scope.events.add({
      type: 'financials.tm_ticket.created.v1',
      projectId,
      entityType: 'tm_ticket',
      entityId: id,
      entityVersion: created!.version,
      data: { tmTicketId: id, number: created!.number, total: created!.total },
    });
    return detail(scope, created!);
  }

  /** Replaces a draft ticket's details and lines. Refused from the first signature. */
  async function updateTicket(
    scope: TenantScope,
    projectId: string,
    id: string,
    input: TmTicketInput,
  ) {
    await need(scope, 'financials.tm_tickets.manage', projectId);
    validate(input);
    await lockProject(scope, projectId);
    const t = await ticketRow(scope, projectId, id, true);
    if (t.status !== 'draft')
      throw new AppError(
        'financials.tm_ticket.bad_state',
        'A ticket cannot be changed once it has been signed. Void it and raise a new one.',
      );
    await verifySources(scope, projectId, input.workDate, input.lines);
    await assertSourcesFree(scope, projectId, input.lines, id);
    const rows = buildLines(scope, projectId, id, input.lines);
    await scope.tx.delete(tmTicketLines).where(eq(tmTicketLines.ticketId, id));
    await scope.tx.insert(tmTicketLines).values(rows);
    const [updated] = await scope.tx
      .update(tmTickets)
      .set({
        title: input.title.trim(),
        description: input.description?.trim() || null,
        workDate: input.workDate,
        location: input.location?.trim() || null,
        contractor: input.contractor?.trim() || null,
        instructedBy: input.instructedBy?.trim() || null,
        total: fromCents(totalCents(rows)),
        version: t.version + 1,
      })
      .where(and(eq(tmTickets.id, id), eq(tmTickets.version, t.version)))
      .returning();
    if (!updated) throw new AppError('conflict', 'This ticket just changed. Reload and try again.');
    return detail(scope, updated);
  }

  async function listTickets(scope: TenantScope, projectId: string) {
    await need(scope, 'financials.tm_tickets.read', projectId);
    const rows = await scope.tx
      .select()
      .from(tmTickets)
      .where(eq(tmTickets.projectId, projectId))
      .orderBy(desc(tmTickets.number));
    const live = rows.filter((r) => r.status !== 'void');
    return {
      rows,
      total: fromCents(live.reduce((n, r) => n + toCents(r.total), 0)),
      awaitingSignature: live.filter((r) => r.status === 'draft' || r.status === 'part_signed')
        .length,
      unconverted: live.filter((r) => r.status === 'signed').length,
    };
  }

  async function getTicket(scope: TenantScope, projectId: string, id: string) {
    await need(scope, 'financials.tm_tickets.read', projectId);
    return detail(scope, await ticketRow(scope, projectId, id));
  }

  async function signTicket(
    scope: TenantScope,
    projectId: string,
    id: string,
    input: {
      role: TmRole;
      signerName: string;
      signerPosition?: string;
      /** A ready file on this project: the photo of the docket signed on site. Required for the principal's rep. */
      evidenceFileId?: string;
      ip?: string | undefined;
      userAgent?: string | undefined;
    },
  ) {
    await need(scope, 'financials.tm_tickets.sign', projectId);
    if (!input.signerName.trim())
      throw new AppError('validation_failed', 'Type the signer’s full name.', [
        { path: 'signerName', message: 'Required' },
      ]);
    const t = await ticketRow(scope, projectId, id, true);
    if (t.status !== 'draft' && t.status !== 'part_signed')
      throw new AppError(
        'financials.tm_ticket.bad_state',
        `A ${t.status} ticket cannot be signed.`,
      );
    const lines = await linesOf(scope, id);
    if (lines.length === 0 || toCents(t.total) <= 0)
      throw new AppError(
        'financials.tm_ticket.bad_state',
        'There is nothing on this ticket to sign.',
      );
    if (input.role === 'principal_rep' && !input.evidenceFileId)
      throw new AppError(
        'validation_failed',
        'Attach a photo of the docket signed on site by the principal’s representative.',
        [{ path: 'evidenceFileId', message: 'Required for the principal’s representative' }],
      );
    if (input.evidenceFileId) {
      const f = await deps.getFile(scope, input.evidenceFileId);
      if (f.projectId !== projectId || f.status !== 'ready')
        throw new AppError('file.not_in_project', 'Attach a file uploaded to this project.', [
          { path: 'evidenceFileId', message: 'Not a ready file in this project' },
        ]);
    }
    const existing = await signoffsOf(scope, id);
    if (existing.some((s) => s.role === input.role))
      throw new AppError('financials.tm_ticket.bad_state', 'That role has already signed.');
    // Two different people: one user cannot be both the contractor and the principal's representative.
    if (existing.some((s) => s.signedBy === scope.ctx.userId))
      throw new AppError(
        'financials.tm_ticket.bad_state',
        'The second signature must come from a different person.',
      );
    const hash = contentHash({
      number: t.number,
      title: t.title,
      description: t.description,
      workDate: t.workDate,
      location: t.location,
      contractor: t.contractor,
      instructedBy: t.instructedBy,
      lines,
    });
    const [signoff] = await scope.tx
      .insert(tmTicketSignoffs)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        ticketId: id,
        role: input.role,
        signerName: input.signerName.trim(),
        signerPosition: input.signerPosition?.trim() || null,
        signedBy: scope.ctx.userId!,
        contentHash: hash,
        evidenceFileId: input.evidenceFileId ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent?.slice(0, 500) ?? null,
        signedAt: now(),
      })
      .returning();
    await recordRetention(scope, {
      recordType: 'financials.tm_ticket_signoffs',
      recordId: signoff!.id,
      projectId,
      category: 'financial_7y',
      anchor: signoff!.signedAt,
    });
    if (existing.length === 0)
      for (const l of lines)
        await recordRetention(scope, {
          recordType: 'financials.tm_ticket_lines',
          recordId: l.id,
          projectId,
          category: 'financial_7y',
          anchor: signoff!.signedAt,
        });
    const status = statusAfterSigning([...existing.map((s) => s.role), input.role]);
    const [updated] = await scope.tx
      .update(tmTickets)
      .set({ status, version: t.version + 1 })
      .where(and(eq(tmTickets.id, id), eq(tmTickets.version, t.version)))
      .returning();
    if (!updated) throw new AppError('conflict', 'This ticket just changed. Reload and try again.');
    scope.events.add({
      type: 'financials.tm_ticket.signed.v1',
      projectId,
      entityType: 'tm_ticket',
      entityId: id,
      entityVersion: updated.version,
      data: { tmTicketId: id, role: input.role, status, signoffId: signoff!.id },
    });
    return detail(scope, updated);
  }

  async function voidTicket(scope: TenantScope, projectId: string, id: string, note: string) {
    await need(scope, 'financials.tm_tickets.manage', projectId);
    if (!note.trim())
      throw new AppError(
        'financials.tm_ticket.reason_required',
        'Give the reason for voiding this ticket.',
        [{ path: 'note', message: 'Required' }],
      );
    const t = await ticketRow(scope, projectId, id, true);
    if (t.status === 'void' || t.status === 'converted')
      throw new AppError(
        'financials.tm_ticket.bad_state',
        `A ${t.status} ticket cannot be voided.`,
      );
    const [updated] = await scope.tx
      .update(tmTickets)
      .set({
        status: 'void',
        voidReason: note.trim(),
        voidedAt: now(),
        voidedBy: scope.ctx.userId,
        version: t.version + 1,
      })
      .where(and(eq(tmTickets.id, id), eq(tmTickets.version, t.version)))
      .returning();
    if (!updated) throw new AppError('conflict', 'This ticket just changed. Reload and try again.');
    scope.events.add({
      type: 'financials.tm_ticket.voided.v1',
      projectId,
      entityType: 'tm_ticket',
      entityId: id,
      entityVersion: updated.version,
      data: { tmTicketId: id, number: t.number },
    });
    return detail(scope, updated);
  }

  /**
   * Turns a fully signed ticket into money, once. `direct_cost` posts one direct cost per kind to a budget line;
   * `variation` drafts a variation on a contract for the total, which then goes through the usual submit and approve
   * steps before it can be claimed.
   */
  async function convertTicket(
    scope: TenantScope,
    projectId: string,
    id: string,
    target: { to: 'direct_cost'; budgetLineId: string } | { to: 'variation'; contractId: string },
  ) {
    await need(scope, 'financials.tm_tickets.convert', projectId);
    const t = await ticketRow(scope, projectId, id, true);
    if (t.status !== 'signed')
      throw new AppError(
        'financials.tm_ticket.bad_state',
        t.status === 'converted'
          ? 'This ticket has already been converted.'
          : 'Both signatures are needed before a ticket can be converted.',
      );
    const lines = await linesOf(scope, id);
    // What is about to become money must still be what was signed.
    const signed = await signoffsOf(scope, id);
    const hash = contentHash({ ...t, lines });
    if (
      totalCents(lines) !== toCents(t.total) ||
      signed.length !== 2 ||
      signed.some((s) => s.contentHash !== hash)
    )
      throw new AppError(
        'financials.tm_ticket.bad_state',
        'This ticket no longer matches what was signed. Void it and raise a new one.',
      );
    const patch: Partial<typeof tmTickets.$inferInsert> = {
      status: 'converted',
      convertedAt: now(),
      convertedBy: scope.ctx.userId,
      version: t.version + 1,
    };
    if (target.to === 'direct_cost') {
      const byKind = totalsByKind(lines);
      for (const kind of Object.keys(byKind) as TmKind[]) {
        if (byKind[kind] <= 0) continue;
        const cost = await deps.directCosts.recordDirectCost(scope, projectId, {
          budgetLineId: target.budgetLineId,
          category: DIRECT_COST_CATEGORY[kind],
          description: `T&M ${t.number}: ${t.title}`.slice(0, 300),
          ...(t.contractor ? { supplier: t.contractor } : {}),
          reference: `T&M-${t.number}`,
          incurredOn: t.workDate,
          amount: fromCents(byKind[kind]),
        });
        await scope.tx
          .insert(tmTicketDirectCosts)
          .values({ orgId: scope.ctx.orgId, ticketId: id, directCostId: cost.id });
      }
      patch.convertedTo = 'direct_cost';
    } else {
      const v = await deps.createVariation(scope, projectId, target.contractId, {
        title: `Daywork T&M ${t.number}: ${t.title}`.slice(0, 300),
        description: `From T&M ticket ${t.number} (sign-off recorded by builder staff), work done ${t.workDate}${
          t.location ? ` at ${t.location}` : ''
        }.`,
        amount: t.total,
      });
      patch.convertedTo = 'variation';
      patch.variationId = v.variation.id;
    }
    const [updated] = await scope.tx
      .update(tmTickets)
      .set(patch)
      .where(and(eq(tmTickets.id, id), eq(tmTickets.version, t.version)))
      .returning();
    if (!updated) throw new AppError('conflict', 'This ticket just changed. Reload and try again.');
    scope.events.add({
      type: 'financials.tm_ticket.converted.v1',
      projectId,
      entityType: 'tm_ticket',
      entityId: id,
      entityVersion: updated.version,
      data: { tmTicketId: id, to: target.to, total: t.total },
    });
    return detail(scope, updated);
  }

  /**
   * Nova's draft (rule-based, no model): the day's timesheet lines and equipment logs, less any already on a live
   * ticket, as unpriced lines. A person adds the rates, reviews and creates the ticket, then signs it on site.
   */
  async function suggest(scope: TenantScope, projectId: string, date: string) {
    await need(scope, 'financials.tm_tickets.manage', projectId);
    if (date > today())
      throw new AppError('validation_failed', 'Pick a day that is not in the future.', [
        { path: 'date', message: 'Must not be in the future' },
      ]);
    const activity = await deps.dayActivity(scope, projectId, date);
    const used = new Set(
      (
        await scope.tx
          .select({ id: tmTicketLines.sourceId })
          .from(tmTicketLines)
          .innerJoin(tmTickets, eq(tmTickets.id, tmTicketLines.ticketId))
          .where(
            and(
              eq(tmTicketLines.projectId, projectId),
              isNotNull(tmTicketLines.sourceId),
              ne(tmTickets.status, 'void'),
            ),
          )
      ).map((r) => r.id),
    );
    const lines: (TmLineInput & TmSourceRef)[] = [
      ...activity.labour
        .filter((l) => !used.has(l.timesheetLineId))
        .map((l) => ({
          kind: 'labour' as const,
          description: l.worker,
          quantity: l.hours,
          unit: 'hr',
          rate: '0.00',
          sourceType: 'timesheet_line' as const,
          sourceId: l.timesheetLineId,
        })),
      ...activity.equipment
        .filter((e) => !used.has(e.equipmentLogId))
        .map((e) => ({
          kind: 'equipment' as const,
          description: `${e.name} (${e.assetNumber})${e.operator ? `, operator ${e.operator}` : ''}`,
          quantity: e.hours,
          unit: 'hr',
          rate: '0.00',
          sourceType: 'equipment_log' as const,
          sourceId: e.equipmentLogId,
        })),
    ];
    return { date, lines };
  }

  async function directCostIds(scope: TenantScope, projectId: string, id: string) {
    await need(scope, 'financials.tm_tickets.read', projectId);
    await ticketRow(scope, projectId, id);
    const rows = await scope.tx
      .select({ id: tmTicketDirectCosts.directCostId })
      .from(tmTicketDirectCosts)
      .where(eq(tmTicketDirectCosts.ticketId, id));
    return rows.map((r) => r.id);
  }

  return {
    createTicket,
    updateTicket,
    listTickets,
    getTicket,
    signTicket,
    voidTicket,
    convertTicket,
    suggest,
    directCostIds,
  };
}

export type TmTicketsService = ReturnType<typeof createTmTicketsService>;
