import { readJson, type FetchLike } from './http';
import type { AccountingProviderName } from './types';

export interface RemoteTarget {
  ref: string;
  name: string;
}

// After sign-in the admin picks which Xero organisation or MYOB company file this connection covers
// (integrations/02 §4, §5). Exactly one choice is picked automatically by the caller.
export async function listTargets(
  provider: AccountingProviderName,
  fetchFn: FetchLike,
  accessToken: string,
  myobApiKey = '',
): Promise<RemoteTarget[]> {
  if (provider === 'xero') {
    const res = (await readJson(
      'xero',
      await fetchFn('https://api.xero.com/connections', {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      }),
    )) as { tenantId: string; tenantName?: string; tenantType?: string }[];
    return res
      .filter((t) => !t.tenantType || t.tenantType === 'ORGANISATION')
      .map((t) => ({ ref: t.tenantId, name: t.tenantName ?? t.tenantId }));
  }
  const res = (await readJson(
    'myob',
    await fetchFn('https://api.myob.com/accountright/', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'x-myobapi-key': myobApiKey,
        'x-myobapi-version': 'v2',
        Accept: 'application/json',
      },
    }),
  )) as { Id: string; Name: string; Uri?: string }[];
  return res.map((f) => ({ ref: f.Id, name: f.Name }));
}
