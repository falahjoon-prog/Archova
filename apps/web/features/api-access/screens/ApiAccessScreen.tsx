'use client';

import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, Checkbox, SkeletonRows, StatusPill, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { isApiError } from '@/shared/lib/errors';
import { formatInstant } from '@/shared/lib/format';
import { serverFieldErrors } from '@/shared/lib/forms';
import { sessionQuery } from '@/shared/providers/session';
import type { CreateApiToken } from '../data/api';
import {
  useApiTokens,
  useConfirmPassword,
  useCreateApiToken,
  useCreateWebhook,
  useDeleteWebhook,
  useReplayDelivery,
  useRevokeApiToken,
  useWebhookDeliveries,
  useWebhooks,
} from '../hooks/useApiAccess';

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const when = (iso: string) => formatInstant(iso, tz());

/** A secret is shown once; the person copies it before dismissing. */
function SecretOnce({
  title,
  secret,
  onDone,
}: {
  title: string;
  secret: string;
  onDone: () => void;
}) {
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

const scopeLabel = (s: string) => s.replace(':', ' · ');

function TokensCard() {
  const tokens = useApiTokens();
  const create = useCreateApiToken();
  const revoke = useRevokeApiToken();
  const confirm = useConfirmPassword();
  const session = useQuery(sessionQuery);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const server = serverFieldErrors(create.error);
  const stepUp = isApiError(create.error) && create.error.code === 'auth.step_up_required';

  const body = (): CreateApiToken => ({ name: name.trim(), scopes });
  const done = (token: string) => {
    setSecret(token);
    setName('');
    setScopes([]);
    setPassword('');
  };

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim() || !scopes.length) return;
    create.mutate(body(), { onSuccess: (t) => done(t.token) });
  }

  function onConfirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = session.data?.user.email;
    if (!email || !password) return;
    confirm.mutate(
      { email, password },
      { onSuccess: () => create.mutate(body(), { onSuccess: (t) => done(t.token) }) },
    );
  }

  const toggle = (s: string) =>
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  if (tokens.isPending) return <SkeletonRows rows={3} label="Loading access tokens…" />;
  if (tokens.isError)
    return <ErrorAlert error={tokens.error} title="We couldn't load access tokens" />;

  return (
    <Card title="Access tokens">
      <div className="stack">
        <p className="u-muted">
          A token lets another system call the Archova API as you, in this company only. It never
          does more than you can, and you can revoke it at any time. Tokens end after 90 days.
        </p>
        {secret ? (
          <SecretOnce title="Your new token" secret={secret} onDone={() => setSecret(null)} />
        ) : null}

        {tokens.data.data.length ? (
          <ul className="api-access__list">
            {tokens.data.data.map((t) => (
              <li key={t.id} className="api-access__row">
                <span>
                  <strong>{t.name}</strong> <span className="u-caption">{t.prefix}…</span>
                </span>
                <span className="u-caption">
                  {t.scopes.map(scopeLabel).join(', ')} ·{' '}
                  {t.revokedAt
                    ? `Revoked ${when(t.revokedAt)}`
                    : `Expires ${when(t.expiresAt)}${t.lastUsedAt ? ` · last used ${when(t.lastUsedAt)}` : ' · never used'}`}
                </span>
                {t.revokedAt ? (
                  <StatusPill tone="neutral">Revoked</StatusPill>
                ) : (
                  <div>
                    <Button
                      variant="danger"
                      onClick={() => revoke.mutate(t.id)}
                      disabled={revoke.isPending}
                    >
                      Revoke {t.name}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="u-muted">No tokens yet.</p>
        )}
        {revoke.isError ? (
          <ErrorAlert error={revoke.error} title="We couldn't revoke the token" />
        ) : null}

        {stepUp ? (
          <form className="stack" onSubmit={onConfirm} noValidate>
            <Alert tone="warning" title="Confirm it's you">
              Enter your password to create a token.
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
              <Button type="submit" disabled={!password || confirm.isPending || create.isPending}>
                Confirm and create token
              </Button>
            </div>
          </form>
        ) : (
          <form className="stack" onSubmit={onSubmit} noValidate>
            <TextField
              label="Token name"
              hint="What it is for, such as Data warehouse."
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={server.name}
              maxLength={80}
              required
            />
            <fieldset className="api-access__scopes">
              <legend>What it can do</legend>
              {tokens.data.availableScopes.map((s) => (
                <Checkbox
                  key={s}
                  label={scopeLabel(s)}
                  checked={scopes.includes(s)}
                  onChange={() => toggle(s)}
                />
              ))}
            </fieldset>
            {create.isError && !Object.keys(server).length ? (
              <ErrorAlert error={create.error} title="We couldn't create the token" />
            ) : null}
            <div>
              <Button type="submit" disabled={create.isPending || !name.trim() || !scopes.length}>
                Create token
              </Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}

function Deliveries({ id }: { id: string }) {
  const q = useWebhookDeliveries(id);
  const replay = useReplayDelivery(id);
  if (q.isPending) return <p className="u-caption">Loading deliveries…</p>;
  if (q.isError) return <ErrorAlert error={q.error} title="We couldn't load deliveries" />;
  if (!q.data.length) return <p className="u-caption">Nothing has been sent yet.</p>;
  return (
    <ul className="api-access__list">
      {q.data.map((d) => (
        <li key={d.id} className="api-access__row">
          <span>{d.eventType}</span>
          <span className="u-caption">
            {when(d.createdAt)} · {d.status}
            {d.lastStatus ? ` · HTTP ${d.lastStatus}` : ''}
            {d.lastError ? ` · ${d.lastError}` : ''} · {d.attempts}{' '}
            {d.attempts === 1 ? 'try' : 'tries'}
          </span>
          {d.status !== 'pending' ? (
            <Button
              variant="secondary"
              onClick={() => replay.mutate(d.id)}
              disabled={replay.isPending}
              aria-label={`Send ${d.eventType} again`}
            >
              Send again
            </Button>
          ) : null}
        </li>
      ))}
      {replay.isError ? (
        <li>
          <ErrorAlert error={replay.error} title="We couldn't send it again" />
        </li>
      ) : null}
    </ul>
  );
}

function WebhooksCard() {
  const hooks = useWebhooks();
  const create = useCreateWebhook();
  const remove = useDeleteWebhook();
  const [url, setUrl] = useState('');
  const [types, setTypes] = useState<string[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const server = serverFieldErrors(create.error);

  if (hooks.isPending) return <SkeletonRows rows={3} label="Loading webhooks…" />;
  if (hooks.isError) {
    if (isApiError(hooks.error, 403))
      return (
        <Card title="Webhooks">
          <p className="u-muted">Only owners and admins can manage webhooks.</p>
        </Card>
      );
    return <ErrorAlert error={hooks.error} title="We couldn't load webhooks" />;
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!url.trim() || !types.length) return;
    create.mutate(
      { url: url.trim(), eventTypes: types },
      {
        onSuccess: (w) => {
          setSecret(w.secret);
          setUrl('');
          setTypes([]);
        },
      },
    );
  }
  const toggle = (t: string) =>
    setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  return (
    <Card title="Webhooks">
      <div className="stack">
        <p className="u-muted">
          Archova sends a signed notice to your address when something changes. It carries ids only;
          your system then reads the record through the API. Archova checks the address answers
          before saving it, and turns it off after 72 hours without a reply.
        </p>
        {secret ? (
          <SecretOnce title="Signing secret" secret={secret} onDone={() => setSecret(null)} />
        ) : null}

        {hooks.data.data.length ? (
          <ul className="api-access__list">
            {hooks.data.data.map((w) => (
              <li key={w.id} className="api-access__row">
                <span>
                  <strong>{w.url}</strong>{' '}
                  <StatusPill tone={w.status === 'active' ? 'success' : 'warning'}>
                    {w.status === 'active' ? 'Active' : 'Off'}
                  </StatusPill>
                </span>
                <span className="u-caption">
                  {w.eventTypes.length} event {w.eventTypes.length === 1 ? 'type' : 'types'}
                  {w.disabledReason ? ` · ${w.disabledReason}` : ''}
                </span>
                <div className="api-access__actions">
                  <Button
                    variant="secondary"
                    aria-expanded={open === w.id}
                    onClick={() => setOpen(open === w.id ? null : w.id)}
                  >
                    {open === w.id ? 'Hide deliveries' : 'Deliveries'}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => remove.mutate(w.id)}
                    disabled={remove.isPending}
                  >
                    Delete
                  </Button>
                </div>
                {open === w.id ? <Deliveries id={w.id} /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="u-muted">No webhooks yet.</p>
        )}
        {remove.isError ? (
          <ErrorAlert error={remove.error} title="We couldn't delete the webhook" />
        ) : null}

        <form className="stack" onSubmit={onSubmit} noValidate>
          <TextField
            label="Webhook address"
            hint="A public https address."
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            error={server.url}
            maxLength={2000}
            required
          />
          <fieldset className="api-access__scopes">
            <legend>Events</legend>
            {hooks.data.availableEventTypes.map((t) => (
              <Checkbox key={t} label={t} checked={types.includes(t)} onChange={() => toggle(t)} />
            ))}
          </fieldset>
          {create.isError && !Object.keys(server).length ? (
            <ErrorAlert error={create.error} title="We couldn't add the webhook" />
          ) : null}
          <div>
            <Button type="submit" disabled={create.isPending || !url.trim() || !types.length}>
              Add webhook
            </Button>
          </div>
        </form>
      </div>
    </Card>
  );
}

/** Settings → API access: personal access tokens and webhooks for the public API (integrations/06). */
export function ApiAccessScreen() {
  return (
    <div className="stack">
      <h1>API access</h1>
      <TokensCard />
      <WebhooksCard />
    </div>
  );
}
