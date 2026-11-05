import { createHash, randomBytes } from 'node:crypto';
import { hash, verify, type Algorithm } from '@node-rs/argon2';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { STAFF_ROLES, type StaffDto, type StaffRole } from '@archova/contracts';
import { uuidv7 } from '@archova/domain';
import { AppError, type KernelServices } from '@archova/kernel';
import { permissionsFor } from '../permissions';
import { staffRoleAssignments, staffSessions, staffUsers } from '../infra/tables';

export const SESSION_ABSOLUTE_MS = 8 * 3_600_000;
export const SESSION_IDLE_MS = 30 * 60_000;
export const STEP_UP_MS = 5 * 60_000;
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60_000;

// Argon2id like customer passwords (security-licensing/01 §4); 2 is Argon2id.
const ARGON2ID = 2 as Algorithm;
const OPTIONS = { algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
export const hashStaffPassword = (password: string) => hash(password, OPTIONS);
const verifyStaffPassword = (stored: string, password: string) =>
  verify(stored, password).catch(() => false);

const sha256 = (s: string) => createHash('sha256').update(s).digest();

export interface StaffContext {
  staffId: string;
  sessionId: string;
  email: string;
  name: string;
  roles: StaffRole[];
  permissions: string[];
  authTime: Date;
  /** True when this sign-in used a hardware security key (set by the staff IdP, never by password login). */
  hardwareKey: boolean;
}

export interface StaffDeps extends Pick<KernelServices, 'database'> {
  /** Local password sign-in is for local runs and the demo cell; hosted staff use the staff IdP. */
  localLogin: boolean;
  now?: () => Date;
}

export function createStaffService(deps: StaffDeps) {
  const { database } = deps;
  const now = deps.now ?? (() => new Date());
  const failures = new Map<string, number[]>();
  let dummy: Promise<string> | null = null;
  const dummyHash = () => (dummy ??= hashStaffPassword('archova-staff-dummy-password'));

  const tx = <T>(fn: Parameters<typeof database.withGlobalTx<T>>[1]) =>
    database.withGlobalTx('backoffice', fn);

  function throttled(email: string) {
    const cutoff = now().getTime() - FAILURE_WINDOW_MS;
    const recent = (failures.get(email) ?? []).filter((t) => t > cutoff);
    failures.set(email, recent);
    return recent.length >= MAX_FAILURES;
  }

  async function rolesOf(t: Parameters<Parameters<typeof tx>[0]>[0], id: string) {
    const rows = await t
      .select({ role: staffRoleAssignments.role })
      .from(staffRoleAssignments)
      .where(and(eq(staffRoleAssignments.staffUserId, id), isNull(staffRoleAssignments.revokedAt)));
    return rows.map((r) => r.role as StaffRole).filter((r) => STAFF_ROLES.includes(r));
  }

  async function login(
    email: string,
    password: string,
    meta: { ip: string | null; userAgent: string | null },
  ) {
    if (!deps.localLogin)
      throw new AppError('backoffice.local_login_disabled', 'Sign in through the staff IdP.');
    const key = email.toLowerCase();
    if (throttled(key))
      throw new AppError('rate_limited', 'Too many sign-in attempts. Try again in 15 minutes.');
    return tx(async (t) => {
      const [user] = await t.select().from(staffUsers).where(eq(staffUsers.email, key));
      const ok =
        user && user.status === 'active' && user.passwordHash
          ? await verifyStaffPassword(user.passwordHash, password)
          : (await verifyStaffPassword(await dummyHash(), password), false);
      if (!ok || !user) {
        failures.set(key, [...(failures.get(key) ?? []), now().getTime()]);
        throw new AppError('auth.invalid_credentials', 'Email or password is incorrect.');
      }
      failures.delete(key);
      const token = randomBytes(32).toString('base64url');
      const at = now();
      await t.insert(staffSessions).values({
        id: uuidv7(),
        staffUserId: user.id,
        tokenHash: sha256(token),
        authTime: at,
        createdAt: at,
        lastSeenAt: at,
        expiresAt: new Date(at.getTime() + SESSION_ABSOLUTE_MS),
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
      });
      return { token, maxAgeSeconds: SESSION_ABSOLUTE_MS / 1000 };
    });
  }

  /** The staff session behind a cookie token, or null when it is unknown, expired, idle too long or revoked. */
  async function resolve(token: string): Promise<StaffContext | null> {
    return tx(async (t) => {
      const [row] = await t
        .select({ s: staffSessions, u: staffUsers })
        .from(staffSessions)
        .innerJoin(staffUsers, eq(staffUsers.id, staffSessions.staffUserId))
        .where(eq(staffSessions.tokenHash, sha256(token)));
      if (!row || row.s.revokedAt || row.u.status !== 'active') return null;
      const at = now();
      if (row.s.expiresAt <= at || at.getTime() - row.s.lastSeenAt.getTime() > SESSION_IDLE_MS)
        return null;
      await t.update(staffSessions).set({ lastSeenAt: at }).where(eq(staffSessions.id, row.s.id));
      const roles = await rolesOf(t, row.u.id);
      return {
        staffId: row.u.id,
        sessionId: row.s.id,
        email: row.u.email,
        name: row.u.name,
        roles,
        permissions: permissionsFor(roles),
        authTime: row.s.authTime,
        hardwareKey: row.s.hardwareKey,
      };
    });
  }

  async function logout(sessionId: string) {
    await tx((t) =>
      t.update(staffSessions).set({ revokedAt: now() }).where(eq(staffSessions.id, sessionId)),
    );
  }

  /** Proves the password again so approvals and other sensitive actions are tied to the person at the keyboard. */
  async function stepUp(staff: StaffContext, password: string) {
    if (!deps.localLogin)
      throw new AppError('backoffice.local_login_disabled', 'Step up through the staff IdP.');
    if (throttled(staff.email.toLowerCase()))
      throw new AppError('rate_limited', 'Too many attempts. Try again in 15 minutes.');
    await tx(async (t) => {
      const [user] = await t.select().from(staffUsers).where(eq(staffUsers.id, staff.staffId));
      const ok = user?.passwordHash
        ? await verifyStaffPassword(user.passwordHash, password)
        : false;
      if (!ok) {
        const k = staff.email.toLowerCase();
        failures.set(k, [...(failures.get(k) ?? []), now().getTime()]);
        throw new AppError('auth.invalid_credentials', 'Password is incorrect.');
      }
      await t
        .update(staffSessions)
        .set({ authTime: now() })
        .where(eq(staffSessions.id, staff.sessionId));
    });
  }

  function requireStepUp(staff: StaffContext, authTime: Date = staff.authTime) {
    if (now().getTime() - authTime.getTime() > STEP_UP_MS)
      throw new AppError('auth.step_up_required', 'Confirm your password to continue.');
  }

  function toDto(s: StaffContext): StaffDto {
    const valid = new Date(s.authTime.getTime() + STEP_UP_MS);
    return {
      id: s.staffId,
      email: s.email,
      name: s.name,
      roles: s.roles,
      permissions: s.permissions,
      authTime: s.authTime.toISOString(),
      stepUpValidUntil: valid > now() ? valid.toISOString() : null,
    };
  }

  async function list() {
    return tx(async (t) => {
      const users = await t.select().from(staffUsers).orderBy(asc(staffUsers.name));
      const out = [];
      for (const u of users) {
        const roles = await rolesOf(t, u.id);
        out.push({
          id: u.id,
          email: u.email,
          name: u.name,
          status: u.status,
          roles,
          createdAt: u.createdAt.toISOString(),
        });
      }
      return out;
    });
  }

  /** Creates or updates a staff account with a password and roles. Used by the seed command, never by a route. */
  async function upsertLocal(input: {
    email: string;
    name: string;
    password: string;
    roles: StaffRole[];
  }) {
    const passwordHash = await hashStaffPassword(input.password);
    return tx(async (t) => {
      const email = input.email.toLowerCase();
      const [existing] = await t.select().from(staffUsers).where(eq(staffUsers.email, email));
      const id = existing?.id ?? uuidv7();
      if (existing)
        await t
          .update(staffUsers)
          .set({ name: input.name, passwordHash, status: 'active', disabledAt: null })
          .where(eq(staffUsers.id, id));
      else await t.insert(staffUsers).values({ id, email, name: input.name, passwordHash });
      const have = new Set(await rolesOf(t, id));
      for (const role of input.roles)
        if (!have.has(role))
          await t
            .insert(staffRoleAssignments)
            .values({ id: uuidv7(), staffUserId: id, role, grantedBy: id });
      return id;
    });
  }

  /** Staff who could approve a pricing request other than `exceptId` (solo-owner mode applies when none). */
  async function otherApprovers(exceptId: string): Promise<number> {
    return tx(async (t) => {
      const rows = await t
        .select({ id: staffUsers.id, role: staffRoleAssignments.role })
        .from(staffRoleAssignments)
        .innerJoin(staffUsers, eq(staffUsers.id, staffRoleAssignments.staffUserId))
        .where(and(isNull(staffRoleAssignments.revokedAt), eq(staffUsers.status, 'active')));
      return new Set(
        rows
          .filter((r) => r.id !== exceptId && ['owner', 'pricing_approver'].includes(r.role))
          .map((r) => r.id),
      ).size;
    });
  }

  return {
    login,
    resolve,
    logout,
    stepUp,
    requireStepUp,
    toDto,
    list,
    upsertLocal,
    otherApprovers,
  };
}

export type StaffService = ReturnType<typeof createStaffService>;
