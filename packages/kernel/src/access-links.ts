// Access links for people without an account (X45, Sam security-licensing/11). One mechanism every module uses:
// the module creates a link scoped to one record and a fixed list of actions, checks the link on every use and
// decides what each action does. This file holds the storage and the token, session and one-time-code rules.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import type { TenantScope } from './db';

/** Link-bound session cookie (Sam 11 §3): `__Host-` so it is Secure, path `/` and never sent to another host. */
export const ACCESS_LINK_COOKIE = '__Host-lnk';
/** Sam 11 §2: default 30 days, at least 1, at most 90. */
export const ACCESS_LINK_DEFAULT_DAYS = 30;
export const ACCESS_LINK_MAX_DAYS = 90;
/** Sam 11 §3: the session a browser holds on one link. */
export const ACCESS_LINK_SESSION_MS = 12 * 60 * 60 * 1000;
/** Sam 11 §3 and §6: 6 digits, valid 10 minutes, 5 attempts; 3 sends per link session an hour, 10 per destination a day. */
export const ACCESS_LINK_CODE_MS = 10 * 60 * 1000;
export const ACCESS_LINK_CODE_ATTEMPTS = 5;
const CODES_PER_SESSION_HOUR = 3;
const CODES_PER_DESTINATION_DAY = 10;

export interface AccessLink {
  id: string;
  orgId: string;
  projectId: string | null;
  entityType: string;
  entityId: string;
  allowedActions: string[];
  label: string | null;
  recipientEmail: string | null;
  recipientPhone: string | null;
  expiresAt: Date;
  maxUses: number | null;
  useCount: number;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  revokedBy: string | null;
  createdBy: string;
  createdAt: Date;
  version: number;
}

export interface AccessLinkSession {
  id: string;
  orgId: string;
  linkId: string;
  verifiedAt: Date | null;
  verifiedChannel: 'sms' | 'email' | null;
  verifiedTo: string | null;
  subjectType: string | null;
  subjectId: string | null;
  expiresAt: Date;
}

export type AccessLinkState = 'active' | 'expired' | 'revoked' | 'used_up';

// ------------------------------------------------------------------------------------------------ tokens

type TokenPrefix = 'arl' | 'lns';

/**
 * `arl_` (link) or `lns_` (session) + base64url(org id, 16 bytes ‖ 32 random bytes). The 256 random bits are the
 * secret; the org id in front only says which tenant to look in, so the lookup runs under that org's RLS and no
 * cross-tenant index is needed. Forging the org part finds nothing.
 */
function newToken(prefix: TokenPrefix, orgId: string): string {
  const org = Buffer.from(orgId.replace(/-/g, ''), 'hex');
  return `${prefix}_${Buffer.concat([org, randomBytes(32)]).toString('base64url')}`;
}

/** The org a token belongs to, or null when it isn't one of ours. */
export function accessTokenOrg(token: string, prefix: TokenPrefix = 'arl'): string | null {
  if (!token.startsWith(`${prefix}_`)) return null;
  const raw = Buffer.from(token.slice(4), 'base64url');
  if (raw.length !== 48 || raw.toString('base64url') !== token.slice(4)) return null;
  const hex = raw.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

// ------------------------------------------------------------------------------------------------- links

type Row = Record<string, unknown>;
const date = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string));

function toLink(r: Row): AccessLink {
  return {
    id: r.id as string,
    orgId: r.org_id as string,
    projectId: (r.project_id as string | null) ?? null,
    entityType: r.entity_type as string,
    entityId: r.entity_id as string,
    allowedActions: r.allowed_actions as string[],
    label: (r.label as string | null) ?? null,
    recipientEmail: (r.recipient_email as string | null) ?? null,
    recipientPhone: (r.recipient_phone as string | null) ?? null,
    expiresAt: date(r.expires_at)!,
    maxUses: (r.max_uses as number | null) ?? null,
    useCount: Number(r.use_count),
    lastUsedAt: date(r.last_used_at),
    revokedAt: date(r.revoked_at),
    revokedBy: (r.revoked_by as string | null) ?? null,
    createdBy: r.created_by as string,
    createdAt: date(r.created_at)!,
    version: Number(r.version),
  };
}

function toSession(r: Row): AccessLinkSession {
  return {
    id: r.id as string,
    orgId: r.org_id as string,
    linkId: r.link_id as string,
    verifiedAt: date(r.verified_at),
    verifiedChannel: (r.verified_channel as 'sms' | 'email' | null) ?? null,
    verifiedTo: (r.verified_to as string | null) ?? null,
    subjectType: (r.subject_type as string | null) ?? null,
    subjectId: (r.subject_id as string | null) ?? null,
    expiresAt: date(r.expires_at)!,
  };
}

