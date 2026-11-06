'use client';

import { useMemo, useState } from 'react';
import { Alert, Button, Card, Checkbox, PageHeader, SkeletonRows, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useBranding, useLogoUrl, useSaveBranding, type OrgBranding } from '../hooks/useBranding';
import { isHex, textOn } from '../lib/colour';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const AMBER = '#E08A1E';

/** Logo, accent colour and Portfolio widgets. The accent only replaces the brand amber; buttons and status colours stay. */
export function BrandingScreen() {
  const org = useCurrentOrg();
  const branding = useBranding();
  const canManage = org.role === 'owner' || org.role === 'admin';
  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="Settings"
        title="Branding"
        description="Put your logo and colour on Archova for everyone in your company, and choose what the Portfolio shows."
      />
      <ErrorAlert error={branding.error} title="We couldn't load branding" />
      {branding.isPending ? (
        <SkeletonRows label="Loading branding…" />
      ) : branding.data ? (
        <BrandingForm branding={branding.data} canManage={canManage} />
      ) : null}
    </div>
  );
}

function BrandingForm({ branding, canManage }: { branding: OrgBranding; canManage: boolean }) {
  const save = useSaveBranding();
  const logoUrl = useLogoUrl(branding.logoFileId);
  const [accent, setAccent] = useState(branding.accentColor ?? '');
  const [logo, setLogo] = useState<File | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [order, setOrder] = useState<string[]>(() => [
    ...branding.dashboardWidgets,
    ...branding.availableWidgets
      .map((w) => w.key)
      .filter((k) => !branding.dashboardWidgets.includes(k)),
  ]);
  const [on, setOn] = useState<Set<string>>(() => new Set(branding.dashboardWidgets));
  const labels = useMemo(
    () => Object.fromEntries(branding.availableWidgets.map((w) => [w.key, w.label])),
    [branding.availableWidgets],
  );

  const accentValid = accent === '' || isHex(accent);
  const widgets = order.filter((k) => on.has(k));
  const dirty =
    (accent.toUpperCase() || null) !== (branding.accentColor ?? null) ||
    !!logo ||
    removeLogo ||
    widgets.join() !== branding.dashboardWidgets.join();
  const preview = isHex(accent) ? accent : AMBER;

  function move(key: string, by: -1 | 1) {
    setOrder((o) => {
      const i = o.indexOf(key);
      const j = i + by;
      if (j < 0 || j >= o.length) return o;
      const next = [...o];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

  function chooseLogo(file: File | undefined) {
    setLogoError(null);
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setLogoError('Use a PNG, JPEG or WebP image.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError('Use an image under 2 MB.');
      return;
    }
    setLogo(file);
    setRemoveLogo(false);
  }

  const submit = () =>
    save.mutate(
      {
        patch: {
          accentColor: accent === '' ? null : accent.toUpperCase(),
          dashboardWidgets: widgets,
          ...(removeLogo ? { logoFileId: null } : {}),
        },
        ...(logo ? { logo } : {}),
      },
      {
        onSuccess: (saved) => {
          setLogo(null);
          setRemoveLogo(false);
          setAccent(saved.accentColor ?? '');
        },
      },
    );

  return (
    <form
      className="stack-lg"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {!canManage ? (
        <Alert tone="info" title="View only">
          Only owners and admins can change branding.
        </Alert>
      ) : null}
      <Card title="Logo">
        <div className="stack">
          {logoUrl.data && !removeLogo && !logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, not optimisable
            <img
              src={logoUrl.data}
              alt="Your company logo"
              height={48}
              style={{ maxWidth: '100%', objectFit: 'contain', alignSelf: 'flex-start' }}
            />
          ) : (
            <p className="u-muted u-m-0">
              {logo
                ? `New logo: ${logo.name}`
                : removeLogo
                  ? 'The Archova logo will show.'
                  : 'The Archova logo shows.'}
            </p>
          )}
          {canManage ? (
            <>
              <label className="ac-field__label" htmlFor="org-logo">
                Upload a logo (PNG, JPEG or WebP, under 2 MB)
              </label>
              <input
                id="org-logo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => chooseLogo(e.target.files?.[0])}
              />
              {logoError ? <Alert tone="danger" title={logoError} /> : null}
              {branding.logoFileId && !removeLogo ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setRemoveLogo(true);
                    setLogo(null);
                  }}
                >
                  Use the Archova logo
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </Card>
      <Card title="Accent colour">
        <div className="stack">
          <p className="u-muted u-m-0">
            Replaces the amber highlight. Buttons, links, status and safety colours do not change,
            so screens stay readable.
          </p>
          <TextField
            label="Colour (hex)"
            value={accent}
            placeholder={AMBER}
            maxLength={7}
            disabled={!canManage}
            error={accentValid ? undefined : 'Use a colour like #1F6FEB.'}
            hint="Leave blank for the Archova amber."
            onChange={(e) => setAccent(e.target.value.trim())}
          />
          <span
            aria-label="Accent preview"
            role="img"
            style={{
              background: preview,
              color: textOn(preview),
              padding: 'var(--space-2) var(--space-4)',
              borderRadius: 'var(--radius-md)',
              alignSelf: 'flex-start',
            }}
          >
            Highlight preview
          </span>
        </div>
      </Card>
      <Card title="Portfolio widgets">
        <ol className="stack u-m-0" style={{ listStyle: 'none', padding: 0 }}>
          {order.map((key, i) => (
            <li key={key} className="row-actions">
              <Checkbox
                label={labels[key] ?? key}
                checked={on.has(key)}
                disabled={!canManage}
                onChange={(e) =>
                  setOn((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.add(key);
                    else n.delete(key);
                    return n;
                  })
                }
              />
              {canManage ? (
                <span className="row-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={i === 0}
                    aria-label={`Move ${labels[key]} up`}
                    onClick={() => move(key, -1)}
                  >
                    Up
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={i === order.length - 1}
                    aria-label={`Move ${labels[key]} down`}
                    onClick={() => move(key, 1)}
                  >
                    Down
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
        {widgets.length === 0 ? (
          <Alert tone="warning" title="Keep at least one widget on." />
        ) : null}
      </Card>
      <ErrorAlert error={save.error} title="We couldn't save branding" />
      {save.isSuccess && !dirty ? (
        <p role="status" className="u-m-0">
          Saved.
        </p>
      ) : null}
      {canManage ? (
        <div>
          <Button
            type="submit"
            disabled={!dirty || !accentValid || widgets.length === 0 || save.isPending}
          >
            Save branding
          </Button>
        </div>
      ) : null}
    </form>
  );
}
