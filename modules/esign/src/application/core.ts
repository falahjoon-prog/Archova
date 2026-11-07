// Shared pieces of the sender's side and the signer's side: loading an envelope, issuing links, recording the audit
// trail and finishing an envelope. Everything that has to be emailed is returned as `Outbound` for the caller to send
// after the transaction commits, so a mail failure never undoes a signature.
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { encodeId, uuidv7 } from '@archova/domain';
import {
  AppError,
  createAccessLink,
  revokeAccessLink,
  type Database,
  type Entitlements,
  type Logger,
  type RedisClient,
  type TenantScope,
} from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { FilesApi } from '@archova/mod-files';
import type { PlatformApi } from '@archova/mod-platform';
import {
  isComplete,
  oneLine,
  toNotify,
  type RecipientRole,
  type RecipientState,
} from '../domain/envelope';
import { renderSignedPdf, type PlacedField, type SignerRecord } from '../domain/pdf';
import { documents, envelopes, events, fields, recipients } from '../infra/tables';

export type EnvelopeRow = typeof envelopes.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type RecipientRow = typeof recipients.$inferSelect;
export type FieldRow = typeof fields.$inferSelect;
export type EventRow = typeof events.$inferSelect;

export interface Loaded {
  env: EnvelopeRow;
  docs: DocumentRow[];
  recips: RecipientRow[];
  fields: FieldRow[];
  events: EventRow[];
}

export interface Outbound {
  to: string;
  subject: string;
  text: string;
}

export interface RequestFacts {
  ip: string;
  userAgent: string | null;
  requestId: string;
}

export interface EsignDeps {
  database: Database;
  access: Pick<AccessService, 'can'>;
  platform: Pick<PlatformApi, 'getProject' | 'getOrg' | 'resolveTenantAccess'>;
  files: Pick<FilesApi, 'getFile' | 'readFileBytes'>;
  entitlements: (orgId: string) => Promise<Entitlements>;
  /** The public web origin the signing links point at, e.g. `https://app.archova.com.au`. */
  baseUrl: string;
  /** "Name (email)" of a member, for the "Sent by" line. */
  senderName(userId: string): Promise<string>;
  redis?: RedisClient | null;
  logger?: Pick<Logger, 'warn' | 'error'>;
  now?: () => Date;
}

export const ESIGN_ENTITY = 'esign_envelope';
/** Its own cookie so opening a signing link never replaces a tender or induction session in the same browser. */
export const ESIGN_COOKIE = '__Host-esk';
export const MAX_PDF_BYTES = 25 * 1024 * 1024;
const LINKS_PER_ORG_DAY = 500;
export const REMIND_GAP_MS = 60 * 60 * 1000;

export const NIL_USER = '00000000-0000-0000-0000-000000000000';

export const notFound = () => new AppError('esign.not_found');

export const stateOf = (r: RecipientRow): RecipientState => ({
  id: r.id,
  email: r.email,
  role: r.role,
  routingOrder: r.routingOrder,
  status: r.status,
});

