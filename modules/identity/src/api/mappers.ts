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

export const toOauthAppDto = (c: {
  clientId: string;
  name: string;
  description: string | null;
  redirectUris: string[];
  scopes: string[];
  disabledAt: Date | null;
}) => ({
  clientId: c.clientId,
  name: c.name,
  description: c.description,
  redirectUris: c.redirectUris,
  scopes: c.scopes,
  disabled: c.disabledAt !== null,
});

export const toAppInstallDto = (i: {
  id: string;
  clientId: string;
  appName: string;
  scopes: string[];
  installedBy: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}) => ({
  id: encodeId('appInstall', i.id),
  clientId: i.clientId,
  appName: i.appName,
  scopes: i.scopes,
  installedBy: encodeId('user', i.installedBy),
  createdAt: i.createdAt.toISOString(),
  lastUsedAt: i.lastUsedAt?.toISOString() ?? null,
  revokedAt: i.revokedAt?.toISOString() ?? null,
});