export function accessLinkState(link: AccessLink, now: Date): AccessLinkState {
  if (link.revokedAt) return 'revoked';
  if (link.expiresAt <= now) return 'expired';
  if (link.maxUses !== null && link.useCount >= link.maxUses) return 'used_up';
  return 'active';
}

export interface NewAccessLink {
  projectId: string | null;
  entityType: string;
  entityId: string;
  allowedActions: readonly string[];
  label?: string | null;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  expiresAt: Date;
  maxUses?: number | null;
}

/** Creates a link; the caller has checked the creator holds the permission the link stands in for (Sam 11 §2). */
export async function createAccessLink(
  scope: TenantScope,
  input: NewAccessLink,
): Promise<{ link: AccessLink; token: string }> {
  const token = newToken('arl', scope.ctx.orgId);
  const res = await scope.tx.execute(sql`
    insert into shared.access_links
      (id, org_id, project_id, entity_type, entity_id, allowed_actions, label, recipient_email, recipient_phone,
       token_hash, expires_at, max_uses, created_by)
    values (${uuidv7()}, ${scope.ctx.orgId}, ${input.projectId}, ${input.entityType}, ${input.entityId},
            array[${sql.join(
              input.allowedActions.map((a) => sql`${a}`),
              sql`, `,
            )}]::text[],
            ${input.label ?? null}, ${input.recipientEmail ?? null}, ${input.recipientPhone ?? null},
            ${hash(token)}, ${input.expiresAt.toISOString()}, ${input.maxUses ?? null}, ${scope.ctx.userId})
    returning *`);
  return { link: toLink(res.rows[0] as Row), token };
}

export async function listAccessLinks(
  scope: TenantScope,
  entityType: string,
  entityId: string,
): Promise<AccessLink[]> {
  const res = await scope.tx.execute(sql`
    select * from shared.access_links
    where entity_type = ${entityType} and entity_id = ${entityId}
    order by created_at desc, id desc
    limit 200`);
  return res.rows.map((r) => toLink(r as Row));
}

export async function getAccessLink(
  scope: TenantScope,
  linkId: string,
): Promise<AccessLink | null> {
  const res = await scope.tx.execute(
    sql`select * from shared.access_links where id = ${linkId} limit 1`,
  );
  return res.rows[0] ? toLink(res.rows[0] as Row) : null;
}

/** Takes effect on the next request (Sam 11 §5). Revoking twice keeps the first time. */
export async function revokeAccessLink(scope: TenantScope, linkId: string): Promise<AccessLink> {
  const res = await scope.tx.execute(sql`
    update shared.access_links
    set revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, ${scope.ctx.userId}),
        version = version + case when revoked_at is null then 1 else 0 end
    where id = ${linkId}
    returning *`);
  return toLink(res.rows[0] as Row);
}

/** The link for a token, in any state; the scope must be the token's org (`accessTokenOrg`). */
export async function findAccessLink(
  scope: TenantScope,
  token: string,
): Promise<AccessLink | null> {
  const res = await scope.tx.execute(
    sql`select * from shared.access_links where token_hash = ${hash(token)} limit 1`,
  );
  return res.rows[0] ? toLink(res.rows[0] as Row) : null;
}

/** Counts one opening of the link against `max_uses`. */
export async function countAccessLinkUse(scope: TenantScope, linkId: string): Promise<void> {
  await scope.tx.execute(sql`
    update shared.access_links set use_count = use_count + 1, last_used_at = now() where id = ${linkId}`);
}

// ---------------------------------------------------------------------------------------------- sessions

export async function openAccessLinkSession(
  scope: TenantScope,
  link: AccessLink,
  facts: { ip: string | null; userAgent: string | null; now: Date },
): Promise<{ session: AccessLinkSession; token: string }> {
  const token = newToken('lns', scope.ctx.orgId);
  const expiresAt = new Date(
    Math.min(facts.now.getTime() + ACCESS_LINK_SESSION_MS, link.expiresAt.getTime()),
  );
  const res = await scope.tx.execute(sql`
    insert into shared.access_link_sessions (id, org_id, link_id, token_hash, ip, user_agent, expires_at)
    values (${uuidv7()}, ${scope.ctx.orgId}, ${link.id}, ${hash(token)}, ${facts.ip},
            ${facts.userAgent?.slice(0, 500) ?? null}, ${expiresAt.toISOString()})
    returning *`);
  return { session: toSession(res.rows[0] as Row), token };
}