export function createEsignCore(deps: EsignDeps) {
  const now = deps.now ?? (() => new Date());

  async function load(scope: TenantScope, envelopeId: string, projectId?: string): Promise<Loaded> {
    const [env] = await scope.tx
      .select()
      .from(envelopes)
      .where(eq(envelopes.id, envelopeId))
      .limit(1);
    if (!env || env.deletedAt || (projectId && env.projectId !== projectId)) throw notFound();
    const [docs, recips, flds, evs] = await Promise.all([
      scope.tx
        .select()
        .from(documents)
        .where(eq(documents.envelopeId, envelopeId))
        .orderBy(asc(documents.position), asc(documents.id)),
      scope.tx
        .select()
        .from(recipients)
        .where(eq(recipients.envelopeId, envelopeId))
        .orderBy(asc(recipients.routingOrder), asc(recipients.id)),
      scope.tx.select().from(fields).where(eq(fields.envelopeId, envelopeId)),
      scope.tx
        .select()
        .from(events)
        .where(eq(events.envelopeId, envelopeId))
        .orderBy(asc(events.at), asc(events.id)),
    ]);
    return { env, docs, recips, fields: flds, events: evs };
  }

  async function record(
    scope: TenantScope,
    envelopeId: string,
    type: string,
    o: {
      recipientId?: string | null;
      facts?: RequestFacts | null;
      actorUserId?: string | null;
      data?: Record<string, unknown>;
    } = {},
  ) {
    await scope.tx.insert(events).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      envelopeId,
      recipientId: o.recipientId ?? null,
      type,
      at: now(),
      ip: o.facts?.ip ?? null,
      userAgent: o.facts?.userAgent?.slice(0, 500) ?? null,
      actorUserId: o.actorUserId ?? null,
      data: o.data ?? {},
    });
  }

  /** Caps signing emails per org per day so the endpoints can't be used to send mail in bulk. */
  async function assertOrgCap(scope: TenantScope, adding: number) {
    const dayAgo = new Date(now().getTime() - 86_400_000).toISOString();
    const res = await scope.tx.execute<{ n: string }>(sql`
      select count(*) as n from shared.access_links
      where entity_type = ${ESIGN_ENTITY} and created_at > ${dayAgo}`);
    if (Number(res.rows[0]?.n ?? 0) + adding > LINKS_PER_ORG_DAY)
      throw new AppError(
        'esign.rate_limited',
        'Your organisation has sent as many signing requests as it can today. Try again tomorrow.',
      );
  }

  async function names(scope: TenantScope, env: EnvelopeRow) {
    const [org, project, sentBy] = await Promise.all([
      deps.platform.getOrg(scope),
      deps.platform.getProject(scope, env.projectId),
      env.sentBy ? deps.senderName(env.sentBy) : Promise.resolve(''),
    ]);
    const p = project as { name: string; timezone?: string };
    return {
      org: oneLine(org.name as string),
      project: oneLine(p.name),
      timezone: p.timezone ?? 'Australia/Sydney',
      sentBy: oneLine(sentBy),
    };
  }

  const verb = (role: RecipientRole) =>
    role === 'needs_to_sign' ? 'to review and sign' : 'to review';

  /**
   * Gives each recipient a fresh link (the previous one stops working) and returns the emails to send. `kind`
   * picks the wording. The scope's user is the envelope's sender, so the links die with the sender's access.
   */
  async function issueLinks(
    scope: TenantScope,
    l: Loaded,
    which: readonly RecipientRow[],
    kind: 'invite' | 'reminder' | 'completed',
    actor?: string | null,
  ): Promise<Outbound[]> {
    if (!which.length || !l.env.expiresAt) return [];
    // Who gets named in the audit trail: the caller by default, nobody when a signer's action triggered it.
    const by =
      actor === undefined ? (scope.ctx.userId === NIL_USER ? null : scope.ctx.userId) : actor;
    await assertOrgCap(scope, which.length);
    const n = await names(scope, l.env);
    const t = now();
    const expiresAt =
      kind === 'completed'
        ? new Date(Math.max(l.env.expiresAt.getTime(), t.getTime() + 30 * 86_400_000))
        : l.env.expiresAt;
    const out: Outbound[] = [];
    for (const r of which) {
      const previous = kind === 'completed' ? r.copyLinkId : r.accessLinkId;
      if (previous) await revokeAccessLink(scope, previous);
      const actions =
        kind === 'completed'
          ? ['view']
          : [
              'view',
              'sign',
              'decline',
              ...(l.env.allowDelegate && !r.delegatedFrom ? ['delegate'] : []),
            ];
      const { link, token } = await createAccessLink(scope, {
        projectId: l.env.projectId,
        entityType: ESIGN_ENTITY,
        entityId: l.env.id,
        allowedActions: actions,
        label: oneLine(l.env.subject).slice(0, 100) || 'Signing request',
        recipientEmail: r.email,
        expiresAt,
        maxUses: 200,
      });
      await scope.tx
        .update(recipients)
        .set(
          kind === 'completed'
            ? { copyLinkId: link.id }
            : {
                accessLinkId: link.id,
                ...(r.status === 'pending' ? { status: 'sent' as const } : {}),
                sentAt: t,
              },
        )
        .where(eq(recipients.id, r.id));
      await record(
        scope,
        l.env.id,
        kind === 'completed' ? 'copy_sent' : kind === 'reminder' ? 'reminded' : 'sent',
        {
          recipientId: r.id,
          actorUserId: by,
        },
      );
      const subject = oneLine(
        kind === 'completed' ? `Completed: ${l.env.subject}` : (r.customSubject ?? l.env.subject),
      );
      const body = kind === 'completed' ? '' : (r.customMessage ?? l.env.message).trim();
      const lines =
        kind === 'completed'
          ? [
              `Everyone has signed "${oneLine(l.env.subject)}" (${n.project}).`,
              `Open the link to download the signed copy: ${deps.baseUrl}/sign/${token}`,
            ]
          : [
              `${n.org} sent you documents ${verb(r.role)} for ${n.project}.`,
              ...(n.sentBy ? [`Sent by ${n.sentBy}.`] : []),
              ...(body ? ['', body] : []),
              '',
              `${r.role === 'needs_to_sign' ? 'Review and sign' : 'Review'}: ${deps.baseUrl}/sign/${token}`,
            ];
      lines.push(
        `This link is for ${r.email} and works until ${expiresAt.toISOString().slice(0, 10)}. You don't need an account.`,
      );
      out.push({ to: r.email, subject, text: lines.join('\n') });
    }
    return out;
  }

  /** Revokes every live link on an envelope (void, decline, expiry). */
  async function revokeAll(scope: TenantScope, recips: readonly RecipientRow[]) {
    for (const r of recips)
      for (const id of [r.accessLinkId, r.copyLinkId]) if (id) await revokeAccessLink(scope, id);
  }

  /** Renders the signed PDF for one document from the original bytes and what each signer did. */
  async function renderDocument(scope: TenantScope, l: Loaded, doc: DocumentRow, timezone: string) {
    const { bytes } = await deps.files.readFileBytes(scope, doc.fileId, MAX_PDF_BYTES, {
      authorised: true,
    });
    const signers: SignerRecord[] = l.recips
      .filter((r) => r.status !== 'delegated')
      .map((r) => ({
        name: r.name,
        email: r.email,
        role: r.role,
        status: r.status,
        signedOnPaper: r.signedOnPaper,
        signatureKind: r.signatureKind,
        signatureValue: r.signatureValue,
        completedAt: r.completedAt,
        ip: r.signerIp,
        declineReason: r.declineReason,
      }));
    const byId = new Map(l.recips.map((r) => [r.id, r]));
    const placed: PlacedField[] = l.fields
      .filter((f) => f.documentId === doc.id)
      .flatMap((f) => {
        const r = byId.get(f.recipientId);
        // A delegated signer's fields move to whoever took over.
        const owner =
          r?.status === 'delegated' ? l.recips.find((x) => x.delegatedFrom === r.id) : r;
        return owner
          ? [
              {
                recipientEmail: owner.email,
                kind: f.kind,
                page: f.page,
                x: f.x,
                y: f.y,
                w: f.w,
                h: f.h,
              },
            ]
          : [];
      });
    return renderSignedPdf({
      source: bytes,
      documentName: doc.name,
      sourceSha256: doc.sha256 ?? '',
      envelope: {
        id: encodeId('envelope', l.env.id),
        subject: l.env.subject,
        sentAt: l.env.sentAt,
        completedAt: l.env.completedAt ?? now(),
      },
      signers,
      fields: placed,
      timezone,
    });
  }

  /**
   * After a signature (or a paper confirmation): finishes the envelope when everyone is done, otherwise emails the
   * next group in the signing order. Returns the emails for the caller to send.
   */
  async function advance(
    scope: TenantScope,
    envelopeId: string,
    actor?: string | null,
  ): Promise<Outbound[]> {
    const l = await load(scope, envelopeId);
    if (l.env.status !== 'sent') return [];
    const states = l.recips.map(stateOf);
    if (isComplete(states)) {
      const t = now();
      const finished: Loaded = { ...l, env: { ...l.env, completedAt: t, status: 'completed' } };
      const n = await names(scope, l.env);
      for (const d of l.docs) {
        const pdf = await renderDocument(scope, finished, d, n.timezone);
        await scope.tx
          .update(documents)
          .set({ signedSha256: createHash('sha256').update(pdf).digest('hex') })
          .where(eq(documents.id, d.id));
      }
      await scope.tx
        .update(envelopes)
        .set({ status: 'completed', completedAt: t, version: l.env.version + 1, updatedAt: t })
        .where(eq(envelopes.id, envelopeId));
      await record(scope, envelopeId, 'completed');
      scope.events.add({
        type: 'esign.envelope.completed.v1',
        projectId: l.env.projectId,
        entityType: 'esign_envelope',
        entityId: envelopeId,
        data: { envelopeId, sourceType: l.env.sourceType, sourceId: l.env.sourceId },
      });
      const done = (await load(scope, envelopeId)).recips.filter((r) => r.status !== 'delegated');
      return issueLinks(scope, { ...finished, recips: done }, done, 'completed', actor);
    }
    const next = toNotify(states, l.env.signingOrder);
    const rows = l.recips.filter((r) => next.some((x) => x.id === r.id));
    return issueLinks(scope, l, rows, 'invite', actor);
  }

  /** Marks envelopes past their expiry as expired and kills their links. Idempotent; run before reads. */
  async function expireIfDue(scope: TenantScope, l: Loaded): Promise<Loaded> {
    if (l.env.status !== 'sent' || !l.env.expiresAt || l.env.expiresAt > now()) return l;
    await scope.tx
      .update(envelopes)
      .set({ status: 'expired', version: l.env.version + 1, updatedAt: now() })
      .where(and(eq(envelopes.id, l.env.id), eq(envelopes.status, 'sent')));
    await record(scope, l.env.id, 'expired');
    await revokeAll(scope, l.recips);
    return { ...l, env: { ...l.env, status: 'expired' } };
  }

  async function recentlyMailed(scope: TenantScope, recipientIds: readonly string[]) {
    if (!recipientIds.length) return new Set<string>();
    const since = new Date(now().getTime() - REMIND_GAP_MS);
    const rows = await scope.tx
      .select({ id: events.recipientId })
      .from(events)
      .where(
        and(
          inArray(events.recipientId, [...recipientIds]),
          inArray(events.type, ['sent', 'reminded']),
          gt(events.at, since),
        ),
      )
      .orderBy(desc(events.at));
    return new Set(rows.map((r) => r.id!));
  }

  return {
    load,
    record,
    issueLinks,
    revokeAll,
    renderDocument,
    advance,
    expireIfDue,
    recentlyMailed,
    names,
    now,
  };
}

export type EsignCore = ReturnType<typeof createEsignCore>;
