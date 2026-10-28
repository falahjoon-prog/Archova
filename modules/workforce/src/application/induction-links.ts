// Inductions over an access link (X45, IND-AC3, design/08 Part B). A worker with no account opens the link on their
// phone, verifies their mobile (or email) with a one-time code, and then does the same induction as everyone else:
// sections, quiz, white card, declaration and signature. Everything they do is scoped to their own completion.
//
// The link and its browser session are checked on every request (Sam security-licensing/11 §3): not expired, not
// revoked, not used up, and the person who made it can still do what the link stands in for.
import { and, eq, sql } from 'drizzle-orm';
import { encodeId, uuidv7 } from '@archova/domain';
import {
  AppError,
  ACCESS_LINK_COOKIE,
  ACCESS_LINK_DEFAULT_DAYS,
  ACCESS_LINK_MAX_DAYS,
  accessLinkState,
  accessTokenOrg,
  bindAccessLinkSession,
  countAccessLinkUse,
  createAccessLink,
  findAccessLink,
  findAccessLinkSession,
  getAccessLink,
  issueAccessLinkCode,
  listAccessLinks,
  openAccessLinkSession,
  revokeAccessLink,
  verifyAccessLinkCode,
  type AccessLink,
  type AccessLinkSession,
  type Database,
  type Entitlements,
  type Logger,
  type MessageSender,
  type RedisClient,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { PlatformApi } from '@archova/mod-platform';
import { inductionVersions, workers } from '../infra/tables';
import { workerChanged, type AttendanceService, type WorkerRow } from './attendance';
import { aiContent, slideSources, type InductionService, type VersionRow } from './inductions';

export const LINK_ENTITY = 'induction';
/** What a link on an induction lets the holder do (Sam 11 §2). Fixed: a link never carries more. */
export const LINK_ACTIONS = ['view', 'respond'] as const;
const CODE_RESEND_S = 30;

export interface InductionLinkDeps {
  database: Database;
  attendance: AttendanceService;
  inductions: InductionService;
  platform: Pick<
    PlatformApi,
    'getProject' | 'getOrg' | 'projectCompanies' | 'getProjectMembership' | 'resolveTenantAccess'
  >;
  entitlements: (orgId: string) => Promise<Entitlements>;
  files: {
    createUpload(
      scope: TenantScope,
      input: {
        filename: string;
        mime: string;
        sizeBytes: number;
        sha256: string;
        module: string;
        projectId: string | null;
      },
      opts: { authorised: boolean },
    ): Promise<{
      id: string;
      status: 'pending';
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
      expiresAt: Date;
    }>;
    completeUpload(scope: TenantScope, uploadId: string): Promise<FileRowLike>;
    downloadUrl(
      scope: TenantScope,
      fileId: string,
      opts: { authorised: boolean },
    ): Promise<{ url: string; expiresAt: Date }>;
  };
  messages: MessageSender;
  ai: {
    askInduction(
      ctx: TenantContext,
      input: { projectId: string; versionId: string; question: string },
    ): Promise<{
      found: boolean;
      answer: string;
      citations: Array<{ slide: number; slideTitle: string; quote: string }>;
    }>;
    translateInduction(
      ctx: TenantContext,
      version: ReturnType<typeof aiContent>,
      language: string,
    ): Promise<AiTranslation>;
    translationLanguages(): Array<{ code: string; name: string; nativeName: string }>;
  };
  /** The public web origin the link points at, e.g. `https://app.archova.com.au`. */
  baseUrl: string;
  redis?: RedisClient | null;
  logger?: Pick<Logger, 'warn' | 'info'>;
  now?: () => Date;
}

interface FileRowLike {
  id: string;
  projectId: string | null;
  module: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  status: string;
  createdAt: Date;
}

export interface AiTranslation {
  language: string;
  nativeName: string;
  label: string;
  keptInEnglish: string;
  version: number;
  slides: Array<{
    slide: number;
    translated: boolean;
    title: string;
    points: string[];
    script: string[];
  }>;
  quiz: Array<{ id: string; translated: boolean; question: string; options: string[] }>;
  translationHash: string;
}

/** A resolved request on a link: the context to run under, and who it is. */
export interface LinkRequest {
  ctx: TenantContext;
  link: AccessLink;
  session: AccessLinkSession;
  projectId: string;
  inductionId: string;
}

export interface RequestFacts {
  ip: string;
  userAgent: string | null;
  requestId: string;
}

const mask = (to: string) =>
  to.includes('@')
    ? `${to.slice(0, 1)}•••${to.slice(to.indexOf('@'))}`
    : `${to.slice(0, 3)}•••••${to.slice(-3)}`;

export function createInductionLinkService(deps: InductionLinkDeps) {
  const now = deps.now ?? (() => new Date());
  const { database, attendance, inductions } = deps;

  // ---------------------------------------------------------------------------------------- limits

  /** Sam 11 §6: token lookups per IP, 30 a minute and 300 an hour; unknown tokens count double. */
  async function limit(ip: string, weight: number) {
    const redis = deps.redis;
    if (!redis) return;
    const keys: Array<[string, number, number]> = [
      [`g:alrl:m:${ip}`, 60, 30],
      [`g:alrl:h:${ip}`, 3600, 300],
    ];
    for (const [key, windowS, max] of keys) {
      const n = await redis.incrby(key, weight);
      if (n === weight) await redis.expire(key, windowS);
      if (n > max) throw new AppError('access_link.rate_limited', 'Too many tries. Wait a minute.');
    }
  }

  // ------------------------------------------------------------------------------ the builder's side

  const dto = (l: AccessLink, inductionId: string) => ({
    id: encodeId('accessLink', l.id),
    inductionId: encodeId('induction', inductionId),
    label: l.label,
    recipientEmail: l.recipientEmail,
    recipientPhone: l.recipientPhone,
    state: accessLinkState(l, now()),
    expiresAt: l.expiresAt.toISOString(),
    maxUses: l.maxUses,
    useCount: l.useCount,
    lastUsedAt: l.lastUsedAt?.toISOString() ?? null,
    createdAt: l.createdAt.toISOString(),
    createdBy: encodeId('user', l.createdBy),
    revokedAt: l.revokedAt?.toISOString() ?? null,
  });

  async function createLink(
    scope: TenantScope,
    projectId: string,
    inductionId: string,
    input: {
      label?: string;
      recipientEmail?: string;
      recipientPhone?: string;
      expiresInDays?: number;
      maxUses?: number;
    },
  ) {
    const row = await inductions.getRow(scope, projectId, inductionId);
    if (row.status === 'archived')
      throw new AppError('induction.archived', 'This induction is archived.');
    const days = Math.min(input.expiresInDays ?? ACCESS_LINK_DEFAULT_DAYS, ACCESS_LINK_MAX_DAYS);
    const { link, token } = await createAccessLink(scope, {
      projectId,
      entityType: LINK_ENTITY,
      entityId: inductionId,
      allowedActions: LINK_ACTIONS,
      label: input.label ?? null,
      recipientEmail: input.recipientEmail ?? null,
      recipientPhone: input.recipientPhone ?? null,
      expiresAt: new Date(now().getTime() + days * 86_400_000),
      maxUses: input.maxUses ?? null,
    });
    return { body: { link: dto(link, inductionId), token, url: `${deps.baseUrl}/i/${token}` } };
  }

  async function listLinks(scope: TenantScope, projectId: string, inductionId: string) {
    await inductions.getRow(scope, projectId, inductionId);
    const rows = await listAccessLinks(scope, LINK_ENTITY, inductionId);
    return { data: rows.map((l) => dto(l, inductionId)) };
  }

  async function revokeLink(
    scope: TenantScope,
    projectId: string,
    inductionId: string,
    linkId: string,
  ) {
    await inductions.getRow(scope, projectId, inductionId);
    const existing = await getAccessLink(scope, linkId);
    if (!existing || existing.entityId !== inductionId) throw new AppError('access_link.not_found');
    return dto(await revokeAccessLink(scope, linkId), inductionId);
  }

  // ------------------------------------------------------------------------------ resolving a request

  const invalid = () =>
    new AppError(
      'access_link.invalid',
      'This link no longer works. Ask the site office for a new one.',
    );

  /** Sam 11 §2: a link dies with its creator's access. Org admins, or an active member of the project. */
  async function creatorStillAllowed(scope: TenantScope, link: AccessLink) {
    const access = await deps.platform.resolveTenantAccess(
      scope.ctx.orgId,
      link.createdBy,
      scope.ctx.requestId,
    );
    if (!access) return false;
    if (access.orgRole === 'owner' || access.orgRole === 'admin') return true;
    if (!link.projectId) return false;
    const member = await deps.platform.getProjectMembership(scope, link.projectId, link.createdBy);
    return Boolean(member);
  }

  async function usable(scope: TenantScope, link: AccessLink) {
    if (link.entityType !== LINK_ENTITY || !link.projectId) throw invalid();
    if (accessLinkState(link, now()) !== 'active') throw invalid();
    if (!(await creatorStillAllowed(scope, link))) throw invalid();
    const ent = scope.ctx.entitlements;
    if (!ent.modules.includes('workforce') || ent.state === 'cancelled') throw invalid();
  }

  async function baseContext(orgId: string, facts: RequestFacts): Promise<TenantContext> {
    return {
      orgId,
      // A link has no user; the creator-independent placeholder is the nil id until a worker is verified.
      userId: '00000000-0000-0000-0000-000000000000',
      principalType: 'external',
      orgRole: null,
      entitlements: await deps.entitlements(orgId),
      requestId: facts.requestId,
    };
  }

  /** The tenant context a verified worker's requests run under. userId is the worker, so uploads are theirs. */
  function guestContext(base: TenantContext, link: AccessLink, session: AccessLinkSession) {
    return {
      ...base,
      userId: session.subjectId ?? link.id,
      actor: {
        type: 'link' as const,
        linkId: link.id,
        subjectType: session.subjectType,
        subjectId: session.subjectId,
      },
    };
  }

  /** The cookie's session, checked afresh. `write` actions also need an org that isn't read-only. */
  async function resolve(
    cookie: string | undefined,
    facts: RequestFacts,
    opts: { write?: boolean; verified?: boolean } = {},
  ): Promise<LinkRequest> {
    await limit(facts.ip, 1);
    const orgId = cookie ? accessTokenOrg(cookie, 'lns') : null;
    if (!cookie || !orgId)
      throw new AppError('access_link.session_required', 'Open your link again to continue.');
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
    if (!found)
      throw new AppError('access_link.session_required', 'Open your link again to continue.');
    if (opts.write && base.entitlements.state === 'read_only')
      throw new AppError('org.read_only', 'This site is read-only right now. Ask the site office.');
    if (opts.verified && (!found.session.verifiedAt || !found.session.subjectId))
      throw new AppError('access_link.not_verified', 'Verify your mobile number first.');
    return {
      ctx: guestContext(base, found.link, found.session),
      link: found.link,
      session: found.session,
      projectId: found.link.projectId!,
      inductionId: found.link.entityId,
    };
  }

  // -------------------------------------------------------------------------------------- the pages

  async function currentVersion(scope: TenantScope, inductionId: string, projectId: string) {
    const row = await inductions.getRow(scope, projectId, inductionId);
    if (!row.currentVersionId)
      throw new AppError('induction.not_published', 'This site has no induction to take yet.');
    const [v] = await scope.tx
      .select()
      .from(inductionVersions)
      .where(eq(inductionVersions.id, row.currentVersionId))
      .limit(1);
    return { row, version: v! };
  }

  async function accessView(scope: TenantScope, r: LinkRequest) {
    const [{ row, version }, project, org, companies] = await Promise.all([
      currentVersion(scope, r.inductionId, r.projectId),
      deps.platform.getProject(scope, r.projectId),
      deps.platform.getOrg(scope),
      deps.platform.projectCompanies(scope, r.projectId),
    ]);
    const site = row.siteId ? await attendance.getSite(scope, r.projectId, row.siteId) : null;
    let worker: WorkerRow | null = null;
    let completion = null;
    if (r.session.subjectId) {
      worker = await attendance.getWorker(scope, r.session.subjectId);
      completion = await inductions.latestCompletion(scope, r.inductionId, worker.id);
    }
    const companyName = worker
      ? (companies.find((c) => c.id === worker!.companyId)?.name ?? worker.companyNameOther)
      : null;
    return {
      orgName: org.name,
      projectName: project.name,
      siteName: site?.name ?? null,
      inductionTitle: row.title,
      versionNumber: version.number,
      publishedAt: version.publishedAt.toISOString(),
      sectionCount: version.content.sections.length,
      languages: deps.ai.translationLanguages(),
      companies: companies.map((c) => ({ id: encodeId('company', c.id), name: c.name })),
      verified: Boolean(r.session.verifiedAt),
      verifiedTo: r.session.verifiedTo ? mask(r.session.verifiedTo) : null,
      worker: worker
        ? {
            fullName: worker.fullName,
            companyName: companyName ?? null,
            returning: worker.createdBy !== r.link.id,
          }
        : null,
      completionId: completion ? encodeId('inductionCompletion', completion.id) : null,
      completionStatus: (completion?.status ?? 'not_started') as
        'not_started' | 'in_progress' | 'completed',
      expiresAt: r.session.expiresAt.toISOString(),
    };
  }

  /** `/i/[token]`: the first request. Counts the opening, then hands back a session for this link only. */
  async function open(token: string, facts: RequestFacts) {
    const orgId = accessTokenOrg(token, 'arl');
    await limit(facts.ip, orgId ? 1 : 2);
    if (!orgId) throw invalid();
    const base = await baseContext(orgId, facts);
    const opened = await database.withTenantTx(base, async (scope) => {
      const link = await findAccessLink(scope, token);
      if (!link) return null;
      await usable(scope, link);
      await countAccessLinkUse(scope, link.id);
      const { session, token: cookie } = await openAccessLinkSession(scope, link, {
        ip: facts.ip,
        userAgent: facts.userAgent,
        now: now(),
      });
      scope.events.add({
        type: 'workforce.induction.link.opened.v1',
        projectId: link.projectId,
        entityType: 'induction',
        entityId: link.entityId,
        data: { linkId: link.id },
      });
      const r: LinkRequest = {
        ctx: guestContext(base, link, session),
        link,
        session,
        projectId: link.projectId!,
        inductionId: link.entityId,
      };
      return { cookie, body: await accessView(scope, r) };
    });
    if (!opened) throw invalid();
    return opened;
  }

  async function view(cookie: string | undefined, facts: RequestFacts) {
    const r = await resolve(cookie, facts);
    return database.withTenantTx(r.ctx, (scope) => accessView(scope, r), { readOnly: true });
  }

  // ---------------------------------------------------------------------------------- verification

  async function sendCode(
    cookie: string | undefined,
    input: { channel: 'sms' | 'email'; to: string },
    facts: RequestFacts,
  ) {
    const r = await resolve(cookie, facts, { write: true });
    const to = input.to.trim();
    const valid =
      input.channel === 'sms' ? /^\+[1-9][0-9]{6,14}$/.test(to) : /^\S+@\S+\.\S+$/.test(to);
    if (!valid)
      throw new AppError('validation_failed', 'Check the number or address.', [
        {
          path: 'to',
          message:
            input.channel === 'sms' ? 'Use +61 and your mobile number' : 'Not an email address',
        },
      ]);
    const issued = await database.withTenantTx(r.ctx, async (scope) => {
      const org = await deps.platform.getOrg(scope);
      const res = await issueAccessLinkCode(scope, r.session, {
        channel: input.channel,
        destination: input.channel === 'email' ? to.toLowerCase() : to,
        now: now(),
      });
      return { res, orgName: org.name };
    });
    if (!issued.res.ok)
      throw new AppError(
        'access_link.too_many_codes',
        "That's too many codes. Try again in an hour, or ask the site office.",
      );
    const body = `${issued.res.code} is your ${issued.orgName} site induction code. It lasts 10 minutes. Don't share it.`;
    if (input.channel === 'sms') await deps.messages.sms(to, body);
    else
      await deps.messages.email(to, {
        subject: `Your ${issued.orgName} induction code`,
        text: body,
      });
    return {
      channel: input.channel,
      to: mask(to),
      expiresAt: issued.res.expiresAt.toISOString(),
      resendAfter: new Date(now().getTime() + CODE_RESEND_S * 1000).toISOString(),
    };
  }

  /** The worker already on file for a verified mobile or email (design/08 B2 "Welcome back"). */
  async function knownWorker(scope: TenantScope, channel: 'sms' | 'email', to: string) {
    const [w] = await scope.tx
      .select()
      .from(workers)
      .where(
        and(
          channel === 'sms' ? eq(workers.phone, to) : eq(workers.email, to),
          eq(workers.kind, 'worker'),
          eq(workers.status, 'active'),
        ),
      )
      .orderBy(sql`${workers.createdAt} asc`)
      .limit(1);
    return w ?? null;
  }

  async function verify(
    cookie: string | undefined,
    input: {
      code: string;
      fullName: string;
      companyId?: string;
      companyName?: string;
    },
    facts: RequestFacts,
  ) {
    const r = await resolve(cookie, facts, { write: true });
    const outcome = await database.withTenantTx(r.ctx, async (scope) => {
      const checked = await verifyAccessLinkCode(scope, r.session, {
        code: input.code,
        now: now(),
      });
      if (!checked.ok) return checked;
      const session = checked.session;
      const channel = session.verifiedChannel!;
      const to = session.verifiedTo!;
      let worker = await knownWorker(scope, channel, to);
      if (!worker) {
        const companies = await deps.platform.projectCompanies(scope, r.projectId);
        const listed = input.companyId
          ? companies.find((c) => c.id === input.companyId)
          : undefined;
        if (!listed && !input.companyName?.trim())
          throw new AppError('validation_failed', 'Pick your company, or type its name.', [
            { path: 'companyId', message: 'Required' },
          ]);
        const [created] = await scope.tx
          .insert(workers)
          .values({
            id: uuidv7(),
            orgId: scope.ctx.orgId,
            fullName: input.fullName.trim(),
            companyId: listed?.id ?? null,
            // A company typed by hand is flagged to the site manager to confirm (ATT-AC2).
            companyNameOther: listed ? null : input.companyName!.trim(),
            phone: channel === 'sms' ? to : null,
            email: channel === 'email' ? to : null,
            kind: 'worker',
            createdBy: r.link.id,
            updatedBy: r.link.id,
          })
          .returning();
        worker = created!;
        await workerChanged(scope, worker);
      }
      await bindAccessLinkSession(scope, session.id, { type: 'worker', id: worker.id });
      const bound: AccessLinkSession = { ...session, subjectType: 'worker', subjectId: worker.id };
      const next: LinkRequest = {
        ...r,
        session: bound,
        ctx: guestContext({ ...r.ctx, actor: undefined } as TenantContext, r.link, bound),
      };
      await inductions.startForLink(scope, r.projectId, r.inductionId, worker.id, {
        linkId: r.link.id,
        channel,
        verifiedTo: to,
      });
      return { ok: true as const, body: await accessView(scope, next) };
    });
    if (!outcome.ok)
      throw outcome.reason === 'code_invalid'
        ? new AppError('access_link.code_invalid', "That code isn't right. Check it and try again.")
        : new AppError('access_link.code_expired', 'That code has expired. Ask for a new one.');
    return outcome.body;
  }

  // ------------------------------------------------------------------------- the worker's induction

  /** Runs `fn` as the verified worker on their own completion; their record is all they can reach. */
  async function asWorker<T>(
    cookie: string | undefined,
    facts: RequestFacts,
    opts: { write: boolean },
    fn: (scope: TenantScope, r: LinkRequest, completionId: string) => Promise<T>,
  ) {
    const r = await resolve(cookie, facts, { write: opts.write, verified: true });
    const run = (scope: TenantScope) =>
      inductions.latestCompletion(scope, r.inductionId, r.session.subjectId!).then((c) => {
        if (!c) throw new AppError('induction.completion_not_found');
        return fn(scope, r, c.id);
      });
    return opts.write
      ? database.withTenantTx(r.ctx, run)
      : database.withTenantTx(r.ctx, run, { readOnly: true });
  }

  const completion = (cookie: string | undefined, facts: RequestFacts) =>
    asWorker(cookie, facts, { write: false }, (s, r, id) =>
      inductions.getCompletion(s, r.projectId, id),
    );

  const progress = (
    cookie: string | undefined,
    input: { section: number; seconds?: number },
    facts: RequestFacts,
  ) =>
    asWorker(cookie, facts, { write: true }, (s, r, id) =>
      inductions.recordProgress(s, r.projectId, id, input),
    );

  const quiz = (
    cookie: string | undefined,
    answers: Array<{ questionId: string; answerIndex: number }>,
    facts: RequestFacts,
  ) =>
    asWorker(cookie, facts, { write: true }, (s, r, id) =>
      inductions.submitQuiz(s, r.projectId, id, answers),
    );

  const addCredential = (
    cookie: string | undefined,
    input: Parameters<InductionService['addInductionCredential']>[3],
    facts: RequestFacts,
  ) =>
    asWorker(cookie, facts, { write: true }, (s, r, id) =>
      inductions.addInductionCredential(s, r.projectId, id, input),
    );

  const sign = (
    cookie: string | undefined,
    input: Parameters<InductionService['sign']>[3],
    facts: RequestFacts,
  ) =>
    asWorker(cookie, facts, { write: true }, async (s, r, id) => {
      const done = await inductions.sign(s, r.projectId, id, input, {
        ip: facts.ip,
        userAgent: facts.userAgent,
      });
      return done;
    });

  // ---------------------------------------------------------------------------------- card photos

  async function createUpload(
    cookie: string | undefined,
    input: { filename: string; mime: string; sizeBytes: number; sha256: string },
    facts: RequestFacts,
  ) {
    const r = await resolve(cookie, facts, { write: true, verified: true });
    const up = await database.withTenantTx(r.ctx, (scope) =>
      deps.files.createUpload(
        scope,
        { ...input, module: 'workforce', projectId: r.projectId },
        { authorised: true },
      ),
    );
    return {
      id: encodeId('upload', up.id),
      status: up.status,
      uploadUrl: up.uploadUrl,
      uploadMethod: 'PUT' as const,
      uploadHeaders: up.uploadHeaders,
      expiresAt: up.expiresAt.toISOString(),
    };
  }

  async function completeUpload(cookie: string | undefined, uploadId: string, facts: RequestFacts) {
    const r = await resolve(cookie, facts, { write: true, verified: true });
    return database.withTenantTx(r.ctx, (scope) => deps.files.completeUpload(scope, uploadId), {
      statementTimeout: '60s',
    });
  }

  /** A video, PDF or image the induction itself uses, and nothing else. */
  async function download(cookie: string | undefined, fileId: string, facts: RequestFacts) {
    const r = await resolve(cookie, facts, { verified: true });
    return database.withTenantTx(r.ctx, async (scope) => {
      const { version } = await currentVersion(scope, r.inductionId, r.projectId);
      const used = version.content.sections.some((s) =>
        s.blocks.some((b) => 'fileId' in b && b.fileId === fileId),
      );
      if (!used) throw new AppError('file.not_found');
      return deps.files.downloadUrl(scope, fileId, { authorised: true });
    });
  }

  // ------------------------------------------------------------------------------------------- Nova

  async function loadVersion(r: LinkRequest): Promise<VersionRow> {
    return database.withTenantTx(
      r.ctx,
      async (scope) => (await currentVersion(scope, r.inductionId, r.projectId)).version,
      { readOnly: true },
    );
  }

  async function ask(cookie: string | undefined, question: string, facts: RequestFacts) {
    const r = await resolve(cookie, facts, { write: true, verified: true });
    const version = await loadVersion(r);
    const a = await deps.ai.askInduction(r.ctx, {
      projectId: r.projectId,
      versionId: version.id,
      question,
    });
    const sources = slideSources(version);
    return {
      found: a.found,
      answer: a.answer,
      citations: a.citations.map((c) => ({
        section: sources[c.slide - 1]?.section ?? 0,
        slideTitle: c.slideTitle,
        quote: c.quote,
      })),
    };
  }

  async function translation(cookie: string | undefined, language: string, facts: RequestFacts) {
    const r = await resolve(cookie, facts, { write: true, verified: true });
    const version = await loadVersion(r);
    const t = await deps.ai.translateInduction(r.ctx, aiContent(version), language);
    const sources = slideSources(version);
    const sections = new Map<number, Map<number, AiTranslation['slides']>>();
    t.slides.forEach((s, i) => {
      const src = sources[i];
      if (!src) return;
      const blocks = sections.get(src.section) ?? new Map<number, AiTranslation['slides']>();
      blocks.set(src.block, [...(blocks.get(src.block) ?? []), s]);
      sections.set(src.section, blocks);
    });
    await database.withTenantTx(r.ctx, (scope) =>
      asCompletion(scope, r, (id) =>
        inductions.recordLanguage(scope, r.projectId, id, t.language, t.translationHash),
      ),
    );
    return {
      language: t.language,
      nativeName: t.nativeName,
      label: t.label,
      keptInEnglish: t.keptInEnglish,
      versionNumber: version.number,
      sections: [...sections.entries()]
        .sort(([a], [b]) => a - b)
        .map(([section, blocks]) => ({
          section,
          blocks: [...blocks.entries()]
            .sort(([a], [b]) => a - b)
            .map(([block, slides]) => ({
              block,
              translated: slides.every((s) => s.translated),
              slides: slides.map((s) => ({ title: s.title, points: s.points, script: s.script })),
            })),
        })),
      quiz: t.quiz.map((q) => ({
        questionId: q.id,
        translated: q.translated,
        question: q.question,
        options: q.options,
      })),
    };
  }

  async function asCompletion<T>(
    scope: TenantScope,
    r: LinkRequest,
    fn: (completionId: string) => Promise<T>,
  ) {
    const c = await inductions.latestCompletion(scope, r.inductionId, r.session.subjectId!);
    if (!c) throw new AppError('induction.completion_not_found');
    return fn(c.id);
  }

  return {
    createLink,
    listLinks,
    revokeLink,
    open,
    view,
    sendCode,
    verify,
    completion,
    progress,
    quiz,
    addCredential,
    sign,
    createUpload,
    completeUpload,
    download,
    ask,
    translation,
  };
}

export type InductionLinkService = ReturnType<typeof createInductionLinkService>;
export { ACCESS_LINK_COOKIE };
