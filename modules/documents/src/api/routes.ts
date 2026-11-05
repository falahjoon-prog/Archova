import { decodeId, encodeId, type IdKind } from '@archova/domain';
import {
  ACCESS_LINK_COOKIE,
  ACCESS_LINK_SESSION_MS,
  AppError,
  defineRoutes,
  etag,
  parseIfMatch,
  requireTenant,
  type Database,
  type Logger,
  type MessageSender,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { IdentityApi } from '@archova/mod-identity';
import type { PlatformApi } from '@archova/mod-platform';
import type { ProblemCode } from '@archova/contracts';
import type { StoredShape } from '../domain/markup';
import type { DocumentService } from '../application/documents';
import type { DrawingService } from '../application/drawings';
import type { FolderService } from '../application/folders';
import type { GeometryService } from '../application/geometry';
import type { TileService } from '../application/tiles';
import type { MarkupService } from '../application/markups';
import type {
  IssuedLink,
  TransmittalItemView,
  TransmittalService,
} from '../application/transmittals';
import type { TransmittalLinkService } from '../application/transmittal-links';
import {
  toDocumentDetail,
  toDocumentDto,
  toDrawingRevisionDto,
  toDrawingSetDto,
  toDrawingSheetDto,
  toFolderDto,
  toMarkupDto,
  toRecipientDto,
  toSheetGeometryDto,
  toTransmittalDto,
} from './mappers';

export interface DocumentsRouteDeps {
  database: Database;
  identity: Pick<IdentityApi, 'findUserByEmail' | 'getUser'>;
  folders: FolderService;
  documents: DocumentService;
  drawings: DrawingService;
  markups: MarkupService;
  geometry: GeometryService;
  tiles: TileService;
  transmittals: TransmittalService;
  links: TransmittalLinkService;
  platform: Pick<PlatformApi, 'getProject' | 'getOrg'>;
  messages: MessageSender;
  /** The public web origin transmittal links point at, e.g. `https://app.archova.com.au`. */
  baseUrl: string;
  logger?: Pick<Logger, 'warn'>;
}

/** Decodes a prefixed id from the path or body; a malformed id is the same 404 as a missing record. */
function id(kind: IdKind, value: string, notFound: ProblemCode): string {
  const uuid = decodeId(kind, value);
  if (!uuid) throw new AppError(notFound);
  return uuid;
}

/** Ids in request bodies that don't decode are a 422 on that field, not a 404. */
function ref(kind: IdKind, value: string, path: string): string {
  const uuid = decodeId(kind, value);
  if (!uuid)
    throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
  return uuid;
}

const project = (p: { projectId: string }) => id('project', p.projectId, 'project.not_found');

const toTransmittalDetail = (x: Awaited<ReturnType<TransmittalService['detail']>>) => ({
  transmittal: toTransmittalDto(x.transmittal),
  items: x.items.map(({ fileId: _fileId, ...i }: TransmittalItemView) => ({
    ...i,
    revisionId: encodeId(
      i.revisionType === 'document' ? 'revision' : 'drawingRevision',
      i.revisionId,
    ),
  })),
  recipients: x.recipients.map(toRecipientDto),
});

export function documentsRoutes(d: DocumentsRouteDeps) {
  const ro = { readOnly: true } as const;
  /** Pages reached by an access link are never indexed, and the token never leaks through a referrer (Sam 11 §3). */
  const LINK_HEADERS = {
    'referrer-policy': 'no-referrer',
    'x-robots-tag': 'noindex, nofollow',
    'cache-control': 'no-store',
  };
  const facts = (input: { ip: string; userAgent: string | null; requestId: string }) => ({
    ip: input.ip,
    userAgent: input.userAgent,
    requestId: input.requestId,
  });
  const linkCookie = (input: { cookies: Readonly<Record<string, string | undefined>> }) =>
    input.cookies[ACCESS_LINK_COOKIE];

  /** Who is sending, for the "Sent by" line (Sam 11 §7: the email says what the record is and who it is from). */
  async function senderName(input: { tenant: TenantContext | null }) {
    const u = await d.identity.getUser(requireTenant(input).userId);
    return u ? `${u.name} (${u.email})` : 'a member of the team';
  }

  /**
   * Emails each link after the transaction commits, then records when it went out. A failed email leaves the
   * receipt at "not delivered" so the sender can resend; it never undoes the send.
   */
  async function deliver(
    input: { tenant: TenantContext | null },
    links: IssuedLink[],
    t: {
      orgName: string;
      projectName: string;
      sentBy: string;
      number: number;
      subject: string;
      message: string | null;
      itemCount: number | null;
    },
  ) {
    const delivered: string[] = [];
    for (const l of links) {
      const url = `${d.baseUrl}/t/${l.token}`;
      const lines = [
        `${t.orgName} sent you transmittal T-${String(t.number).padStart(4, '0')} for ${t.projectName}.`,
        `Sent by ${t.sentBy}.`,
        t.subject,
        ...(t.itemCount
          ? [`${t.itemCount} document${t.itemCount === 1 ? '' : 's'} attached.`]
          : []),
        ...(t.message ? ['', t.message] : []),
        '',
        `Open it: ${url}`,
        `This link is for ${l.email} and works until ${l.expiresAt.toISOString().slice(0, 10)}. You don't need an account.`,
      ];
      try {
        await d.messages.email(l.email, {
          subject: `${t.orgName}: transmittal T-${String(t.number).padStart(4, '0')} ${t.subject}`,
          text: lines.join('\n'),
        });
        delivered.push(l.recipientId);
      } catch (e) {
        d.logger?.warn({ err: e, recipientId: l.recipientId }, 'transmittal email failed');
      }
    }
    if (delivered.length) await tx(input, (s) => d.transmittals.markDelivered(s, delivered));
  }
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    d.database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    d.database.withTenantTx(requireTenant(input), fn, ro);

  return defineRoutes({
    listFolders: async (input) => {
      const rows = await read(input, (s) => d.folders.list(s, project(input.params)));
      return { status: 200, body: { data: rows.map(toFolderDto) } };
    },
    createFolder: async (input) => {
      const b = input.body;
      const row = await tx(input, (s) =>
        d.folders.create(s, project(input.params), {
          name: b.name,
          parentId: b.parentId ? ref('folder', b.parentId, 'parentId') : null,
          ...(b.isPrivate !== undefined ? { isPrivate: b.isPrivate } : {}),
          ...(b.allowedUserIds
            ? {
                allowedUserIds: b.allowedUserIds.map((u, i) =>
                  ref('user', u, `allowedUserIds/${i}`),
                ),
              }
            : {}),
          ...(b.allowedCompanyIds
            ? {
                allowedCompanyIds: b.allowedCompanyIds.map((u, i) =>
                  ref('company', u, `allowedCompanyIds/${i}`),
                ),
              }
            : {}),
        }),
      );
      return { status: 201, body: toFolderDto(row), headers: { etag: etag(row.version) } };
    },
    updateFolder: async (input) => {
      const b = input.body;
      const expected = parseIfMatch(input.headers['if-match']);
      const folderId = id('folder', input.params.folderId, 'folder.not_found');
      const row = await tx(input, (s) =>
        d.folders.update(s, project(input.params), folderId, expected, {
          ...(b.name !== undefined ? { name: b.name } : {}),
          ...(b.isPrivate !== undefined ? { isPrivate: b.isPrivate } : {}),
          ...(b.allowedUserIds
            ? {
                allowedUserIds: b.allowedUserIds.map((u, i) =>
                  ref('user', u, `allowedUserIds/${i}`),
                ),
              }
            : {}),
          ...(b.allowedCompanyIds
            ? {
                allowedCompanyIds: b.allowedCompanyIds.map((u, i) =>
                  ref('company', u, `allowedCompanyIds/${i}`),
                ),
              }
            : {}),
        }),
      );
      return { status: 200, body: toFolderDto(row), headers: { etag: etag(row.version) } };
    },

    listDocuments: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        d.documents.list(s, project(input.params), {
          ...(q.folderId ? { folderId: id('folder', q.folderId, 'folder.not_found') } : {}),
          ...(q.q ? { q: q.q } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toDocumentDto), nextCursor: page.nextCursor },
      };
    },
    createDocument: async (input) => {
      const b = input.body;
      const x = await tx(input, (s) =>
        d.documents.create(s, project(input.params), {
          ...b,
          folderId: ref('folder', b.folderId, 'folderId'),
          revision: { ...b.revision, fileId: ref('file', b.revision.fileId, 'revision.fileId') },
        }),
      );
      return {
        status: 201,
        body: toDocumentDetail(x),
        headers: { etag: etag(x.document.version) },
      };
    },
    getDocument: async (input) => {
      const documentId = id('document', input.params.documentId, 'document.not_found');
      const x = await read(input, (s) => d.documents.detail(s, project(input.params), documentId));
      return {
        status: 200,
        body: toDocumentDetail(x),
        headers: { etag: etag(x.document.version) },
      };
    },
    updateDocument: async (input) => {
      const documentId = id('document', input.params.documentId, 'document.not_found');
      const expected = parseIfMatch(input.headers['if-match']);
      const { folderId, ...rest } = input.body;
      const x = await tx(input, (s) =>
        d.documents.update(s, project(input.params), documentId, expected, {
          ...rest,
          ...(folderId ? { folderId: ref('folder', folderId, 'folderId') } : {}),
        }),
      );
      return {
        status: 200,
        body: toDocumentDetail(x),
        headers: { etag: etag(x.document.version) },
      };
    },
    addDocumentRevision: async (input) => {
      const documentId = id('document', input.params.documentId, 'document.not_found');
      const x = await tx(input, (s) =>
        d.documents.addRevision(s, project(input.params), documentId, {
          ...input.body,
          fileId: ref('file', input.body.fileId, 'fileId'),
        }),
      );
      return {
        status: 201,
        body: toDocumentDetail(x),
        headers: { etag: etag(x.document.version) },
      };
    },

    listDrawingSets: async (input) => {
      const page = await read(input, (s) =>
        d.drawings.listSets(s, project(input.params), {
          limit: input.query.limit,
          ...(input.query.cursor ? { cursor: input.query.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toDrawingSetDto), nextCursor: page.nextCursor },
      };
    },
    createDrawingSet: async (input) => {
      const row = await tx(input, (s) =>
        d.drawings.createSet(s, project(input.params), input.body),
      );
      return { status: 201, body: toDrawingSetDto(row) };
    },
    getDrawingSetReview: async (input) => {
      const setId = id('drawingSet', input.params.drawingSetId, 'drawing_set.not_found');
      const x = await read(input, (s) => d.drawings.review(s, project(input.params), setId));
      return { status: 200, body: toReview(x) };
    },
    addDrawingSetRevision: async (input) => {
      const setId = id('drawingSet', input.params.drawingSetId, 'drawing_set.not_found');
      const row = await tx(input, (s) =>
        d.drawings.addDraft(s, project(input.params), setId, {
          ...input.body,
          fileId: ref('file', input.body.fileId, 'fileId'),
          ...(input.body.aiSuggestionId
            ? { aiSuggestionId: ref('aiSuggestion', input.body.aiSuggestionId, 'aiSuggestionId') }
            : {}),
        }),
      );
      return { status: 201, body: toDrawingRevisionDto(row), headers: { etag: etag(row.version) } };
    },
    updateDraftDrawingRevision: async (input) => {
      const setId = id('drawingSet', input.params.drawingSetId, 'drawing_set.not_found');
      const revisionId = id(
        'drawingRevision',
        input.params.drawingRevisionId,
        'drawing_revision.not_found',
      );
      const expected = parseIfMatch(input.headers['if-match']);
      const row = await tx(input, (s) =>
        d.drawings.updateDraft(s, project(input.params), setId, revisionId, expected, input.body),
      );
      return { status: 200, body: toDrawingRevisionDto(row), headers: { etag: etag(row.version) } };
    },
    removeDraftDrawingRevision: async (input) => {
      const setId = id('drawingSet', input.params.drawingSetId, 'drawing_set.not_found');
      const revisionId = id(
        'drawingRevision',
        input.params.drawingRevisionId,
        'drawing_revision.not_found',
      );
      await tx(input, (s) => d.drawings.removeDraft(s, project(input.params), setId, revisionId));
      return { status: 204 };
    },
    publishDrawingSet: async (input) => {
      const setId = id('drawingSet', input.params.drawingSetId, 'drawing_set.not_found');
      const reasons = new Map(
        (input.body.reasons ?? []).map((r, i) => [
          ref('drawingRevision', r.revisionId, `reasons/${i}/revisionId`),
          r.reason,
        ]),
      );
      const x = await tx(input, (s) =>
        d.drawings.publish(s, project(input.params), setId, {
          confirmNewSheets: input.body.confirmNewSheets ?? false,
          reasons,
        }),
      );
      return { status: 200, body: toReview(x) };
    },
    listDrawings: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        d.drawings.listSheets(s, project(input.params), {
          ...(q.discipline ? { discipline: q.discipline } : {}),
          ...(q.issuedFor ? { issuedFor: q.issuedFor } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toDrawingSheetDto), nextCursor: page.nextCursor },
      };
    },
    listDrawingSheetRevisions: async (input) => {
      const sheetId = id('drawingSheet', input.params.drawingSheetId, 'drawing_sheet.not_found');
      const rows = await read(input, (s) =>
        d.drawings.sheetHistory(s, project(input.params), sheetId),
      );
      return { status: 200, body: { data: rows.map(toDrawingRevisionDto) } };
    },
    getDrawingRevision: async (input) => {
      const revisionId = id(
        'drawingRevision',
        input.params.drawingRevisionId,
        'drawing_revision.not_found',
      );
      const row = await read(input, (s) =>
        d.drawings.getRevision(s, project(input.params), revisionId),
      );
      return { status: 200, body: toDrawingRevisionDto(row) };
    },

    getSheetGeometry: async (input) => {
      const revisionId = id(
        'drawingRevision',
        input.params.drawingRevisionId,
        'drawing_revision.not_found',
      );
      const g = await read(input, (s) => d.geometry.get(s, project(input.params), revisionId));
      return {
        status: 200,
        body: toSheetGeometryDto(revisionId, g.row),
        headers: { etag: etag(g.row?.version ?? 0) },
      };
    },
    getDrawingTiles: async (input) => {
      const revisionId = id(
        'drawingRevision',
        input.params.drawingRevisionId,
        'drawing_revision.not_found',
      );
      const t = await read(input, (s) => d.tiles.get(s, project(input.params), revisionId));
      return {
        status: 200,
        body:
          t.status === 'pending'
            ? { status: 'pending' }
            : { ...t, expiresAt: t.expiresAt.toISOString() },
        // The signed template is per caller and short-lived; never cached by a shared cache.
        headers: { 'cache-control': 'private, no-store' },
      };
    },
    confirmSheetScale: async (input) => {
      const revisionId = id(
        'drawingRevision',
        input.params.drawingRevisionId,
        'drawing_revision.not_found',
      );
      const header = input.headers['if-match'];
      const expected = header ? parseIfMatch(header) : null;
      const row = await tx(input, (s) =>
        d.geometry.confirmScale(s, project(input.params), revisionId, input.body.scale, expected),
      );
      return {
        status: 200,
        body: toSheetGeometryDto(revisionId, row),
        headers: { etag: etag(row.version) },
      };
    },
    listMarkups: async (input) => {
      const revisionId = id(
        'drawingRevision',
        input.params.drawingRevisionId,
        'drawing_revision.not_found',
      );
      const rows = await read(input, (s) => d.markups.list(s, project(input.params), revisionId));
      return { status: 200, body: { data: rows.map(toMarkupDto) } };
    },
    createMarkup: async (input) => {
      const revisionId = id(
        'drawingRevision',
        input.params.drawingRevisionId,
        'drawing_revision.not_found',
      );
      const row = await tx(input, (s) =>
        d.markups.create(s, project(input.params), revisionId, {
          shapes: input.body.shapes as StoredShape[],
          ...(input.body.visibility ? { visibility: input.body.visibility } : {}),
        }),
      );
      return { status: 201, body: toMarkupDto(row), headers: { etag: etag(row.version) } };
    },
    updateMarkup: async (input) => {
      const revisionId = id(
        'drawingRevision',
        input.params.drawingRevisionId,
        'drawing_revision.not_found',
      );
      const markupId = id('markup', input.params.markupId, 'markup.not_found');
      const expected = parseIfMatch(input.headers['if-match']);
      const b = input.body;
      const row = await tx(input, (s) =>
        d.markups.update(s, project(input.params), revisionId, markupId, expected, {
          ...(b.visibility ? { visibility: b.visibility } : {}),
          ...(b.shapes ? { shapes: b.shapes as StoredShape[] } : {}),
          ...(b.locationConfirmed ? { locationConfirmed: true } : {}),
        }),
      );
      return { status: 200, body: toMarkupDto(row), headers: { etag: etag(row.version) } };
    },
    deleteMarkup: async (input) => {
      const revisionId = id(
        'drawingRevision',
        input.params.drawingRevisionId,
        'drawing_revision.not_found',
      );
      const markupId = id('markup', input.params.markupId, 'markup.not_found');
      const expected = parseIfMatch(input.headers['if-match']);
      await tx(input, (s) =>
        d.markups.remove(s, project(input.params), revisionId, markupId, expected),
      );
      return { status: 204 };
    },

    listTransmittals: async (input) => {
      const page = await read(input, (s) =>
        d.transmittals.list(s, project(input.params), {
          limit: input.query.limit,
          ...(input.query.cursor ? { cursor: input.query.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toTransmittalDto), nextCursor: page.nextCursor },
      };
    },
    createTransmittal: async (input) => {
      const b = input.body;
      // Identity lookups run before the tenant transaction (identity is the global layer).
      const recipients = await Promise.all(
        b.recipients.map(async (r, i) => ({
          email: r.email,
          ...(r.name ? { name: r.name } : {}),
          ...(r.role ? { role: r.role } : {}),
          ...(r.companyId
            ? { companyId: ref('company', r.companyId, `recipients/${i}/companyId`) }
            : {}),
          userId: (await d.identity.findUserByEmail(r.email))?.id ?? null,
        })),
      );
      const x = await tx(input, (s) =>
        d.transmittals.create(s, project(input.params), {
          subject: b.subject,
          purpose: b.purpose,
          ...(b.fromCompanyId
            ? { fromCompanyId: ref('company', b.fromCompanyId, 'fromCompanyId') }
            : {}),
          ...(b.responseDue ? { responseDue: b.responseDue } : {}),
          ...(b.message ? { message: b.message } : {}),
          recipients,
          items: (b.items ?? []).map((it, i) => ({
            revisionType: it.revisionType,
            revisionId: ref(
              it.revisionType === 'document' ? 'revision' : 'drawingRevision',
              it.revisionId,
              `items/${i}/revisionId`,
            ),
          })),
          currentSetDisciplines: b.currentSetDisciplines ?? [],
        }),
      );
      return {
        status: 201,
        body: toTransmittalDetail(x),
        headers: { etag: etag(x.transmittal.version) },
      };
    },
    getTransmittal: async (input) => {
      const transmittalId = id('transmittal', input.params.transmittalId, 'transmittal.not_found');
      const x = await read(input, (s) =>
        d.transmittals.detail(s, project(input.params), transmittalId),
      );
      return {
        status: 200,
        body: toTransmittalDetail(x),
        headers: { etag: etag(x.transmittal.version) },
      };
    },
    sendTransmittal: async (input) => {
      const transmittalId = id('transmittal', input.params.transmittalId, 'transmittal.not_found');
      const expected = parseIfMatch(input.headers['if-match']);
      const p = project(input.params);
      const sent = await tx(input, async (s) => ({
        x: await d.transmittals.send(s, p, transmittalId, expected),
        org: (await d.platform.getOrg(s)).name as string,
        projectName: (await d.platform.getProject(s, p)).name as string,
      }));
      await deliver(input, sent.x.links, {
        orgName: sent.org,
        projectName: sent.projectName,
        sentBy: await senderName(input),
        number: sent.x.transmittal.number!,
        subject: sent.x.transmittal.subject,
        message: sent.x.transmittal.message,
        itemCount: sent.x.items.length,
      });
      // Delivery times were written after the detail was read.
      const x = await read(input, (s) => d.transmittals.detail(s, p, transmittalId));
      return {
        status: 200,
        body: toTransmittalDetail(x),
        headers: { etag: etag(x.transmittal.version) },
      };
    },
    resendTransmittalLink: async (input) => {
      const transmittalId = id('transmittal', input.params.transmittalId, 'transmittal.not_found');
      const recipientId = id(
        'transmittalRecipient',
        input.params.recipientId,
        'transmittal.recipient_not_found',
      );
      const p = project(input.params);
      const r = await tx(input, async (s) => ({
        ...(await d.transmittals.resend(s, p, transmittalId, recipientId)),
        org: (await d.platform.getOrg(s)).name as string,
        projectName: (await d.platform.getProject(s, p)).name as string,
      }));
      await deliver(input, [r.link], {
        orgName: r.org,
        projectName: r.projectName,
        sentBy: await senderName(input),
        number: r.transmittal.number!,
        subject: r.transmittal.subject,
        message: r.transmittal.message,
        itemCount: null,
      });
      const x = await read(input, (s) => d.transmittals.detail(s, p, transmittalId));
      const row = x.recipients.find((q) => q.id === recipientId)!;
      return { status: 200, body: toRecipientDto(row) };
    },
    openTransmittalAccess: async (input) => {
      const r = await d.links.open(input.body.token, facts(input));
      return {
        status: 200,
        body: r.body,
        headers: LINK_HEADERS,
        setCookies: [
          {
            name: ACCESS_LINK_COOKIE,
            value: r.cookie,
            httpOnly: true,
            maxAgeSeconds: Math.floor(ACCESS_LINK_SESSION_MS / 1000),
          },
        ],
      };
    },
    getTransmittalAccess: async (input) => ({
      status: 200,
      body: await d.links.view(linkCookie(input), facts(input)),
      headers: LINK_HEADERS,
    }),
    acknowledgeTransmittalAccess: async (input) => ({
      status: 200,
      body: await d.links.acknowledge(linkCookie(input), facts(input)),
      headers: LINK_HEADERS,
    }),
    downloadTransmittalAccessItem: async (input) => ({
      status: 200,
      body: await d.links.download(
        linkCookie(input),
        {
          revisionType: input.body.revisionType,
          revisionId: ref(
            input.body.revisionType === 'document' ? 'revision' : 'drawingRevision',
            input.body.revisionId,
            'revisionId',
          ),
        },
        facts(input),
      ),
      headers: LINK_HEADERS,
    }),
    acknowledgeTransmittal: async (input) => {
      const transmittalId = id('transmittal', input.params.transmittalId, 'transmittal.not_found');
      const row = await tx(input, (s) =>
        d.transmittals.acknowledge(s, project(input.params), transmittalId, input.body.event),
      );
      return { status: 200, body: toRecipientDto(row) };
    },
  });
}

function toReview(x: Awaited<ReturnType<DrawingService['review']>>) {
  return {
    set: toDrawingSetDto(x.set),
    revisions: x.revisions.map(toDrawingRevisionDto),
    conflicts: x.conflicts.map((c) => ({
      ...c,
      revisionId: encodeId('drawingRevision', c.revisionId),
    })),
  };
}
