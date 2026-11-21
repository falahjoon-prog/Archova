import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, nextNumber, versionConflict, type TenantScope } from '@archova/kernel';
import {
  itpItems,
  itpPackages,
  documentsTable,
  type ItpItemStatus,
  type ItpPointType,
} from '../infra/tables';
import { blockingHold, canComplete, progress, templateFor } from '../domain/itp';
import type { DocumentsContext } from './context';
import type { DocumentService } from './documents';

type PackageRow = typeof itpPackages.$inferSelect;
type ItemRow = typeof itpItems.$inferSelect;

export interface ItemInput {
  description: string;
  acceptanceCriteria?: string | null;
  pointType: ItpPointType;
}

const APPROVED = ['approved', 'for_construction'];

/** ITP packages: the inspection points for a piece of work, signed off in order and tied to its document. */
export function createItpService(c: DocumentsContext, documents: DocumentService) {
  async function getRow(scope: TenantScope, projectId: string, packageId: string) {
    const [row] = await scope.tx
      .select()
      .from(itpPackages)
      .where(and(eq(itpPackages.id, packageId), eq(itpPackages.projectId, projectId)))
      .limit(1);
    if (!row) throw new AppError('itp.not_found');
    return row;
  }

  async function linkedDocument(scope: TenantScope, row: PackageRow) {
    if (!row.documentId) return null;
    const [d] = await scope.tx
      .select({
        id: documentsTable.id,
        title: documentsTable.title,
        docNumber: documentsTable.docNumber,
        status: documentsTable.status,
      })
      .from(documentsTable)
      .where(eq(documentsTable.id, row.documentId))
      .limit(1);
    return d ?? null;
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: { documentId?: string; status?: string } = {},
  ) {
    await c.requireProject(scope, projectId);
    const rows = await scope.tx
      .select()
      .from(itpPackages)
      .where(
        and(
          eq(itpPackages.projectId, projectId),
          opts.documentId ? eq(itpPackages.documentId, opts.documentId) : undefined,
          opts.status ? eq(itpPackages.status, opts.status as PackageRow['status']) : undefined,
        ),
      )
      .orderBy(desc(itpPackages.number))
      .limit(200);
    const items = rows.length
      ? await scope.tx
          .select()
          .from(itpItems)
          .where(
            inArray(
              itpItems.packageId,
              rows.map((r) => r.id),
            ),
          )
      : [];
    return rows.map((r) => ({
      package: r,
      progress: progress(items.filter((i) => i.packageId === r.id)),
    }));
  }

  async function detail(scope: TenantScope, projectId: string, packageId: string) {
    const row = await getRow(scope, projectId, packageId);
    const items = await scope.tx
      .select()
      .from(itpItems)
      .where(eq(itpItems.packageId, packageId))
      .orderBy(asc(itpItems.sort));
    return {
      package: row,
      items,
      progress: progress(items),
      document: await linkedDocument(scope, row),
    };
  }

  async function checkLinks(
    scope: TenantScope,
    projectId: string,
    input: { documentId?: string | null; responsibleCompanyId?: string | null },
  ) {
    if (input.documentId) await documents.detail(scope, projectId, input.documentId);
    if (input.responsibleCompanyId)
      await c.requireCompany(scope, projectId, input.responsibleCompanyId);
  }

  function checkItems(items: ItemInput[]) {
    if (items.length > 100)
      throw new AppError('validation_failed', 'An ITP can have up to 100 points.', [
        { path: 'items', message: 'Too many' },
      ]);
    items.forEach((it, i) => {
      if (!it.description.trim())
        throw new AppError('validation_failed', 'Describe each point.', [
          { path: `items/${i}/description`, message: 'Required' },
        ]);
    });
  }

  const itemValues = (
    scope: TenantScope,
    projectId: string,
    packageId: string,
    items: ItemInput[],
  ) =>
    items.map((it, i) => ({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId,
      packageId,
      sort: i + 1,
      description: it.description.trim(),
      acceptanceCriteria: it.acceptanceCriteria?.trim() || null,
      pointType: it.pointType,
      status: 'pending' as const,
    }));

  async function create(
    scope: TenantScope,
    projectId: string,
    input: {
      name: string;
      discipline?: string | null;
      documentId?: string | null;
      responsibleCompanyId?: string | null;
      items?: ItemInput[];
      /** Fill the points from Nova's starter for the discipline (rules only). */
      fromTemplate?: boolean;
    },
  ) {
    await c.requireProject(scope, projectId);
    await checkLinks(scope, projectId, input);
    const items = input.items ?? (input.fromTemplate ? templateFor(input.discipline).items : []);
    checkItems(items);
    const id = uuidv7();
    const number = `ITP-${String(await nextNumber(scope, projectId, 'itp_package')).padStart(4, '0')}`;
    await scope.tx.insert(itpPackages).values({
      id,
      orgId: scope.ctx.orgId,
      projectId,
      number,
      name: input.name.trim(),
      discipline: input.discipline?.trim() || null,
      documentId: input.documentId ?? null,
      responsibleCompanyId: input.responsibleCompanyId ?? null,
      status: 'draft',
      createdBy: scope.ctx.userId,
      updatedBy: scope.ctx.userId,
    });
    if (items.length)
      await scope.tx.insert(itpItems).values(itemValues(scope, projectId, id, items));
    return detail(scope, projectId, id);
  }

  /** Points and links can change only while the package is a draft; once active it is a record. */
  async function update(
    scope: TenantScope,
    projectId: string,
    packageId: string,
    expectedVersion: number,
    patch: {
      name?: string;
      discipline?: string | null;
      documentId?: string | null;
      responsibleCompanyId?: string | null;
      items?: ItemInput[];
    },
  ) {
    const row = await getRow(scope, projectId, packageId);
    if (row.version !== expectedVersion) throw versionConflict();
    if (row.status !== 'draft')
      throw new AppError('itp.not_editable', 'Only a draft ITP can be edited.');
    await checkLinks(scope, projectId, patch);
    if (patch.items) checkItems(patch.items);
    const [upd] = await scope.tx
      .update(itpPackages)
      .set({
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.discipline !== undefined ? { discipline: patch.discipline?.trim() || null } : {}),
        ...(patch.documentId !== undefined ? { documentId: patch.documentId } : {}),
        ...(patch.responsibleCompanyId !== undefined
          ? { responsibleCompanyId: patch.responsibleCompanyId }
          : {}),
        updatedBy: scope.ctx.userId,
        updatedAt: new Date(),
        version: row.version + 1,
      })
      .where(and(eq(itpPackages.id, packageId), eq(itpPackages.version, expectedVersion)))
      .returning();
    if (!upd) throw versionConflict();
    if (patch.items) {
      await scope.tx.delete(itpItems).where(eq(itpItems.packageId, packageId));
      if (patch.items.length)
        await scope.tx
          .insert(itpItems)
          .values(itemValues(scope, projectId, packageId, patch.items));
    }
    return detail(scope, projectId, packageId);
  }

  /** Work may start only against an approved document (document sign-off gates the test plan). */
  async function activate(scope: TenantScope, projectId: string, packageId: string) {
    const d = await detail(scope, projectId, packageId);
    if (d.package.status !== 'draft') return d;
    if (d.items.length === 0)
      throw new AppError('itp.invalid', 'Add at least one point before activating.');
    if (d.document && !APPROVED.includes(d.document.status))
      throw new AppError(
        'itp.document_not_approved',
        `Document ${d.document.docNumber ?? d.document.title} is not approved yet.`,
      );
    await scope.tx
      .update(itpPackages)
      .set({
        status: 'active',
        updatedBy: scope.ctx.userId,
        updatedAt: new Date(),
        version: d.package.version + 1,
      })
      .where(eq(itpPackages.id, packageId));
    return detail(scope, projectId, packageId);
  }

  async function signItem(
    scope: TenantScope,
    projectId: string,
    packageId: string,
    itemId: string,
    input: { status: ItpItemStatus; note?: string | null },
  ) {
    const d = await detail(scope, projectId, packageId);
    if (d.package.status === 'draft')
      throw new AppError('itp.invalid', 'Activate the ITP before signing points.');
    const item = d.items.find((i) => i.id === itemId);
    if (!item) throw new AppError('itp.not_found');
    const note = input.note?.trim() || null;
    if ((input.status === 'failed' || input.status === 'waived') && !note)
      throw new AppError('validation_failed', 'Say why.', [{ path: 'note', message: 'Required' }]);
    if (input.status === 'passed') {
      const block = blockingHold(d.items, itemId);
      if (block)
        throw new AppError(
          'itp.hold_point_open',
          `Hold point ${block.sort} must be signed first.`,
          undefined,
          {
            holdSort: block.sort,
          },
        );
    }
    const reset = input.status === 'pending';
    await scope.tx
      .update(itpItems)
      .set({
        status: input.status,
        signedBy: reset ? null : scope.ctx.userId,
        signedAt: reset ? null : new Date(),
        note,
        updatedAt: new Date(),
        version: item.version + 1,
      })
      .where(eq(itpItems.id, itemId));
    const after = d.items.map((i) => ({ ...i, status: i.id === itemId ? input.status : i.status }));
    const complete = canComplete(after);
    if (complete !== (d.package.status === 'complete'))
      await scope.tx
        .update(itpPackages)
        .set({
          status: complete ? 'complete' : 'active',
          completedAt: complete ? new Date() : null,
          updatedAt: new Date(),
          version: sql`${itpPackages.version} + 1`,
        })
        .where(eq(itpPackages.id, packageId));
    return detail(scope, projectId, packageId);
  }

  function template(discipline: string | null | undefined) {
    return templateFor(discipline);
  }

  return { list, detail, create, update, activate, signItem, template };
}

export type ItpService = ReturnType<typeof createItpService>;
export type { ItemRow };