/** The session and its link for a cookie value; null when unknown or past its 12 hours. */
export async function findAccessLinkSession(
  scope: TenantScope,
  token: string,
  now: Date,
): Promise<{ session: AccessLinkSession; link: AccessLink } | null> {
  const res = await scope.tx.execute(sql`
    select s.*, to_jsonb(l.*) as link from shared.access_link_sessions s
    join shared.access_links l on l.id = s.link_id
    where s.token_hash = ${hash(token)}
    limit 1`);
  const row = res.rows[0] as Row | undefined;
  if (!row) return null;
  const session = toSession(row);
  if (session.expiresAt <= now) return null;
  return { session, link: toLink(row.link as Row) };
}

/** Records what the verified person became in the owning module (the workforce worker for an induction). */
export async function bindAccessLinkSession(
  scope: TenantScope,
  sessionId: string,
  subject: { type: string; id: string },
): Promise<void> {
  await scope.tx.execute(sql`
    update shared.access_link_sessions set subject_type = ${subject.type}, subject_id = ${subject.id}
    where id = ${sessionId}`);
}

// ----------------------------------------------------------------------------------------- one-time codes

export type IssueCodeResult =
  { ok: true; code: string; expiresAt: Date } | { ok: false; reason: 'too_many_codes' };

/** A new 6-digit code for the session; the caller sends it. Earlier codes for the session stop working. */
export async function issueAccessLinkCode(
  scope: TenantScope,
  session: AccessLinkSession,
  input: { channel: 'sms' | 'email'; destination: string; now: Date },
): Promise<IssueCodeResult> {
  const hourAgo = new Date(input.now.getTime() - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(input.now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const counts = await scope.tx.execute<{ session: string; destination: string }>(sql`
    select
      count(*) filter (where session_id = ${session.id} and created_at > ${hourAgo}) as session,
      count(*) filter (where destination = ${input.destination} and created_at > ${dayAgo}) as destination
    from shared.access_link_codes
    where session_id = ${session.id} or destination = ${input.destination}`);
  const c = counts.rows[0]!;
  if (
    Number(c.session) >= CODES_PER_SESSION_HOUR ||
    Number(c.destination) >= CODES_PER_DESTINATION_DAY
  )
    return { ok: false, reason: 'too_many_codes' };
  await scope.tx.execute(sql`
    update shared.access_link_codes set used_at = ${input.now.toISOString()}
    where session_id = ${session.id} and used_at is null`);
  const id = uuidv7();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = new Date(input.now.getTime() + ACCESS_LINK_CODE_MS);
  await scope.tx.execute(sql`
    insert into shared.access_link_codes (id, org_id, session_id, channel, destination, code_hash, expires_at)
    values (${id}, ${scope.ctx.orgId}, ${session.id}, ${input.channel}, ${input.destination},
            ${hash(`${id}:${code}`)}, ${expiresAt.toISOString()})`);
  return { ok: true, code, expiresAt };
}

export type VerifyCodeResult =
  { ok: true; session: AccessLinkSession } | { ok: false; reason: 'code_invalid' | 'code_expired' };

/**
 * Checks a code against the session's latest one. Returns the outcome rather than throwing, so a failed attempt
 * is counted when the caller commits; the caller raises the problem afterwards.
 */
export async function verifyAccessLinkCode(
  scope: TenantScope,
  session: AccessLinkSession,
  input: { code: string; now: Date },
): Promise<VerifyCodeResult> {
  const res = await scope.tx.execute<{
    id: string;
    channel: 'sms' | 'email';
    destination: string;
    code_hash: string;
    attempts: number;
    expires_at: string;
  }>(sql`
    select id, channel, destination, code_hash, attempts, expires_at from shared.access_link_codes
    where session_id = ${session.id} and used_at is null
    order by created_at desc limit 1
    for update`);
  const c = res.rows[0];
  if (!c || new Date(c.expires_at) <= input.now || c.attempts >= ACCESS_LINK_CODE_ATTEMPTS)
    return { ok: false, reason: 'code_expired' };
  const given = Buffer.from(hash(`${c.id}:${input.code.trim()}`));
  if (!timingSafeEqual(given, Buffer.from(c.code_hash))) {
    await scope.tx.execute(
      sql`update shared.access_link_codes set attempts = attempts + 1 where id = ${c.id}`,
    );
    return {
      ok: false,
      reason: c.attempts + 1 >= ACCESS_LINK_CODE_ATTEMPTS ? 'code_expired' : 'code_invalid',
    };
  }
  await scope.tx.execute(
    sql`update shared.access_link_codes set used_at = ${input.now.toISOString()} where id = ${c.id}`,
  );
  const updated = await scope.tx.execute(sql`
    update shared.access_link_sessions
    set verified_at = ${input.now.toISOString()}, verified_channel = ${c.channel}, verified_to = ${c.destination}
    where id = ${session.id}
    returning *`);
  return { ok: true, session: toSession(updated.rows[0] as Row) };
}
