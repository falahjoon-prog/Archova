// Tender invites over an access link (X45, Sam security-licensing/11). Each invited company gets its own link from
// the invite email. Opening it shows the package (scope and due date, no files, no other bidders) and lets the
// company say whether it intends to quote or declines. Nothing else can be done with the link: quotes still come
// from people with an account, or builder staff enter them.
//
// The link and its browser session are checked on every request: not expired, not revoked, not used up, the package
// still out to tender, and the person who issued it must still be allowed to manage tender packages.
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { encodeId } from '@archova/domain';
import {
  AppError,
  ACCESS_LINK_DEFAULT_DAYS,
  accessLinkState,
  accessTokenOrg,
  countAccessLinkUse,
  createAccessLink,
  findAccessLink,
  findAccessLinkSession,
  openAccessLinkSession,
  revokeAccessLink,
  type AccessLink,
  type Database,
  type Entitlements,
  type Logger,
  type RedisClient,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { PlatformApi } from '@archova/mod-platform';
import { formatPackageNumber, takesQuotes } from '../domain/tender';
import { packageInvites, tenderPackages } from '../infra/tables';

export const TENDER_LINK_ENTITY = 'tender_package';
/** Its own cookie, so opening a tender link never replaces a transmittal or induction session in the same browser. */
export const TENDER_LINK_COOKIE = '__Host-tlk';
export const TENDER_LINK_ACTIONS = ['view', 'respond'] as const;
const TENDER_LINK_MAX_USES = 100;
/** A link works for 30 days or until a week after the package closes, whichever comes later (never past 90). */
const GRACE_AFTER_DUE_MS = 7 * 86_400_000;
const RESENDS_PER_INVITE_DAY = 5;
/** Tender invite emails an org can send in a day (new invites and resends together). */
const LINKS_PER_ORG_DAY = 300;

export interface TenderLinkDeps {
  database: Database;
  access: Pick<AccessService, 'can'>;
  platform: Pick<PlatformApi, 'getProject' | 'getOrg' | 'resolveTenantAccess' | 'companyContacts'>;
  entitlements: (orgId: string) => Promise<Entitlements>;
  redis?: RedisClient | null;
  logger?: Pick<Logger, 'warn'>;
  now?: () => Date;
}

export interface RequestFacts {
  ip: string;
  userAgent: string | null;
  requestId: string;
}

export interface IssuedInviteLink {
  inviteId: string;
  companyId: string;
  companyName: string;
  email: string;
  token: string;
  expiresAt: Date;
}

export interface IssueResult {
  issued: IssuedInviteLink[];
  /** Invited companies that have no contact email, so no link could be sent. */
  noEmail: string[];
}

const NIL_USER = '00000000-0000-0000-0000-000000000000';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export type TenderResponse = 'intends_to_quote' | 'declined';

export function createTenderLinkService(deps: TenderLinkDeps) {
  const now = deps.now ?? (() => new Date());
  const { database } = deps;

  // ------------------------------------------------------------------------------------------ issuing

  /** Caps invite emails per org per day so the endpoints can't be used to send mail in bulk. */
  async function assertOrgCap(scope: TenantScope, adding: number) {
    const dayAgo = new Date(now().getTime() - 86_400_000).toISOString();
    const res = await scope.tx.execute<{ n: string }>(sql`
      select count(*) as n from shared.access_links
      where entity_type = ${TENDER_LINK_ENTITY} and created_at > ${dayAgo}`);
    if (Number(res.rows[0]?.n ?? 0) + adding > LINKS_PER_ORG_DAY)
      throw new AppError(
        'access_link.rate_limited',
        'Your organisation has sent as many tender links as it can today. Try again tomorrow.',
      );
  }

  /**
   * Gives each invited company on a package that is out to tender its own link. Companies that already have a live
   * link are left alone unless `force` names them (a resend: the earlier link stops working). Returns the tokens for
   * the caller to email after the transaction commits.
   */
  async function issue(
    scope: TenantScope,
    projectId: string,
    packageId: string,
    opts: { companyIds?: readonly string[]; force?: boolean } = {},
  ): Promise<IssueResult> {
    const [pkg] = await scope.tx
      .select()
      .from(tenderPackages)
      .where(
        and(
          eq(tenderPackages.id, packageId),
          eq(tenderPackages.projectId, projectId),
          isNull(tenderPackages.deletedAt),
        ),
      )
      .limit(1);
    if (!pkg) throw new AppError('tender.not_found');
    // Invites on a draft wait: the links go out when the package is sent.
    if (!takesQuotes(pkg.status)) return { issued: [], noEmail: [] };
    const rows = await scope.tx
      .select()
      .from(packageInvites)
      .where(
        and(
          eq(packageInvites.packageId, packageId),
          inArray(packageInvites.status, ['invited', 'viewed', 'intends_to_quote']),
          ...(opts.companyIds ? [inArray(packageInvites.companyId, [...opts.companyIds])] : []),
        ),
      );
    const wanted = rows.filter((r) => opts.force || !r.accessLinkId);
    if (!wanted.length) return { issued: [], noEmail: [] };
    const contacts = new Map(
      (
        await deps.platform.companyContacts(scope, [...new Set(wanted.map((r) => r.companyId))])
      ).map((c) => [c.id, c]),
    );
    await assertOrgCap(scope, wanted.length);
    const t = now();
    const expiresAt = new Date(
      Math.min(
        Math.max(
          t.getTime() + ACCESS_LINK_DEFAULT_DAYS * 86_400_000,
          (pkg.dueAt?.getTime() ?? 0) + GRACE_AFTER_DUE_MS,
        ),
        t.getTime() + 90 * 86_400_000,
      ),
    );
    const issued: IssuedInviteLink[] = [];
    const noEmail: string[] = [];
    for (const r of wanted) {
      const company = contacts.get(r.companyId);
      const email = (r.contactEmail ?? company?.email ?? '').trim();
      if (!company || !EMAIL.test(email)) {
        noEmail.push(r.companyId);
        continue;
      }
      if (r.accessLinkId) await revokeAccessLink(scope, r.accessLinkId);
      const { link, token } = await createAccessLink(scope, {
        projectId,
        entityType: TENDER_LINK_ENTITY,
        entityId: packageId,
        allowedActions: TENDER_LINK_ACTIONS,
        label: `Tender ${formatPackageNumber(pkg.number)}`,
        recipientEmail: email,
        expiresAt,
        maxUses: TENDER_LINK_MAX_USES,
      });
      await scope.tx
        .update(packageInvites)
        .set({ accessLinkId: link.id, deliveredAt: null })
        .where(eq(packageInvites.id, r.id));
      issued.push({
        inviteId: r.id,
        companyId: r.companyId,
        companyName: company.name,
        email,
        token,
        expiresAt,
      });
    }
    return { issued, noEmail };
  }

  /** The names an invite email quotes. */
  async function names(scope: TenantScope, projectId: string) {
    const [org, project] = await Promise.all([
      deps.platform.getOrg(scope),
      deps.platform.getProject(scope, projectId),
    ]);
    return { org: org.name as string, project: (project as { name: string }).name };
  }

  /** Records that the invite email went out (called after the send, in its own transaction). */
  async function markDelivered(scope: TenantScope, inviteIds: readonly string[]) {
    if (!inviteIds.length) return;
    await scope.tx
      .update(packageInvites)
      .set({ deliveredAt: now() })
      .where(inArray(packageInvites.id, [...inviteIds]));
  }

  /** A resend for one company, capped so the endpoint can't be used to mail-bomb a contact. */
  async function resend(
    scope: TenantScope,
    projectId: string,
    packageId: string,
    companyId: string,
  ) {
    const [inv] = await scope.tx
      .select()
      .from(packageInvites)
      .where(and(eq(packageInvites.packageId, packageId), eq(packageInvites.companyId, companyId)))
      .limit(1);
    if (!inv) throw new AppError('tender.invite_not_found');
    if (inv.status === 'declined' || inv.status === 'submitted')
      throw new AppError(
        'tender.invalid_state',
        'That company has already answered, so there is nothing to resend.',
      );
    const [contact] = await deps.platform.companyContacts(scope, [companyId]);
    const email = (inv.contactEmail ?? contact?.email ?? '').trim();
    if (email) {
      const dayAgo = new Date(now().getTime() - 86_400_000).toISOString();
      const res = await scope.tx.execute<{ n: string }>(sql`
        select count(*) as n from shared.access_links
        where entity_type = ${TENDER_LINK_ENTITY} and entity_id = ${packageId}
          and recipient_email = ${email} and created_at > ${dayAgo}`);
      if (Number(res.rows[0]?.n ?? 0) >= RESENDS_PER_INVITE_DAY)
        throw new AppError(
          'access_link.rate_limited',
          'That link has been resent enough times today. Try again tomorrow.',
        );
    }
    const r = await issue(scope, projectId, packageId, { companyIds: [companyId], force: true });
    if (!r.issued.length && r.noEmail.length)
      throw new AppError(
        'tender.no_contact_email',
        'This company has no email address. Add one on its company record, then resend.',
      );
    if (!r.issued.length)
      throw new AppError('tender.invalid_state', "This package isn't out to tender.");
    return r;
  }

  // ---------------------------------------------------------------------------- the guest's side

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
  /** Sam 11 §6: token lookups per IP, 30 a minute and 300 an hour; unknown tokens count double. */
  async function limit(ip: string, weight: number) {
    await bump(`g:tdrl:m:${ip}`, 60, 30, weight);
    await bump(`g:tdrl:h:${ip}`, 3600, 300, weight);
  }

  const invalid = () =>
    new AppError('access_link.invalid', 'This link no longer works. Ask the sender for a new one.');
  const sessionRequired = () =>
    new AppError('access_link.session_required', 'Open your link again to continue.');

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

  /** Sam 11 §2: a link dies with its creator's access. They must still be able to manage tender packages. */
  async function creatorStillAllowed(scope: TenantScope, link: AccessLink) {
    const access = await deps.platform.resolveTenantAccess(
      scope.ctx.orgId,
      link.createdBy,
      scope.ctx.requestId,
    );
    if (!access) return false;
    if (!link.projectId) return false;
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
    return deps.access.can(asCreator, 'estimating.packages.manage', { projectId: link.projectId });
  }

  async function usable(scope: TenantScope, link: AccessLink, opening = false) {
    if (link.entityType !== TENDER_LINK_ENTITY || !link.projectId) throw invalid();
    const state = accessLinkState(link, now());
    if (state === 'revoked' || state === 'expired' || (state === 'used_up' && opening))
      throw invalid();
    if (!(await creatorStillAllowed(scope, link))) throw invalid();
    if (scope.ctx.entitlements.state === 'cancelled') throw invalid();
  }

  async function inviteOf(scope: TenantScope, link: AccessLink) {
    const [r] = await scope.tx
      .select()
      .from(packageInvites)
      .where(eq(packageInvites.accessLinkId, link.id))
      .limit(1);
    if (!r) throw invalid();
    return r;
  }

  /** The package as an invited company sees it: no files, no other bidders, no prices. */
  async function accessView(scope: TenantScope, link: AccessLink) {
    const projectId = link.projectId!;
    const [pkg] = await scope.tx
      .select()
      .from(tenderPackages)
      .where(
        and(
          eq(tenderPackages.id, link.entityId),
          eq(tenderPackages.projectId, projectId),
          isNull(tenderPackages.deletedAt),
        ),
      )
      .limit(1);
    // The link stops with the tender: closing, cancelling or awarding it ends the invitation.
    if (!pkg || !takesQuotes(pkg.status)) throw invalid();
    const [org, project, invite] = await Promise.all([
      deps.platform.getOrg(scope),
      deps.platform.getProject(scope, projectId),
      inviteOf(scope, link),
    ]);
    return {
      package: {
        number: formatPackageNumber(pkg.number),
        name: pkg.name,
        trade: pkg.trade,
        dueAt: pkg.dueAt?.toISOString() ?? null,
        scope: pkg.scope.map((l) => ({ description: l.description })),
        fromOrg: org.name as string,
        projectName: (project as { name: string }).name,
      },
      invite: {
        companyId: encodeId('company', invite.companyId),
        email: link.recipientEmail,
        status: invite.status,
        viewedAt: invite.viewedAt?.toISOString() ?? null,
        respondedAt: invite.respondedAt?.toISOString() ?? null,
      },
      actions: link.allowedActions,
      expiresAt: link.expiresAt.toISOString(),
    };
  }

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
      const guest: TenantScope = { ...scope, ctx: guestContext(base, link) };
      const invite = await inviteOf(guest, link);
      if (!invite.viewedAt) {
        const t = now();
        await scope.tx
          .update(packageInvites)
          .set({
            viewedAt: t,
            ...(invite.status === 'invited' ? { status: 'viewed' as const } : {}),
          })
          .where(and(eq(packageInvites.id, invite.id), isNull(packageInvites.viewedAt)));
        scope.events.add({
          type: 'estimating.package.invite_viewed.v1',
          projectId: link.projectId,
          entityType: 'tender_package',
          entityId: link.entityId,
          data: { packageId: link.entityId, companyId: invite.companyId },
        });
      }
      return { cookie, body: await accessView(guest, link) };
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
    await bump(`g:tdrl:s:${found.session.id}`, 3600, 600, 1);
    if (!found.link.allowedActions.includes(opts.action)) throw invalid();
    if (opts.write && base.entitlements.state === 'read_only')
      throw new AppError('org.read_only', 'This site is read-only right now. Ask the sender.');
    return { ctx: guestContext(base, found.link), link: found.link };
  }

  async function view(cookie: string | undefined, facts: RequestFacts) {
    const r = await resolve(cookie, facts, { action: 'view' });
    return database.withTenantTx(r.ctx, (scope) => accessView(scope, r.link), { readOnly: true });
  }

  /** The company says it intends to quote or declines; it can change its mind until it has submitted a quote. */
  async function respond(
    cookie: string | undefined,
    response: TenderResponse,
    facts: RequestFacts,
  ) {
    const r = await resolve(cookie, facts, { write: true, action: 'respond' });
    return database.withTenantTx(r.ctx, async (scope) => {
      const invite = await inviteOf(scope, r.link);
      if (invite.status === 'submitted')
        throw new AppError('tender.invalid_state', 'A quote has already been submitted.');
      if (invite.status !== response) {
        await scope.tx
          .update(packageInvites)
          .set({ status: response, respondedAt: now() })
          .where(eq(packageInvites.id, invite.id));
        scope.events.add({
          type: 'estimating.package.invite_responded.v1',
          projectId: r.link.projectId,
          entityType: 'tender_package',
          entityId: r.link.entityId,
          data: { packageId: r.link.entityId, companyId: invite.companyId, response },
        });
      }
      return accessView(scope, r.link);
    });
  }

  return { issue, resend, names, markDelivered, open, view, respond };
}

export type TenderLinkService = ReturnType<typeof createTenderLinkService>;
