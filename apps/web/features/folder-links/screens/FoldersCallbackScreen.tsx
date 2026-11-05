'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Alert, Spinner } from '@archova/ui';
import { webRoutes } from '@archova/routes';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { createFoldersApi, PROVIDER_NAME, type Provider } from '../data/api';

/** Where the settings screen left the org before sending the admin to Google or Microsoft. */
export const RETURN_KEY = 'archova.folders.return';
export interface ReturnTo {
  orgId: string;
  orgSlug: string;
}

/**
 * The page Google (sign-in) or Microsoft (admin consent) sends the admin back to. Google returns a `code`; Microsoft
 * returns `admin_consent=True` and the tenant, and an `error` when the admin declined.
 */
export function FoldersCallbackScreen({ provider }: { provider: Provider }) {
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
    const declined = params.get('error') || params.get('admin_consent') === 'False';
    if (!back || !state || declined || (provider === 'google' && !code)) {
      setMissing(true);
      return;
    }
    createFoldersApi(back.orgId)
      .complete(provider, { state, ...(code ? { code } : {}) })
      .then(() => {
        window.sessionStorage.removeItem(RETURN_KEY);
        router.replace(webRoutes.folders(back.orgSlug));
      })
      .catch(setError);
  }, [params, provider, router]);

  const name = PROVIDER_NAME[provider];
  if (error) return <ErrorAlert error={error} title={`Could not connect ${name}`} />;
  if (missing)
    return (
      <Alert tone="warning" title="This sign-in did not finish">
        Open Settings → SharePoint and Drive and choose Connect again. For Microsoft, an
        administrator of the organisation has to approve access.
      </Alert>
    );
  return (
    <p>
      <Spinner label={`Connecting ${name}`} /> Connecting {name}…
    </p>
  );
}
