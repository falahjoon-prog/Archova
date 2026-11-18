'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Card, PageHeader, SkeletonRows, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { isApiError } from '@/shared/lib/errors';
import { sessionQuery } from '@/shared/providers/session';
import { useMe } from '@/features/orgs';
import { fetchConsent } from '../data/api';
import { useConfirmPassword, useInstallApp } from '../hooks/usePartnerApps';

const scopeLabel = (s: string) => {
  const [area, level] = s.split(':');
  return `${level === 'write' ? 'Read and change' : 'Read'} ${area}`;
};

/**
 * The page a partner app sends a signed-in person to (`/oauth/consent`). An owner or admin of the company the app
 * belongs to approves it, or turns it down. The page cannot be framed (CSP frame-ancestors), and the approval is a
 * same-origin POST with the CSRF token, so another site cannot click it for them.
 */
export function ConsentScreen() {
  const params = useSearchParams();
  const clientId = params.get('client_id') ?? '';
  const redirectUri = params.get('redirect_uri') ?? '';
  const challenge = params.get('code_challenge') ?? '';
  const state = params.get('state') ?? '';
  const complete = Boolean(clientId && redirectUri && challenge && state);

  const consent = useQuery({
    queryKey: ['oauth-consent', clientId, redirectUri],
    queryFn: () => fetchConsent(clientId, redirectUri),
    enabled: complete,
    retry: false,
  });
  const me = useMe();
  const orgId = consent.data?.ownerOrgId ?? '';
  const install = useInstallApp(orgId);
  const confirm = useConfirmPassword();
  const session = useQuery(sessionQuery);
  const [password, setPassword] = useState('');

  if (!complete)
    return (
      <Alert tone="warning" title="This link is not valid">
        Start again from the app that sent you here.
      </Alert>
    );
  if (consent.isPending || me.isPending) return <SkeletonRows rows={3} label="Loading…" />;
  if (consent.isError) return <ErrorAlert error={consent.error} title="We can't show this app" />;
  if (me.isError) return <ErrorAlert error={me.error} />;

  const c = consent.data;
  const membership = me.data.memberships.find((m) => m.orgId === c.ownerOrgId);
  const canApprove = membership?.role === 'owner' || membership?.role === 'admin';
  const stepUp = isApiError(install.error) && install.error.code === 'auth.step_up_required';

  const approve = () =>
    install.mutate(
      { clientId, redirectUri, codeChallenge: challenge, state, scopes: c.scopes },
      { onSuccess: (url) => window.location.assign(url) },
    );
  const decline = () => {
    const back = new URL(redirectUri);
    back.searchParams.set('error', 'access_denied');
    back.searchParams.set('state', state);
    window.location.assign(back.toString());
  };
  const onConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    const email = session.data?.user.email;
    if (!email || !password) return;
    confirm.mutate(
      { email, password },
      {
        onSuccess: () => {
          setPassword('');
          approve();
        },
      },
    );
  };

  return (
    <>
      <PageHeader
        title={`Allow ${c.name}?`}
        description={`${c.name} wants to connect to ${membership?.orgName ?? 'your company'} on Archova.`}
      />
      <Card>
        <div className="stack">
          {c.description ? <p className="u-m-0">{c.description}</p> : null}
          <div>
            <p className="u-m-0">
              <strong>It will be able to:</strong>
            </p>
            <ul>
              {c.scopes.map((s) => (
                <li key={s}>{scopeLabel(s)}</li>
              ))}
            </ul>
          </div>
          <p className="u-caption u-m-0">
            It acts as you and never does more than you can. Other owners and admins are emailed,
            and you can remove it any time under Settings → Apps.
          </p>
          {!canApprove ? (
            <Alert tone="warning" title="You can't approve this app">
              Only an owner or admin of {membership?.orgName ?? 'the company that made this app'}{' '}
              can approve it.
            </Alert>
          ) : null}
          {install.isError && !stepUp ? (
            <ErrorAlert error={install.error} title="We couldn't approve the app" />
          ) : null}
          {stepUp ? (
            <form className="stack" onSubmit={onConfirm} noValidate>
              <Alert tone="warning" title="Confirm it's you">
                Enter your password to approve this app.
              </Alert>
              <TextField
                label="Password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {confirm.isError ? (
                <ErrorAlert error={confirm.error} title="We couldn't confirm your password" />
              ) : null}
              <div>
                <Button type="submit" disabled={!password || confirm.isPending}>
                  Confirm and approve
                </Button>
              </div>
            </form>
          ) : (
            <div className="consent__actions">
              <Button onClick={approve} loading={install.isPending} disabled={!canApprove}>
                Approve
              </Button>
              <Button variant="tertiary" onClick={decline}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
