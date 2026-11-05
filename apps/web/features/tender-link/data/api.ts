import { ApiError, unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

export type TenderAccess = components['schemas']['TenderAccess'];
export type TenderResponse = components['schemas']['RespondTenderAccessRequest']['response'];

export type LinkResult = { state: 'open'; access: TenderAccess } | { state: 'expired' };

const dead = (e: unknown) => e instanceof ApiError && [401, 410, 422].includes(e.status);

// The token is exchanged once for the `__Host-lnk` cookie; no call carries it afterwards.
export const tenderLinkApi = {
  async open(token: string): Promise<LinkResult> {
    try {
      const access =
        token === 'continue'
          ? unwrap(await api.GET('/v1/tender-access'))
          : unwrap(await api.POST('/v1/tender-access', { body: { token } }));
      return { state: 'open', access };
    } catch (e) {
      // An expired, revoked or unknown link, or a tender that has closed, all look the same, by design.
      if (dead(e)) return { state: 'expired' };
      throw e;
    }
  },
  async respond(response: TenderResponse): Promise<TenderAccess> {
    return unwrap(await api.POST('/v1/tender-access/respond', { body: { response } }));
  },
};
