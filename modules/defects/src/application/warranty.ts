import { and, asc, desc, eq, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import {
  CLAIM_RESPONSE_SLA_DAYS,
  defectLabel,
  uuidv7,
  warrantyExpiry,
  warrantyFlags,
  warrantyState,
  type FlagClaim,
  type WarrantyFlag,
  type WarrantyResponsibleType,
  type WarrantyState,
  type WarrantySystem,
} from '@archova/domain';
import { daysBetween, localDateOf, type LocalDate } from '@archova/time';
import { AppError, nextNumber, versionConflict, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { PlatformApi } from '@archova/mod-platform';
import { defects, warrantyItems } from '../infra/tables';

export type WarrantyRow = typeof warrantyItems.$inferSelect;
export interface WarrantyItemView extends WarrantyRow {
  state: WarrantyState;
  daysToExpiry: number;
  claimCount: number;
  openClaimCount: number;
}
export interface WarrantyClaimView {
  defectId: string;
  number: number;
  title: string;
  status: (typeof defects.$inferSelect)['status'];
  priority: (typeof defects.$inferSelect)['priority'];
  trade: string | null;
  warrantyItemId: string | null;
  assigneeCompanyId: string | null;
  raisedAt: Date;
  closedAt: Date | null;
  daysOpen: number;
  isOverdue: boolean;
}

export interface WarrantyDeps {
  access: AccessService;
  platform: Pick<PlatformApi, 'getProject' | 'projectCompanies'>;
  now?: () => Date;
}

export interface WarrantyFields {
  name?: string;
  system?: WarrantySystem;
  description?: string;
  responsibleType?: WarrantyResponsibleType;
  responsibleCompanyId?: string | null;
  responsibleName?: string | null;
  startDate?: string;
  durationMonths?: number;
}

/**
 * Warranty register for the defects liability period and beyond. A claim is an ordinary defect (stage `dlp` or tied
 * to an item), so raising, answering and closing one is the defect lifecycle; this service adds the register of what
 * is under warranty and a claim history that owners and clients can read in summary.
 */
export function createWarrantyService(deps: WarrantyDeps) {
  const now = deps.now ?? (() => new Date());

  /**
   * Subcontractors hold the defects tool scoped to their company, so they see only the items they answer for and the
   * claims assigned to them. Builder staff, owners and clients see the whole project. Returns the company to scope to.
   */
  async function companyScope(scope: TenantScope, projectId: string): Promise<string | null> {
    const perms = await deps.access.effectivePermissions(scope, projectId);
    return perms.companyScopedTools.includes('defects') ? (perms.companyId ?? 'none') : null;
  }

  /** The project's calendar: its time zone and today's date there (X34). */
  async function calendar(scope: TenantScope, projectId: string) {
    const { timezone } = await deps.platform.getProject(scope, projectId);
    return { timezone, today: localDateOf(now(), timezone) };
  }

  /** Claims are issued defects that are in the liability period or against a warranty item. Drafts and voids aren't claims. */
  const claimCondition = (projectId: string): SQL =>
    and(
      eq(defects.projectId, projectId),
      isNull(defects.deletedAt),
      notInArray(defects.status, ['draft', 'void']),
      or(eq(defects.stage, 'dlp'), sql`${defects.warrantyItemId} is not null`),
    )!;

  async function claimRows(
    scope: TenantScope,
    projectId: string,
    cal: { timezone: string; today: LocalDate },
  ) {
    const only = await companyScope(scope, projectId);
    const rows = await scope.tx
      .select()
      .from(defects)
      .where(and(claimCondition(projectId), only ? eq(defects.assigneeCompanyId, only) : undefined))
      .orderBy(desc(defects.issuedAt), desc(defects.id));
    return rows.map((r): WarrantyClaimView => {
      const raisedAt = r.issuedAt ?? r.createdAt;
      const raised = localDateOf(raisedAt, cal.timezone);
      const end = r.closedAt ? localDateOf(r.closedAt, cal.timezone) : cal.today;
      const open = r.status === 'open' || r.status === 'disputed';
      const daysOpen = Math.max(0, daysBetween(raised, end));
      return {
        defectId: r.id,
        number: r.number,
        title: r.title,
        status: r.status,
        priority: r.priority,
        trade: r.trade,
        warrantyItemId: r.warrantyItemId,
        assigneeCompanyId: r.assigneeCompanyId,
        raisedAt,
        closedAt: r.closedAt,
        daysOpen,
        isOverdue: open && daysOpen > CLAIM_RESPONSE_SLA_DAYS,
      };
    });
  }

  function withState(
    r: WarrantyRow,
    localToday: LocalDate,
    claims: readonly WarrantyClaimView[],
  ): WarrantyItemView {
    const mine = claims.filter((c) => c.warrantyItemId === r.id);
    return {
      ...r,
      state: warrantyState(r.expiryDate, localToday),
      daysToExpiry: daysBetween(localToday, r.expiryDate),
      claimCount: mine.length,
      openClaimCount: mine.filter((c) => c.status === 'open' || c.status === 'disputed').length,
    };
  }

  async function getRow(scope: TenantScope, projectId: string, itemId: string) {
    const [row] = await scope.tx
      .select()
      .from(warrantyItems)
      .where(
        and(
          eq(warrantyItems.id, itemId),
          eq(warrantyItems.projectId, projectId),
          isNull(warrantyItems.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new AppError('warranty.not_found');
    const only = await companyScope(scope, projectId);
    if (only && row.responsibleCompanyId !== only) throw new AppError('warranty.not_found');
    return row;
  }

  async function detail(scope: TenantScope, projectId: string, itemId: string) {
    const cal = await calendar(scope, projectId);
    const localToday = cal.today;
    const row = await getRow(scope, projectId, itemId);
    const claims = (await claimRows(scope, projectId, cal)).filter(
      (c) => c.warrantyItemId === itemId,
    );
    return { item: withState(row, localToday, claims), claims };
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: { state?: WarrantyState; system?: WarrantySystem },
  ) {
    const cal = await calendar(scope, projectId);
    const localToday = cal.today;
    const conditions: SQL[] = [
      eq(warrantyItems.projectId, projectId),
      isNull(warrantyItems.deletedAt),
    ];
    if (opts.system) conditions.push(eq(warrantyItems.system, opts.system));
    const only = await companyScope(scope, projectId);
    if (only) conditions.push(eq(warrantyItems.responsibleCompanyId, only));
    const rows = await scope.tx
      .select()
      .from(warrantyItems)
      .where(and(...conditions))
      .orderBy(asc(warrantyItems.expiryDate), asc(warrantyItems.number));
    const claims = await claimRows(scope, projectId, cal);
    return rows
      .map((r) => withState(r, localToday, claims))
      .filter((r) => !opts.state || r.state === opts.state);
  }

  async function checkResponsible(
    scope: TenantScope,
    projectId: string,
    type: WarrantyResponsibleType,
    companyId: string | null,
    name: string | null,
  ) {
    if (type !== 'builder' && !companyId && !name)
      throw new AppError(
        'warranty.responsible_required',
        'Name the company or supplier answerable for this warranty.',
        [{ path: 'responsibleName', message: 'Pick a company or enter a name' }],
      );
    if (companyId) {
      const onProject = await deps.platform.projectCompanies(scope, projectId);
      if (!onProject.some((c) => c.id === companyId))
        throw new AppError('defect.assignee_not_on_project', 'Pick a company on this project.', [
          { path: 'responsibleCompanyId', message: 'Not a company on the project' },
        ]);
    }
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    input: WarrantyFields &
      Required<
        Pick<WarrantyFields, 'name' | 'system' | 'responsibleType' | 'startDate' | 'durationMonths'>
      >,
  ) {
    await deps.platform.getProject(scope, projectId);
    const companyId = input.responsibleCompanyId ?? null;
    const name = input.responsibleName?.trim() || null;
    await checkResponsible(scope, projectId, input.responsibleType, companyId, name);
    const id = uuidv7();
    await scope.tx.insert(warrantyItems).values({
      id,
      orgId: scope.ctx.orgId,
      projectId,
      number: await nextNumber(scope, projectId, 'warranty_item'),
      name: input.name.trim(),
      system: input.system,
      description: input.description ?? '',
      responsibleType: input.responsibleType,
      responsibleCompanyId: companyId,
      responsibleName: name,
      startDate: input.startDate,
      durationMonths: input.durationMonths,
      expiryDate: warrantyExpiry(input.startDate, input.durationMonths),
      createdBy: scope.ctx.userId,
      updatedBy: scope.ctx.userId,
    });
    return detail(scope, projectId, id);
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    itemId: string,
    expectedVersion: number,
    patch: WarrantyFields,
  ) {
    const row = await getRow(scope, projectId, itemId);
    if (row.version !== expectedVersion) throw versionConflict();
    const type = patch.responsibleType ?? row.responsibleType;
    const companyId =
      patch.responsibleCompanyId !== undefined
        ? patch.responsibleCompanyId
        : row.responsibleCompanyId;
    const name =
      patch.responsibleName !== undefined
        ? patch.responsibleName?.trim() || null
        : row.responsibleName;
    await checkResponsible(scope, projectId, type, companyId, name);
    const startDate = patch.startDate ?? row.startDate;
    const durationMonths = patch.durationMonths ?? row.durationMonths;
    const [updated] = await scope.tx
      .update(warrantyItems)
      .set({
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.system !== undefined ? { system: patch.system } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        responsibleType: type,
        responsibleCompanyId: companyId,
        responsibleName: name,
        startDate,
        durationMonths,
        expiryDate: warrantyExpiry(startDate, durationMonths),
        version: row.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(warrantyItems.id, itemId), eq(warrantyItems.version, expectedVersion)))
      .returning({ id: warrantyItems.id });
    if (!updated) throw versionConflict();
    return detail(scope, projectId, itemId);
  }

  /** Removes the item from the register. Claims keep their defect row; the link is cleared so nothing dangles. */
  async function remove(scope: TenantScope, projectId: string, itemId: string) {
    await getRow(scope, projectId, itemId);
    await scope.tx
      .update(defects)
      .set({ warrantyItemId: null })
      .where(and(eq(defects.projectId, projectId), eq(defects.warrantyItemId, itemId)));
    await scope.tx
      .update(warrantyItems)
      .set({ deletedAt: now(), updatedBy: scope.ctx.userId, updatedAt: now() })
      .where(eq(warrantyItems.id, itemId));
  }

  async function claims(scope: TenantScope, projectId: string, opts: { warrantyItemId?: string }) {
    const all = await claimRows(scope, projectId, await calendar(scope, projectId));
    return opts.warrantyItemId ? all.filter((c) => c.warrantyItemId === opts.warrantyItemId) : all;
  }

  async function summary(scope: TenantScope, projectId: string) {
    const cal = await calendar(scope, projectId);
    const localToday = cal.today;
    const only = await companyScope(scope, projectId);
    const rows = await scope.tx
      .select()
      .from(warrantyItems)
      .where(
        and(
          eq(warrantyItems.projectId, projectId),
          isNull(warrantyItems.deletedAt),
          only ? eq(warrantyItems.responsibleCompanyId, only) : undefined,
        ),
      );
    const all = await claimRows(scope, projectId, cal);
    const states = rows.map((r) => warrantyState(r.expiryDate, localToday));
    const open = all.filter((c) => c.status === 'open' || c.status === 'disputed');
    const flags: WarrantyFlag[] = warrantyFlags(
      rows.map((r) => ({ id: r.id, name: r.name, system: r.system, expiryDate: r.expiryDate })),
      all.map((c) => ({
        id: c.defectId,
        numberLabel: defectLabel(c.number),
        title: c.title,
        status: c.status as FlagClaim['status'],
        trade: c.trade,
        warrantyItemId: c.warrantyItemId,
        issuedOn: localDateOf(c.raisedAt, cal.timezone),
      })),
      localToday,
    );
    return {
      itemCount: rows.length,
      expiringCount: states.filter((s) => s === 'expiring').length,
      expiredCount: states.filter((s) => s === 'expired').length,
      openClaimCount: open.length,
      closedClaimCount: all.filter((c) => c.status === 'closed').length,
      flags,
    };
  }

  return { list, detail, create, update, remove, claims, summary };
}

export type WarrantyService = ReturnType<typeof createWarrantyService>;
