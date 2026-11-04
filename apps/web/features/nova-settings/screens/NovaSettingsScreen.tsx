'use client';

import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DataTable,
  PageHeader,
  SkeletonRows,
  Switch,
  TextField,
  type DataTableColumn,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { AI_FEATURES, FEATURE_LABELS, type AiSettings, type AiUsage } from '../data/api';
import { useNovaSettings, useNovaUsage, useSaveNovaSettings } from '../hooks/useNovaSettings';

const credits = (n: number) =>
  new Intl.NumberFormat('en-AU', { maximumFractionDigits: 1 }).format(n);

/** Nova on or off, which features stay on, the org's own monthly cap, outside companies, and how long text is kept. */
export function NovaSettingsScreen() {
  const org = useCurrentOrg();
  const settings = useNovaSettings();
  const usage = useNovaUsage();
  const canManage = org.role === 'owner' || org.role === 'admin';
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Nova settings"
        description="Control how your company uses Nova, and see this month’s credits."
      />
      <ErrorAlert error={settings.error} title="We couldn't load Nova settings" />
      {usage.data ? <UsageCard usage={usage.data} /> : null}
      {settings.isPending ? (
        <SkeletonRows label="Loading settings…" />
      ) : settings.data ? (
        <SettingsForm settings={settings.data} canManage={canManage} />
      ) : null}
    </>
  );
}

function UsageCard({ usage }: { usage: AiUsage }) {
  const columns: DataTableColumn<AiUsage['byFeature'][number]>[] = [
    {
      id: 'feature',
      header: 'Feature',
      rowHeader: true,
      cell: (r) => FEATURE_LABELS[r.feature] ?? r.feature,
    },
    { id: 'runs', header: 'Runs', sortValue: (r) => r.runs, cell: (r) => r.runs },
    {
      id: 'credits',
      header: 'Credits',
      sortValue: (r) => r.credits,
      cell: (r) => credits(r.credits),
    },
  ];
  return (
    <Card title="This month">
      <div className="stack">
        <p className="u-m-0">
          {credits(usage.used)} credits used since {formatLocalDate(usage.periodStart)}.{' '}
          {usage.allowance === null
            ? 'Your plan has no limit.'
            : `${credits(usage.remaining ?? 0)} of ${credits(usage.allowance)} left.`}
          {usage.granted > 0 ? ` Includes ${credits(usage.granted)} credits added by Archova.` : ''}
        </p>
        {usage.byFeature.length > 0 ? (
          <DataTable
            caption="Credits by feature"
            columns={columns}
            rows={usage.byFeature}
            getRowId={(r) => r.feature}
          />
        ) : (
          <p className="u-muted">No Nova use yet this month.</p>
        )}
      </div>
    </Card>
  );
}

function SettingsForm({ settings, canManage }: { settings: AiSettings; canManage: boolean }) {
  const save = useSaveNovaSettings();
  const [enabled, setEnabled] = useState(settings.aiEnabled);
  const [external, setExternal] = useState(settings.externalAiEnabled);
  const [features, setFeatures] = useState<string[]>(settings.featuresEnabled ?? AI_FEATURES);
  const [cap, setCap] = useState(
    settings.monthlyCreditCap === null ? '' : String(settings.monthlyCreditCap),
  );
  const [days, setDays] = useState(String(settings.retentionDays));
  const capN = Number(cap);
  const daysN = Number(days);
  const capOk = cap.trim() === '' || (Number.isFinite(capN) && capN >= 0);
  const daysOk = Number.isInteger(daysN) && daysN >= 0 && daysN <= 90;
  const allOn = AI_FEATURES.every((f) => features.includes(f));
  const toggle = (f: string) =>
    setFeatures((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));

  return (
    <Card title="Settings">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!capOk || !daysOk) return;
          save.mutate({
            current: settings,
            patch: {
              aiEnabled: enabled,
              externalAiEnabled: external,
              featuresEnabled: allOn
                ? null
                : (features as AiSettings['featuresEnabled'] & string[]),
              monthlyCreditCap: cap.trim() === '' ? null : capN,
              retentionDays: daysN,
            },
          });
        }}
      >
        {!canManage ? (
          <Alert tone="info">Only owners and admins can change these settings.</Alert>
        ) : null}
        <Switch
          label="Nova is on for this company"
          checked={enabled}
          disabled={!canManage}
          onCheckedChange={setEnabled}
        />
        <fieldset className="stack" disabled={!canManage || !enabled}>
          <legend>Features that stay on</legend>
          {AI_FEATURES.map((f) => (
            <Checkbox
              key={f}
              label={FEATURE_LABELS[f] ?? f}
              checked={features.includes(f)}
              onChange={() => toggle(f)}
            />
          ))}
        </fieldset>
        <Switch
          label="Invited companies can use Nova on your projects"
          checked={external}
          disabled={!canManage}
          onCheckedChange={setExternal}
        />
        <TextField
          label="Monthly credit cap"
          inputMode="decimal"
          value={cap}
          disabled={!canManage}
          hint="Optional. Your own limit below the plan allowance. Leave blank for none."
          error={!capOk ? 'Enter a number, or leave it blank.' : undefined}
          onChange={(e) => setCap(e.target.value)}
        />
        <TextField
          label="Keep what people ask Nova for (days)"
          inputMode="numeric"
          value={days}
          disabled={!canManage}
          hint="0 to 90 days, so it can be reviewed. After that only the record that it ran is kept."
          error={!daysOk ? 'Enter a whole number from 0 to 90.' : undefined}
          onChange={(e) => setDays(e.target.value)}
        />
        <ErrorAlert error={save.error} title="We couldn't save the settings" />
        {save.isSuccess ? <Alert tone="success">Saved.</Alert> : null}
        {canManage ? (
          <div>
            <Button type="submit" disabled={!capOk || !daysOk || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
        ) : null}
      </form>
    </Card>
  );
}
