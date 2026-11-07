// The signer's side. A recipient opens the link from their email (no account), reads the documents, then signs,
// declines or hands signing to someone else. The link and its browser session are checked on every request: not
// expired, not revoked, the envelope still out for signature, and the sender must still be allowed to send.
import { and, eq } from 'drizzle-orm';
import { encodeId, uuidv7 } from '@archova/domain';
import {
  AppError,
  accessLinkState,
  accessTokenOrg,
  countAccessLinkUse,
  findAccessLink,
  findAccessLinkSession,
  openAccessLinkSession,
  type AccessLink,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import { checkSignature, isEmail, isTurn, oneLine } from '../domain/envelope';
import { envelopes, recipients } from '../infra/tables';
import {
  ESIGN_ENTITY,
  NIL_USER,
  createEsignCore,
  stateOf,
  type EsignDeps,
  type Loaded,
  type Outbound,
  type RecipientRow,
  type RequestFacts,
} from './core';
import type { EnvelopeService } from './envelopes';

const invalid = () =>
  new AppError('access_link.invalid', 'This link no longer works. Ask the sender for a new one.');
const sessionRequired = () =>
  new AppError('access_link.session_required', 'Open your link again to continue.');

export function createSigningService(deps: EsignDeps, envelopesSvc: EnvelopeService) {
  const core = createEsignCore(deps);
  const now = core.now;
  const { database } = deps;

  // ------------------------------------------------------------------------------- rate limiting

  const local = new Map<string, { n: number; until: number }>();
  async function bump(key: string, windowS: number, max: number, weight: number) {
    let n: number;
    if (deps.redis) {
      n = await deps.redis.incrby(key, weight);
      if (n === weight) await deps.redis.expire(key, windowS);
    } else {
      const t = now().getTime();
      const cur = local.get(key);
      const live = cur && cur.until > t ? cur : { n: 0, until: t + windowS * 1000 };
      live.n += weight;
      local.set(key, live);
      n = live.n;
      if (local.size > 5000) for (const [k, v] of local) if (v.until <= t) local.delete(k);
    }
    if (n > max) throw new AppError('access_link.rate_limited', 'Too many tries. Wait a minute.');
  }
  /** Token lookups per IP: 30 a minute and 300 an hour; unknown tokens count double. */
  async function limit(ip: string, weight: number) {
    await bump(`g:esrl:m:${ip}`, 60, 30, weight);
    await bump(`g:esrl:h:${ip}`, 3600, 300, weight);
  }

  // ------------------------------------------------------------------------------------ contexts

  async function baseContext(orgId: string, facts: RequestFacts): Promise<TenantContext> {
    return {
      orgId,
      userId: NIL_USER,
      principalType: 'external',
      orgRole: null,
      entitlements: await deps.entitlements(orgId),
      requestId: facts.requestId,
    };
  }
  const guestContext = (base: TenantContext, link: AccessLink): TenantContext => ({
    ...base,
    userId: link.id,
    actor: { type: 'link', linkId: link.id, subjectType: null, subjectId: null },
  });

  /** The same transaction acting as the envelope's sender, for creating links that belong to them. */
  const asSender = (scope: TenantScope, sentBy: string | null): TenantScope => ({
    ...scope,
    ctx: { ...scope.ctx, userId: sentBy ?? scope.ctx.userId, actor: undefined },
  });

  /** A link dies with its creator's access: they must still be allowed to send envelopes on the project. */
  async function creatorStillAllowed(scope: TenantScope, link: AccessLink) {
    const access = await deps.platform.resolveTenantAccess(
      scope.ctx.orgId,
      link.createdBy,
      scope.ctx.requestId,
    );
    if (!access || !link.projectId) return false;
    const asCreator: TenantScope = {
      ...scope,
      ctx: {
        ...scope.ctx,
        userId: link.createdBy,
        principalType: 'member',
        orgRole: access.orgRole,
        actor: undefined,
      },
    };
    return deps.access.can(asCreator, 'esign.envelopes.send', { projectId: link.projectId });
  }

  async function usable(scope: TenantScope, link: AccessLink, opening = false) {
    if (link.entityType !== ESIGN_ENTITY || !link.projectId) throw invalid();
    const state = accessLinkState(link, now());
    if (state === 'revoked' || state === 'expired' || (state === 'used_up' && opening))
      throw invalid();
    if (!(await creatorStillAllowed(scope, link))) throw invalid();
    if (scope.ctx.entitlements.state === 'cancelled') throw invalid();
  }

  // ------------------------------------------------------------------------------------- views

  async function recipientOf(scope: TenantScope, link: AccessLink, l: Loaded) {
    const me = l.recips.find((r) => r.accessLinkId === link.id || r.copyLinkId === link.id);
    if (!me) throw invalid();
    return me;
  }

  /** What this recipient sees: the message, the documents, their own placed fields, and everyone's progress. */
  async function accessView(scope: TenantScope, link: AccessLink, recipientId?: string) {
    let l = await core.load(scope, link.entityId, link.projectId!);
    l = await core.expireIfDue(scope, l);
    const me = recipientId
      ? (l.recips.find((r) => r.id === recipientId) ?? (await recipientOf(scope, link, l)))
      : await recipientOf(scope, link, l);
    const n = await core.names(scope, l.env);
    const states = l.recips.map(stateOf);
    const live = l.env.status === 'sent';
    const canAct =
      live &&
      me.role === 'needs_to_sign' &&
      (me.status === 'sent' || me.status === 'viewed') &&
      isTurn(states, l.env.signingOrder, me.id);
    return {
      envelope: {
        subject: l.env.subject,
        message: me.customMessage ?? l.env.message,
        fromOrg: n.org,
        projectName: n.project,
        sentByName: n.sentBy.replace(/\s*\(.*\)$/, ''),
        status: l.env.status,
        expiresAt: l.env.expiresAt?.toISOString() ?? null,
        completedAt: l.env.completedAt?.toISOString() ?? null,
      },
      me: {
        recipientId: encodeId('envelopeRecipient', me.id),
        name: me.name,
        email: me.email,
        role: me.role,
        status: me.status,
        canAct,
        waiting:
          live &&
          me.role === 'needs_to_sign' &&
          me.status !== 'signed' &&
          !isTurn(states, l.env.signingOrder, me.id),
        allowPaper: l.env.allowPaper,
        allowDelegate: live && l.env.allowDelegate && !me.delegatedFrom && canAct,
      },
      // Signed copies are only offered once everyone has signed; before that the originals.
      documents: l.docs.map((d) => ({ id: encodeId('envelopeDocument', d.id), name: d.name })),
      fields: l.fields
        .filter((f) => f.recipientId === me.id)
        .map((f) => ({
          id: encodeId('envelopeField', f.id),
          documentId: encodeId('envelopeDocument', f.documentId),
          recipientId: encodeId('envelopeRecipient', f.recipientId),
          kind: f.kind,
          page: f.page,
          x: f.x,
          y: f.y,
          w: f.w,
          h: f.h,
        })),
      signers: l.recips
        .filter((r) => r.status !== 'delegated' && r.role !== 'receives_copy')
        .map((r) => ({
          name: r.name,
          role: r.role,
          status: r.status,
          routingOrder: r.routingOrder,
        })),
      expiresAt: link.expiresAt.toISOString(),
    };
  }

  // -------------------------------------------------------------------------------- entry points

  async function open(token: string, facts: RequestFacts) {
    const orgId = accessTokenOrg(token, 'arl');
    await limit(facts.ip, orgId ? 1 : 2);
    if (!orgId) throw invalid();
    const base = await baseContext(orgId, facts);
    const opened = await database.withTenantTx(base, async (scope) => {
      const link = await findAccessLink(scope, token);
      if (!link) return null;
      await usable(scope, link, true);
      await countAccessLinkUse(scope, link.id);
      const { token: cookie } = await openAccessLinkSession(scope, link, {
        ip: facts.ip,
        userAgent: facts.userAgent,
        now: now(),
      });
      const l = await core.load(scope, link.entityId, link.projectId!);
      const me = await recipientOf(scope, link, l);
      if (!me.viewedAt) {
        const t = now();
        await scope.tx
          .update(recipients)
          .set({
            viewedAt: t,
            ...(me.status === 'sent' ? { status: 'viewed' as const } : {}),
            // Someone who only needs to view is done once they have opened it.
            ...(me.role === 'needs_to_view' ? { completedAt: t } : {}),
          })
          .where(eq(recipients.id, me.id));
        await core.record(scope, l.env.id, 'viewed', { recipientId: me.id, facts });
      }
      let mail: Outbound[] = [];
      if (me.role === 'needs_to_view' && !me.viewedAt && l.env.status === 'sent') {
        mail = await core.advance(asSender(scope, l.env.sentBy), l.env.id, null);
      }
      const guest: TenantScope = { ...scope, ctx: guestContext(base, link) };
      return { cookie, body: await accessView(guest, link, me.id), mail };
    });
    if (!opened) throw invalid();
    return opened;
  }

  async function resolve(
    cookie: string | undefined,
    facts: RequestFacts,
    opts: { write?: boolean; action: string },
  ) {
    const orgId = cookie ? accessTokenOrg(cookie, 'lns') : null;
    if (!cookie || !orgId) {
      await limit(facts.ip, 2);
      throw sessionRequired();
    }
    const base = await baseContext(orgId, facts);
    const found = await database.withTenantTx(
      base,
      async (scope) => {
        const f = await findAccessLinkSession(scope, cookie, now());
        if (!f) return null;
        await usable(scope, f.link);
        return f;
      },
      { readOnly: true },
    );
    if (!found) {
      await limit(facts.ip, 2);
      throw sessionRequired();
    }
    await bump(`g:esrl:s:${found.session.id}`, 3600, 600, 1);
    if (!found.link.allowedActions.includes(opts.action)) throw invalid();
    if (opts.write && base.entitlements.state === 'read_only')
      throw new AppError('org.read_only', 'This site is read-only right now. Ask the sender.');
    return { ctx: guestContext(base, found.link), link: found.link, base };
  }

  async function view(cookie: string | undefined, facts: RequestFacts) {
    const r = await resolve(cookie, facts, { action: 'view' });
    // Expiry may write (marks the envelope expired), so this read is not read-only.
    return database.withTenantTx(r.ctx, (scope) => accessView(scope, r.link));
  }

  /** Loads the envelope and checks the recipient can act on it right now. */
  async function actor(scope: TenantScope, link: AccessLink) {
    const l = await core.expireIfDue(scope, await core.load(scope, link.entityId, link.projectId!));
    const me = await recipientOf(scope, link, l);
    if (l.env.status !== 'sent') throw invalid();
    if (me.role !== 'needs_to_sign' || (me.status !== 'sent' && me.status !== 'viewed'))
      throw new AppError('esign.invalid_state', 'You have nothing left to do on this envelope.');
    if (!isTurn(l.recips.map(stateOf), l.env.signingOrder, me.id))
      throw new AppError('esign.not_your_turn', 'Earlier signers have not finished yet.');
    return { l, me };
  }

  async function sign(
    cookie: string | undefined,
    input: { signatureKind: 'typed' | 'drawn'; signature: string },
    facts: RequestFacts,
  ) {
    const r = await resolve(cookie, facts, { write: true, action: 'sign' });
    const checked = checkSignature(input.signatureKind, input.signature);
    if (!checked.ok)
      throw new AppError('validation_failed', checked.message, [
        { path: 'signature', message: checked.message },
      ]);
    return database.withTenantTx(r.ctx, async (scope) => {
      const { l, me } = await actor(scope, r.link);
      const t = now();
      const [row] = await scope.tx
        .update(recipients)
        .set({
          status: 'signed',
          completedAt: t,
          signatureKind: input.signatureKind,
          signatureValue: checked.value,
          signerIp: facts.ip,
          signerUserAgent: facts.userAgent?.slice(0, 500) ?? null,
        })
        .where(and(eq(recipients.id, me.id), eq(recipients.status, me.status)))
        .returning({ id: recipients.id });
      if (!row) throw new AppError('esign.invalid_state', 'You have already signed.');
      await core.record(scope, l.env.id, 'signed', {
        recipientId: me.id,
        facts,
        data: { signatureKind: input.signatureKind },
      });
      scope.events.add({
        type: 'esign.recipient.signed.v1',
        projectId: l.env.projectId,
        entityType: 'esign_envelope',
        entityId: l.env.id,
        data: { envelopeId: l.env.id, recipientId: me.id },
      });
      const mail = await core.advance(asSender(scope, l.env.sentBy), l.env.id, null);
      return { body: await accessView(scope, r.link, me.id), mail };
    });
  }

  async function decline(cookie: string | undefined, reason: string, facts: RequestFacts) {
    const r = await resolve(cookie, facts, { write: true, action: 'decline' });
    return database.withTenantTx(r.ctx, async (scope) => {
      const { l, me } = await actor(scope, r.link);
      const t = now();
      await scope.tx
        .update(recipients)
        .set({ status: 'declined', completedAt: t, declineReason: reason.trim() })
        .where(eq(recipients.id, me.id));
      await scope.tx
        .update(envelopes)
        .set({ status: 'declined', version: l.env.version + 1, updatedAt: t })
        .where(eq(envelopes.id, l.env.id));
      await core.record(scope, l.env.id, 'declined', {
        recipientId: me.id,
        facts,
        data: { reason: reason.trim() },
      });
      await core.revokeAll(
        asSender(scope, l.env.sentBy),
        l.recips.filter((x) => x.id !== me.id),
      );
      scope.events.add({
        type: 'esign.envelope.declined.v1',
        projectId: l.env.projectId,
        entityType: 'esign_envelope',
        entityId: l.env.id,
        data: { envelopeId: l.env.id, recipientId: me.id },
      });
      // This link stays usable for the rest of its session so the page can show the outcome.
      return { body: await accessView(scope, r.link, me.id), mail: [] as Outbound[] };
    });
  }

  /** Hands signing to someone else, once. The new person gets their own link and the old one stops. */
  async function delegate(
    cookie: string | undefined,
    input: { name: string; email: string },
    facts: RequestFacts,
  ) {
    const r = await resolve(cookie, facts, { write: true, action: 'delegate' });
    const email = input.email.trim();
    if (!isEmail(email))
      throw new AppError('validation_failed', 'Enter a valid email.', [
        { path: 'email', message: 'Enter a valid email' },
      ]);
    return database.withTenantTx(r.ctx, async (scope) => {
      const { l, me } = await actor(scope, r.link);
      if (!l.env.allowDelegate || me.delegatedFrom)
        throw new AppError(
          'esign.delegate_not_allowed',
          'You can not hand signing to someone else on this envelope.',
        );
      if (l.recips.some((x) => x.email.toLowerCase() === email.toLowerCase()))
        throw new AppError('validation_failed', 'That person is already on this envelope.', [
          { path: 'email', message: 'Already a recipient' },
        ]);
      const next: RecipientRow = {
        ...me,
        id: uuidv7(),
        name: oneLine(input.name),
        email,
        status: 'sent',
        userId: null,
        companyId: null,
        accessLinkId: null,
        copyLinkId: null,
        sentAt: null,
        viewedAt: null,
        completedAt: null,
        signedOnPaper: false,
        signatureKind: null,
        signatureValue: null,
        signerIp: null,
        signerUserAgent: null,
        declineReason: null,
        delegatedFrom: me.id,
      };
      await scope.tx.insert(recipients).values(next);
      await scope.tx
        .update(recipients)
        .set({ status: 'delegated', completedAt: now() })
        .where(eq(recipients.id, me.id));
      await core.record(scope, l.env.id, 'delegated', {
        recipientId: me.id,
        facts,
        data: { to: email },
      });
      const sender = asSender(scope, l.env.sentBy);
      const mail = await core.issueLinks(sender, l, [next], 'invite', null);
      await core.revokeAll(sender, [me]);
      return { body: await accessView(scope, r.link, me.id), mail };
    });
  }

  async function documentPdf(cookie: string | undefined, documentId: string, facts: RequestFacts) {
    const r = await resolve(cookie, facts, { action: 'view' });
    return database.withTenantTx(r.ctx, async (scope) => {
      const l = await core.load(scope, r.link.entityId, r.link.projectId!);
      await recipientOf(scope, r.link, l);
      const doc = l.docs.find((d) => d.id === documentId);
      if (!doc) throw new AppError('esign.document_not_found');
      // A declined, voided or expired envelope no longer shows its documents.
      if (l.env.status !== 'sent' && l.env.status !== 'completed') throw invalid();
      return envelopesSvc.documentPdf(scope, l, doc);
    });
  }

  return { open, view, sign, decline, delegate, documentPdf };
}

export type SigningService = ReturnType<typeof createSigningService>;
