import type { PlatformApi } from '@archova/mod-platform';

export interface PreconDeps {
  platform: Pick<PlatformApi, 'companyExists'>;
  now?: () => Date;
}

/** Orgs carry no time zone yet; expiry follows the Sydney calendar day until they do (same as the wallet). */
export const PRECON_TIME_ZONE = 'Australia/Sydney';
