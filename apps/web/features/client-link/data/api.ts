import { ApiError, unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

export type ClientView = components['schemas']['OwnerPortalAccess'];

export type LinkResult = { state: 'open'; view: ClientView } | { state: 'expired' };

const dead = (e: unknown) => e instanceof ApiError && [401, 410, 422].includes(e.status);

// The token is exchanged once for the `__Host-opk` cookie; no call carries it afterwards.
export const clientLinkApi = {
  async open(token: string): Promise<LinkResult> {
    try {
      const view =
        token === 'continue'
          ? unwrap(await api.GET('/v1/owner-portal-access'))
          : unwrap(await api.POST('/v1/owner-portal-access', { body: { token } }));
      return { state: 'open', view };
    } catch (e) {
      // An expired, revoked or unknown link all look the same, by design.
      if (dead(e)) return { state: 'expired' };
      throw e;
    }
  },
};
