import { encodeId } from '@archova/domain';
import type { User } from '@archova/contracts';
import type { UserRecord } from '../application/accounts';

export const toUserDto = (u: UserRecord): User => ({
  id: encodeId('user', u.id),
  email: u.email,
  name: u.name,
  locale: u.locale,
  timezone: u.timezone,
});
