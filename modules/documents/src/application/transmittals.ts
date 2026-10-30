import { and, desc, eq, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import {
  AppError,
  ACCESS_LINK_DEFAULT_DAYS,
  createAccessLink,
  decodeCursor,
  nextNumber,
  revokeAccessLink,
  toPage,
  versionConflict,
  type TenantScope,
} from '@archova/kernel';
import {
  transmittalItems,
  transmittalRecipients,
  transmittals,
  type TransmittalPurpose,
} from '../infra/tables';
import type { DocumentsContext } from './context';
import type { DocumentService } from './documents';
import type { DrawingService } from './drawings';

type TransmittalRow = typeof transmittals.$inferSelect;

export interface RecipientInput {
  email: string;
  name?: string;
  companyId?: string;
  role?: 'to' | 'cc';
  /** Resolved by the caller from identity before the tenant transaction. */
  userId: string | null;
}

export interface CreateTransmittalInput {
  subject: string;
  purpose: TransmittalPurpose;
  fromCompanyId?: string;
  responseDue?: string;
  message?: string;
  recipients: RecipientInput[];
  items: Array<{ revisionType: 'document' | 'drawing'; revisionId: string }>;
  currentSetDisciplines?: string[];
}

/** What a link on a transmittal lets the holder do (Sam 11 §2). Fixed: a link never carries more. */
export const TRANSMITTAL_LINK_ENTITY = 'transmittal';
export const TRANSMITTAL_LINK_ACTIONS = ['view', 'download', 'acknowledge'] as const;
/** Sam 11 §2: a link allows 50 views by default. */
const TRANSMITTAL_LINK_MAX_USES = 50;
/** Sam 11 §6: links created per org per day, recipients per send, and replacement links per recipient per day. */
export const LINKS_PER_ORG_DAY = 2000;
export const LINK_RECIPIENTS_PER_SEND = 100;
export const RESENDS_PER_RECIPIENT_DAY = 3;

/** A new link for a recipient with no account; the token is shown once, in their email. */
export interface IssuedLink {
  recipientId: string;
  email: string;
  name: string | null;
  token: string;
  expiresAt: Date;
}

export interface TransmittalItemView {
  revisionType: 'document' | 'drawing';
  revisionId: string;
  title: string;
  number: string | null;
  rev: string;
  /** Internal: the file behind the revision. Never put in a response; downloads go through a signed URL. */
  fileId: string;
}

export function createTransmittalService(
  c: DocumentsContext,
  documents: DocumentService,
  drawings: DrawingService,
  clock: () => Date = () => new Date(),
) {
  const issuer = (scope: TenantScope, projectId: string) =>
    c.access.can(scope, 'documents.transmittals.manage', { projectId });

  /** Links created in the last day: for the org (RLS limits the count to it), or for one recipient on one transmittal. */
  async function linksInLastDay(
    scope: TenantScope,
    filter?: { transmittalId: string; email: string },
  ): Promise<number> {
    const since = new Date(clock().getTime() - 86_400_000).toISOString();
    const res = await scope.tx.execute<{ n: string }>(sql`
      select count(*) as n from shared.access_links
      where entity_type = ${TRANSMITTAL_LINK_ENTITY} and created_at > ${since}
      ${filter ? sql`and entity_id = ${filter.transmittalId} and recipient_email = ${filter.email}` : sql``}`);
    return Number(res.rows[0]!.n);
  }

  const tooMany = (message: string) => new AppError('access_link.rate_limited', message);

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: { limit: number; cursor?: string },
  ) {
    await c.requireProject(scope, projectId);
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const conditions: SQL[] = [
      eq(transmittals.projectId, projectId),
      isNull(transmittals.deletedAt),
    ];
    if (after) conditions.push(lt(transmittals.id, after.id));
    if (!(await issuer(scope, projectId))) {
      // Readers see sent transmittals addressed to them.
      conditions.push(eq(transmittals.status, 'sent'));
      conditions.push(
        sql`exists (select 1 from documents.transmittal_recipients r
                    where r.transmittal_id = ${transmittals.id} and r.user_id = ${scope.ctx.userId})`,
      );
    }
    const rows = await scope.tx
      .select()
      .from(transmittals)
      .where(and(...conditions))
      .orderBy(desc(transmittals.id))
      .limit(opts.limit + 1);
    return toPage(rows, opts.limit, (r) => ({ id: r.id }));
  }

  async function getRow(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(transmittals)
      .where(
        and(
          eq(transmittals.id, id),
          eq(transmittals.projectId, projectId),
          isNull(transmittals.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new AppError('transmittal.not_found');
    return row;
  }

  async function itemsOf(
    scope: TenantScope,
    projectId: string,
    transmittalId: string,
    opts: { authorised?: boolean } = {},
  ) {
    const items = await scope.tx
      .select()
      .from(transmittalItems)
      .where(eq(transmittalItems.transmittalId, transmittalId))
      .orderBy(transmittalItems.createdAt, transmittalItems.id);
    const docIds = items.filter((i) => i.revisionType === 'document').map((i) => i.revisionId);
    const drvIds = items.filter((i) => i.revisionType === 'drawing').map((i) => i.revisionId);
    // Item titles come from the revisions themselves, so a transmittal shows what was sent at the time.
    const docs = new Map(
      (await documents.revisionsByIds(scope, projectId, docIds, opts)).map((r) => [
        r.revision.id,
        r,
      ]),
    );
    const drvs = new Map(
      (await drawings.revisionsByIds(scope, projectId, drvIds)).map((r) => [r.id, r]),
    );
    const out: TransmittalItemView[] = [];
    for (const i of items) {
      if (i.revisionType === 'document') {
        const d = docs.get(i.revisionId);
        if (d)
          out.push({
            revisionType: 'document',
            revisionId: i.revisionId,
            title: d.document.title,
            number: d.document.docNumber,
            rev: d.revision.rev,
            fileId: d.revision.fileId,
          });
      } else {
        const d = drvs.get(i.revisionId);
        if (d)
          out.push({
            revisionType: 'drawing',
            revisionId: i.revisionId,
            title: d.title,
            number: d.sheetNumber,
            rev: d.rev,
            fileId: d.fileId,
          });
      }
    }
    return out;
  }

  async function detail(scope: TenantScope, projectId: string, id: string) {
    const transmittal = await getRow(scope, projectId, id);
    const recipients = await scope.tx
      .select()
      .from(transmittalRecipients)
      .where(eq(transmittalRecipients.transmittalId, id))
      .orderBy(transmittalRecipients.role, transmittalRecipients.email);
    if (!(await issuer(scope, projectId))) {
      const mine = recipients.some((r) => r.userId === scope.ctx.userId);
      if (!mine || transmittal.status !== 'sent') throw new AppError('transmittal.not_found');
    }
    return { transmittal, items: await itemsOf(scope, projectId, id), recipients };
  }

  async function create(scope: TenantScope, projectId: string, input: CreateTransmittalInput) {
    await c.requireProject(scope, projectId);
    const docIds = input.items
      .filter((i) => i.revisionType === 'document')
      .map((i) => i.revisionId);
    const drvIds = input.items.filter((i) => i.revisionType === 'drawing').map((i) => i.revisionId);
    const foundDocs = await documents.revisionsByIds(scope, projectId, docIds);
    const foundDrv = (await drawings.revisionsByIds(scope, projectId, drvIds)).filter(
      (r) => r.status !== 'draft',
    );
    const missing = [
      ...docIds.filter((x) => !foundDocs.some((d) => d.revision.id === x)),
      ...drvIds.filter((x) => !foundDrv.some((d) => d.id === x)),
    ];
    if (missing.length)
      throw new AppError('validation_failed', 'Some items are not revisions in this project.', [
        { path: 'items', message: `${missing.length} unknown revision(s)` },
      ]);
    const fromDisciplines = await drawings.currentForDisciplines(
      scope,
      projectId,
      input.currentSetDisciplines ?? [],
    );
    const items = new Map<string, { revisionType: 'document' | 'drawing'; revisionId: string }>();
    for (const i of input.items) items.set(`${i.revisionType}:${i.revisionId}`, i);
    for (const r of fromDisciplines)
      items.set(`drawing:${r.id}`, { revisionType: 'drawing', revisionId: r.id });

    const id = uuidv7();
    const userId = scope.ctx.userId;
    await scope.tx.insert(transmittals).values({
      id,
      orgId: scope.ctx.orgId,
      projectId,
      subject: input.subject.trim(),
      purpose: input.purpose,
      fromCompanyId: input.fromCompanyId ?? null,
      responseDue: input.responseDue ?? null,
      message: input.message ?? null,
      status: 'draft',
      createdBy: userId,
      updatedBy: userId,
    });
    if (items.size)
      await scope.tx.insert(transmittalItems).values(
        [...items.values()].map((i) => ({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          transmittalId: id,
          revisionType: i.revisionType,
          revisionId: i.revisionId,
        })),
      );
    const byEmail = new Map<string, RecipientInput>();
    for (const r of input.recipients) byEmail.set(r.email.trim().toLowerCase(), r);
    await scope.tx.insert(transmittalRecipients).values(
      [...byEmail.entries()].map(([email, r]) => ({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        transmittalId: id,
        userId: r.userId,
        companyId: r.companyId ?? null,
        email,
        name: r.name ?? null,
        role: r.role ?? 'to',
      })),
    );
    return detail(scope, projectId, id);
  }

  /**
   * Numbers and sends the transmittal. The row is then frozen by a trigger (DOC-AC10). The event drives the
   * cover-sheet PDF, the evidence record, emails and, for recipients without an account, access links (X45).
   */
  async function send(scope: TenantScope, projectId: string, id: string, expectedVersion: number) {
    const current = await getRow(scope, projectId, id);
    if (current.status === 'sent')
      throw new AppError('transmittal.already_sent', 'This transmittal has already been sent.');
    if (current.version !== expectedVersion) throw versionConflict();
    const items = await itemsOf(scope, projectId, id);
    if (!items.length)
      throw new AppError('transmittal.empty', 'Add at least one document or drawing.');
    const pending = await scope.tx
      .select({ userId: transmittalRecipients.userId })
      .from(transmittalRecipients)
      .where(eq(transmittalRecipients.transmittalId, id));
    const linkCount = pending.filter((r) => !r.userId).length;
    if (linkCount > LINK_RECIPIENTS_PER_SEND)
      throw new AppError('validation_failed', 'Too many recipients without an account.', [
        {
          path: 'recipients',
          message: `At most ${LINK_RECIPIENTS_PER_SEND} people without an account per transmittal`,
        },
      ]);
    if (linkCount && (await linksInLastDay(scope)) + linkCount > LINKS_PER_ORG_DAY)
      throw tooMany(
        'Your organisation has sent as many links as it can today. Try again tomorrow.',
      );
    const number = await nextNumber(scope, projectId, 'transmittal');
    const now = clock();
    const [row] = await scope.tx
      .update(transmittals)
      .set({
        status: 'sent',
        number,
        sentAt: now,
        sentBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
        version: current.version + 1,
      })
      .where(and(eq(transmittals.id, id), eq(transmittals.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    const recipients = await scope.tx
      .select()
      .from(transmittalRecipients)
      .where(eq(transmittalRecipients.transmittalId, id));
    // People with an account see it in the app straight away. Everyone else gets a personal link (X45).
    const links: IssuedLink[] = [];
    const expiresAt = new Date(now.getTime() + ACCESS_LINK_DEFAULT_DAYS * 86_400_000);
    for (const r of recipients) {
      if (r.userId) continue;
      const { link, token } = await createAccessLink(scope, {
        projectId,
        entityType: TRANSMITTAL_LINK_ENTITY,
        entityId: id,
        allowedActions: TRANSMITTAL_LINK_ACTIONS,
        label: `Transmittal ${number}`,
        recipientEmail: r.email,
        expiresAt,
        maxUses: TRANSMITTAL_LINK_MAX_USES,
      });
      await scope.tx
        .update(transmittalRecipients)
        .set({ accessLinkId: link.id })
        .where(eq(transmittalRecipients.id, r.id));
      links.push({ recipientId: r.id, email: r.email, name: r.name, token, expiresAt });
    }
    await scope.tx
      .update(transmittalRecipients)
      .set({ deliveredAt: now })
      .where(
        and(
          eq(transmittalRecipients.transmittalId, id),
          sql`${transmittalRecipients.userId} is not null`,
        ),
      );
    await changed(scope, row);
    scope.events.add({
      type: 'documents.transmittal.sent.v1',
      projectId,
      entityType: 'transmittal',
      entityId: id,
      entityVersion: row.version,
      data: {
        transmittalId: id,
        number,
        purpose: row.purpose,
        items: items.map((i) => ({ revisionType: i.revisionType, revisionId: i.revisionId })),
        recipientIds: recipients.map((r) => r.id),
      },
    });
    return { ...(await detail(scope, projectId, id)), links };
  }

  /** The email went out; the receipt shows "sent" (DOC-AC11). */
  async function markDelivered(scope: TenantScope, recipientIds: string[]) {
    if (!recipientIds.length) return;
    await scope.tx
      .update(transmittalRecipients)
      .set({ deliveredAt: clock() })
      .where(
        and(
          inArray(transmittalRecipients.id, recipientIds),
          isNull(transmittalRecipients.deliveredAt),
        ),
      );
  }

  /**
   * Replaces a recipient's link after a lost email: the old one stops, a new one is issued. Only for recipients
   * without an account, on a sent transmittal.
   */
  async function resend(scope: TenantScope, projectId: string, id: string, recipientId: string) {
    const t = await getRow(scope, projectId, id);
    if (t.status !== 'sent')
      throw new AppError('transmittal.not_sent', 'Send the transmittal first.');
    const [r] = await scope.tx
      .select()
      .from(transmittalRecipients)
      .where(
        and(eq(transmittalRecipients.id, recipientId), eq(transmittalRecipients.transmittalId, id)),
      )
      .limit(1);
    if (!r) throw new AppError('transmittal.recipient_not_found');
    if (r.userId)
      throw new AppError(
        'transmittal.has_account',
        'This person opens it from their Archova account.',
      );
    if (
      (await linksInLastDay(scope, { transmittalId: id, email: r.email })) >
      RESENDS_PER_RECIPIENT_DAY
    )
      throw tooMany('That link has been resent enough times today. Try again tomorrow.');
    if ((await linksInLastDay(scope)) >= LINKS_PER_ORG_DAY)
      throw tooMany(
        'Your organisation has sent as many links as it can today. Try again tomorrow.',
      );
    if (r.accessLinkId) await revokeAccessLink(scope, r.accessLinkId);
    const expiresAt = new Date(clock().getTime() + ACCESS_LINK_DEFAULT_DAYS * 86_400_000);
    const { link, token } = await createAccessLink(scope, {
      projectId,
      entityType: TRANSMITTAL_LINK_ENTITY,
      entityId: id,
      allowedActions: TRANSMITTAL_LINK_ACTIONS,
      label: `Transmittal ${t.number}`,
      recipientEmail: r.email,
      expiresAt,
      maxUses: TRANSMITTAL_LINK_MAX_USES,
    });
    await scope.tx
      .update(transmittalRecipients)
      .set({ accessLinkId: link.id, deliveredAt: null })
      .where(eq(transmittalRecipients.id, r.id));
    return {
      transmittal: t,
      link: { recipientId: r.id, email: r.email, name: r.name, token, expiresAt },
    };
  }

  /** A recipient's receipt (DOC-AC11). Each timestamp is set once; repeats return the existing receipt. */
  async function acknowledge(
    scope: TenantScope,
    projectId: string,
    id: string,
    event: 'opened' | 'downloaded' | 'acknowledged',
  ) {
    const t = await getRow(scope, projectId, id);
    if (t.status !== 'sent') throw new AppError('transmittal.not_found');
    const [mine] = await scope.tx
      .select()
      .from(transmittalRecipients)
      .where(
        and(
          eq(transmittalRecipients.transmittalId, id),
          eq(transmittalRecipients.userId, scope.ctx.userId),
        ),
      )
      .limit(1);
    if (!mine)
      throw new AppError(
        'transmittal.not_recipient',
        'Only recipients can acknowledge a transmittal.',
      );
    const column = {
      opened: transmittalRecipients.openedAt,
      downloaded: transmittalRecipients.downloadedAt,
      acknowledged: transmittalRecipients.acknowledgedAt,
    }[event];
    const field = {
      opened: 'openedAt',
      downloaded: 'downloadedAt',
      acknowledged: 'acknowledgedAt',
    }[event] as 'openedAt' | 'downloadedAt' | 'acknowledgedAt';
    if (mine[field]) return mine;
    const now = new Date();
    const values: Partial<typeof transmittalRecipients.$inferInsert> = { [field]: now };
    // Acknowledging or downloading implies the recipient opened it.
    if (event !== 'opened' && !mine.openedAt) values.openedAt = now;
    const [row] = await scope.tx
      .update(transmittalRecipients)
      .set(values)
      .where(and(eq(transmittalRecipients.id, mine.id), isNull(column)))
      .returning();
    scope.events.add({
      type: `documents.transmittal.${event}.v1`,
      projectId,
      entityType: 'transmittal',
      entityId: id,
      data: { transmittalId: id, recipientId: mine.id },
    });
    return row ?? mine;
  }

  return { list, detail, create, send, resend, markDelivered, acknowledge, getRow, itemsOf };
}

async function changed(scope: TenantScope, t: TransmittalRow) {
  await scope.recordChange({
    module: 'documents',
    entityType: 'transmittal',
    entityId: t.id,
    op: 'upsert',
    version: t.version,
    projectId: t.projectId,
  });
}

export type TransmittalService = ReturnType<typeof createTransmittalService>;
