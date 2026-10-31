'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Alert, Spinner } from '@archova/ui';
import { webRoutes } from '@archova/routes';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { createAccountingApi, PROVIDER_NAME, type Provider } from '../data/api';

/** Where the settings screen left the org before sending the admin to the provider. */
export const RETURN_KEY = 'archova.accounting.return';
export interface ReturnTo {
  orgId: string;
  orgSlug: string;
}

/** The page Xero or MYOB sends the admin back to (integrations/02 §7). It finishes the sign-in, then returns to Settings. */
export function AccountingCallbackScreen({ provider }: { provider: Provider }) {
  const router = useRouter();
  const params = useSearchParams();
  const started = useRef(false);
  const [error, setError] = useState<unknown>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    // Strict mode runs effects twice; the code is single use.
    if (started.current) return;
    started.current = true;
    let back: ReturnTo | null = null;
    try {
      back = JSON.parse(window.sessionStorage.getItem(RETURN_KEY) ?? 'null') as ReturnTo | null;
    } catch {
      back = null;
    }
    const code = params.get('code');
    const state = params.get('state');
    if (!back || !code || !state) {
      setMissing(true);
      return;
    }
    createAccountingApi(back.orgId)
      .complete(provider, { code, state })
      .then(() => {
        window.sessionStorage.removeItem(RETURN_KEY);
        router.replace(webRoutes.accounting(back.orgSlug));
      })
      .catch(setError);
  }, [params, provider, router]);

  const name = PROVIDER_NAME[provider];
  if (error) return <ErrorAlert error={error} title={`Could not connect ${name}`} />;
  if (missing)
    return (
      <Alert tone="warning" title="This sign-in link is no longer valid">
        Open Settings → Accounting and choose Connect {name} again.
      </Alert>
    );
  return (
    <p>
      <Spinner label={`Connecting ${name}`} /> Connecting {name}…
    </p>
  );
}
