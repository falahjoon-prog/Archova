'use client';

import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  PageHeader,
  SkeletonRows,
  StatusPill,
  TextField,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { isApiError } from '@/shared/lib/errors';
import { formatInstant } from '@/shared/lib/format';
import { sessionQuery } from '@/shared/providers/session';
import {
  useAppInstalls,
  useConfirmPassword,
  useCreateOauthApp,
  useOauthApps,
  useRemoveInstall,
  useRotateSecret,
} from '../hooks/usePartnerApps';

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const when = (iso: string) => formatInstant(iso, tz());
const scopeLabel = (s: string) => s.replace(':', ' · ');

function Secret({ title, secret, onDone }: { title: string; secret: string; onDone: () => void }) {
  return (
    <Alert tone="success" title={title}>
      <div className="stack">
        <p className="u-m-0">Copy it now. It cannot be shown again.</p>
        <code className="api-access__secret">{secret}</code>
        <div>
          <Button variant="secondary" onClick={onDone}>
            I have saved it
          </Button>
        </div>
      </div>
    </Alert>
  );
}

function InstallsCard() {
  const installs = useAppInstalls();
  const remove = useRemoveInstall();
  const [confirming, setConfirming] = useState<string | null>(null);
  if (installs.isPending) return <SkeletonRows rows={3} label="Loading installed apps…" />;
  if (installs.isError) return <ErrorAlert error={installs.error} title="We couldn't load apps" />;
  const live = installs.data.filter((i) => !i.revokedAt);
  return (
    <Card title="Installed apps">
      <div className="stack">
        <p className="u-muted">
          An installed app can read and change what its scopes allow, as the person who approved it.
          Removing it stops its access on the next request.
        </p>
        {live.length ? (
          <ul className="api-access__list">
            {live.map((i) => (
              <li key={i.id} className="api-access__row">
                <span>
                  <strong>{i.appName}</strong>
                </span>
                <span className="u-caption">
                  {i.scopes.map(scopeLabel).join(', ')} · installed {when(i.createdAt)}
                  {i.lastUsedAt ? ` · last used ${when(i.lastUsedAt)}` : ' · never used'}
                </span>
                {confirming === i.id ? (
                  <div className="consent__actions">
                    <Button
                      variant="danger"
                      loading={remove.isPending}
                      onClick={() => remove.mutate(i.id, { onSuccess: () => setConfirming(null) })}
                    >
                      Yes, remove {i.appName}
                    </Button>
                    <Button variant="tertiary" onClick={() => setConfirming(null)}>
                      Keep it
                    </Button>
                  </div>
                ) : (
                  <div>
                    <Button variant="danger" onClick={() => setConfirming(i.id)}>
                      Remove {i.appName}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="u-muted">No apps are installed.</p>
        )}
        {remove.isError ? (
          <ErrorAlert error={remove.error} title="We couldn't remove the app" />
        ) : null}
      </div>
    </Card>
  );
}

function AppsCard() {
  const apps = useOauthApps();
  const create = useCreateOauthApp();
  const rotate = useRotateSecret();
  const confirm = useConfirmPassword();
  const session = useQuery(sessionQuery);
  const [name, setName] = useState('');
  const [redirect, setRedirect] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const stepUp = [create.error, rotate.error].some(
    (e) => isApiError(e) && e.code === 'auth.step_up_required',
  );

  const submitCreate = () =>
    create.mutate(
      { name: name.trim(), redirectUris: [redirect.trim()], scopes },
      {
        onSuccess: (a) => {
          setSecret({ title: `Client secret for ${a.name}`, value: a.clientSecret });
          setName('');
          setRedirect('');
          setScopes([]);
          setRetry(null);
        },
      },
    );
  const submitRotate = (clientId: string, appName: string) =>
    rotate.mutate(clientId, {
      onSuccess: (r) => {
        setSecret({ title: `New client secret for ${appName}`, value: r.clientSecret });
        setRetry(null);
      },
    });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim() || !redirect.trim() || !scopes.length) return;
    setRetry(() => submitCreate);
    submitCreate();
  }
  function onConfirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = session.data?.user.email;
    if (!email || !password) return;
    confirm.mutate(
      { email, password },
      {
        onSuccess: () => {
          setPassword('');
          retry?.();
        },
      },
    );
  }
  const toggle = (s: string) =>
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  if (apps.isPending) return <SkeletonRows rows={3} label="Loading apps…" />;
  if (apps.isError) return <ErrorAlert error={apps.error} title="We couldn't load apps" />;

  return (
    <Card title="Your apps">
      <div className="stack">
        <p className="u-muted">
          Register an app your team or a developer builds. It can only be installed in this company,
          and you decide what it may do when you approve it.
        </p>
        {secret ? (
          <Secret title={secret.title} secret={secret.value} onDone={() => setSecret(null)} />
        ) : null}
        {apps.data.data.length ? (
          <ul className="api-access__list">
            {apps.data.data.map((a) => (
              <li key={a.clientId} className="api-access__row">
                <span>
                  <strong>{a.name}</strong> <span className="u-caption">{a.clientId}</span>
                </span>
                <span className="u-caption">
                  {a.scopes.map(scopeLabel).join(', ')} · {a.redirectUris.join(', ')}
                </span>
                <div>
                  <Button
                    variant="secondary"
                    loading={rotate.isPending}
                    onClick={() => {
                      setRetry(() => () => submitRotate(a.clientId, a.name));
                      submitRotate(a.clientId, a.name);
                    }}
                  >
                    New secret for {a.name}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="u-muted">No apps registered.</p>
        )}
        {rotate.isError && !stepUp ? (
          <ErrorAlert error={rotate.error} title="We couldn't replace the secret" />
        ) : null}

        {stepUp ? (
          <form className="stack" onSubmit={onConfirm} noValidate>
            <Alert tone="warning" title="Confirm it's you">
              Enter your password to continue.
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
                Confirm and continue
              </Button>
            </div>
          </form>
        ) : (
          <form className="stack" onSubmit={onSubmit} noValidate>
            <TextField
              label="App name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required
            />
            <TextField
              label="Redirect address"
              hint="Where Archova sends people after they approve. Must be a full https address."
              value={redirect}
              onChange={(e) => setRedirect(e.target.value)}
              inputMode="url"
              required
            />
            <fieldset className="api-access__scopes">
              <legend>What it may ask for</legend>
              {apps.data.availableScopes.map((s) => (
                <Checkbox
                  key={s}
                  label={scopeLabel(s)}
                  checked={scopes.includes(s)}
                  onChange={() => toggle(s)}
                />
              ))}
            </fieldset>
            {create.isError ? (
              <ErrorAlert error={create.error} title="We couldn't register the app" />
            ) : null}
            <div>
              <Button
                type="submit"
                loading={create.isPending}
                disabled={!name.trim() || !redirect.trim() || !scopes.length}
              >
                Register app
              </Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}

/** Settings → Apps (integrations/06 §4): private partner apps and what is installed. */
export function AppsScreen() {
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Apps"
        description="Apps that connect to Archova on your company's behalf."
        actions={<StatusPill tone="info">Owners and admins</StatusPill>}
      />
      <div className="stack">
        <InstallsCard />
        <AppsCard />
      </div>
    </>
  );
}
