import { boolean, customType, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const citext = customType<{ data: string }>({ dataType: () => 'citext' });

export const identity = pgSchema('identity');

export const users = identity.table('users', {
  id: uuid('id').primaryKey(),
  email: citext('email').notNull(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  name: text('name').notNull(),
  phone: text('phone'),
  avatarFileId: uuid('avatar_file_id'),
  locale: text('locale').notNull(),
  timezone: text('timezone'),
  status: text('status').$type<'active' | 'disabled'>().notNull(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const credentials = identity.table('credentials', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  type: text('type').$type<'password' | 'totp' | 'passkey'>().notNull(),
  secretHash: text('secret_hash'),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = identity.table('sessions', {
  id: uuid('id').primaryKey(),
  tokenHash: bytea('token_hash'),
  userId: uuid('user_id').notNull(),
  client: text('client').$type<'web' | 'ios' | 'android' | 'api'>().notNull(),
  authMethod: text('auth_method').$type<'password' | 'passkey' | 'sso' | 'oauth'>().notNull(),
  authTime: timestamp('auth_time', { withTimezone: true }).notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  deviceName: text('device_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true }).notNull(),
  absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const refreshTokens = identity.table('refresh_tokens', {
  id: uuid('id').primaryKey(),
  sessionId: uuid('session_id').notNull(),
  tokenHash: bytea('token_hash').notNull(),
  familyId: uuid('family_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const oauthClients = identity.table('oauth_clients', {
  id: uuid('id').primaryKey(),
  clientId: text('client_id').notNull(),
  name: text('name').notNull(),
  clientSecretHash: text('client_secret_hash'),
  firstParty: boolean('first_party').notNull(),
  redirectUris: text('redirect_uris').array().notNull(),
  scopes: text('scopes').array().notNull(),
  ownerOrgId: uuid('owner_org_id'),
});

export const oauthCodes = identity.table('oauth_codes', {
  codeHash: bytea('code_hash').primaryKey(),
  clientId: text('client_id').notNull(),
  userId: uuid('user_id').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  authMethod: text('auth_method').$type<'password' | 'passkey' | 'sso' | 'oauth'>().notNull(),
  authTime: timestamp('auth_time', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
});
