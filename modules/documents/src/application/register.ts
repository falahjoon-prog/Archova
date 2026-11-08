import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { TenantScope } from '@archova/kernel';
import { localDateOf } from '@archova/time';
import {
  computeRegister,
  type RegisterItemInput,
  type RegisterRow,
  type RevisionRef,
  type SentTransmittal,
} from '../domain/distribution';
import {
  documentRevisions,
  documentsTable,
  drawingRevisions,
  drawingSheets,
  transmittalItems,
  transmittalRecipients,
  transmittals,
} from '../infra/tables';
import type { DocumentsContext } from './context';
import type { FolderService } from './folders';

/** The register lists every sheet and document; a project beyond this is paged in a later increment. */
const MAX_ITEMS = 2000;

/** The document control register: current revisions with who was sent what, and what needs chasing. */
export function createRegisterService(
  c: DocumentsContext,
  folders: Pick<FolderService, 'hiddenIds'>,
  clock: () => Date = () => new Date(),
) {
  async function register(scope: TenantScope, projectId: string): Promise<RegisterRow[]> {
    const project = await c.requireProject(scope, projectId);
    const now = clock();

    const sheets = await scope.tx
      .select({ sheet: drawingSheets, rev: drawingRevisions.rev })
      .from(drawingSheets)
      .leftJoin(drawingRevisions, eq(drawingRevisions.id, drawingSheets.currentRevisionId))
      .where(eq(drawingSheets.projectId, projectId))
      .limit(MAX_ITEMS);
    const hidden = await folders.hiddenIds(scope, projectId);
    const docs = (
      await scope.tx
        .select({ doc: documentsTable, rev: documentRevisions.rev })
        .from(documentsTable)
        .leftJoin(documentRevisions, eq(documentRevisions.id, documentsTable.currentRevisionId))
        .where(and(eq(documentsTable.projectId, projectId), isNull(documentsTable.deletedAt)))
        .limit(MAX_ITEMS)
    ).filter((d) => !hidden.has(d.doc.folderId));

    const items: RegisterItemInput[] = [
      ...sheets.map(({ sheet, rev }) => ({
        kind: 'drawing' as const,
        key: sheet.id,
        number: sheet.sheetNumber,
        title: sheet.title,
        discipline: sheet.discipline,
        currentRevisionId: sheet.currentRevisionId,
        currentRev: rev,
      })),
      ...docs.map(({ doc, rev }) => ({
        kind: 'document' as const,
        key: doc.id,
        number: doc.docNumber,
        title: doc.title,
        discipline: doc.discipline,
        currentRevisionId: doc.currentRevisionId,
        currentRev: rev,
      })),
    ];

    const sentRows = await scope.tx
      .select()
      .from(transmittals)
      .where(
        and(
          eq(transmittals.projectId, projectId),
          eq(transmittals.status, 'sent'),
          isNull(transmittals.deletedAt),
        ),
      );
    const ids = sentRows.map((t) => t.id);
    const [itemRows, recipientRows] = ids.length
      ? await Promise.all([
          scope.tx
            .select()
            .from(transmittalItems)
            .where(inArray(transmittalItems.transmittalId, ids)),
          scope.tx
            .select()
            .from(transmittalRecipients)
            .where(inArray(transmittalRecipients.transmittalId, ids)),
        ])
      : [[], []];

    const drawingRevIds = [
      ...new Set(itemRows.filter((i) => i.revisionType === 'drawing').map((i) => i.revisionId)),
    ];
    const docRevIds = [
      ...new Set(itemRows.filter((i) => i.revisionType === 'document').map((i) => i.revisionId)),
    ];
    const [dRevs, docRevs] = await Promise.all([
      drawingRevIds.length
        ? scope.tx
            .select({
              id: drawingRevisions.id,
              sheetId: drawingRevisions.sheetId,
              rev: drawingRevisions.rev,
            })
            .from(drawingRevisions)
            .where(inArray(drawingRevisions.id, drawingRevIds))
        : [],
      docRevIds.length
        ? scope.tx
            .select({
              id: documentRevisions.id,
              documentId: documentRevisions.documentId,
              rev: documentRevisions.rev,
            })
            .from(documentRevisions)
            .where(inArray(documentRevisions.id, docRevIds))
        : [],
    ]);
    const revisions: RevisionRef[] = [
      ...dRevs.flatMap((r) =>
        r.sheetId
          ? [{ kind: 'drawing' as const, revisionId: r.id, itemKey: r.sheetId, rev: r.rev }]
          : [],
      ),
      ...docRevs.map((r) => ({
        kind: 'document' as const,
        revisionId: r.id,
        itemKey: r.documentId,
        rev: r.rev,
      })),
    ];

    const sent: SentTransmittal[] = sentRows.map((t) => ({
      id: t.id,
      number: t.number!,
      sentAt: t.sentAt!,
      responseDue: t.responseDue,
      items: itemRows
        .filter((i) => i.transmittalId === t.id)
        .map((i) => ({ kind: i.revisionType, revisionId: i.revisionId })),
      recipients: recipientRows
        .filter((r) => r.transmittalId === t.id)
        .map((r) => ({
          email: r.email,
          name: r.name,
          companyId: r.companyId,
          role: r.role,
          deliveredAt: r.deliveredAt,
          openedAt: r.openedAt,
          downloadedAt: r.downloadedAt,
          acknowledgedAt: r.acknowledgedAt,
        })),
    }));

    return computeRegister({
      items,
      revisions,
      transmittals: sent,
      now,
      today: localDateOf(now, project.timezone as string),
    });
  }

  return { register };
}

export type RegisterService = ReturnType<typeof createRegisterService>;
