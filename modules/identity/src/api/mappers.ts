import { encodeId } from '@archova/domain';
import type { ApiToken, User } from '@archova/contracts';
import type { UserRecord } from '../application/accounts';
import type { ApiTokenRow } from '../application/api-tokens';

export const toUserDto = (u: UserRecord): User => ({
  id: encodeId('user', u.id),
  email: u.email,
  name: u.name,
  locale: u.locale,
  timezone: u.timezone,
});

export const toApiTokenDto = (t: ApiTokenRow): ApiToken => ({
  id: encodeId('apiToken', t.id),
  userId: encodeId('user', t.userId),
  name: t.name,
  prefix: t.prefix,
  scopes: t.scopes,
  expiresAt: t.expiresAt.toISOString(),
  lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
  revokedAt: t.revokedAt?.toISOString() ?? null,
  createdAt: t.createdAt.toISOString(),
});
