'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Checkbox, Dialog, Select, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import type { EotSettings } from '../data/eot';
import type { EotMutations } from '../hooks/useEot';
import { FORM_LABELS } from '../lib/eot';

const FORMS = Object.entries(FORM_LABELS).map(([value, label]) => ({ value, label }));

/** The contract's notice and claim periods and rain-day rule. Until a person confirms them every date is an estimate. */
export function SettingsDialog({
  open,
  onClose,
  settings,
  m,
}: {
  open: boolean;
  onClose: () => void;
  settings: EotSettings | undefined;
  m: EotMutations;
}) {
  const [form, setForm] = useState<EotSettings['form']>('as4000');
  const [noticeDays, setNoticeDays] = useState('14');
  const [claimDays, setClaimDays] = useState('28');
  const [basis, setBasis] = useState<EotSettings['dayBasis']>('calendar');
  const [noticeClause, setNoticeClause] = useState('');
  const [claimClause, setClaimClause] = useState('');
  const [rain, setRain] = useState('10');
  const [allowance, setAllowance] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !settings) return;
    setForm(settings.form);
    setNoticeDays(String(settings.noticeDays));
    setClaimDays(String(settings.claimDays));
    setBasis(settings.dayBasis);
    setNoticeClause(settings.noticeClause ?? '');
    setClaimClause(settings.claimClause ?? '');
    setRain(String(settings.rainThresholdMm));
    setAllowance(settings.wetDayAllowance === null ? '' : String(settings.wetDayAllowance));
    setConfirmed(settings.confirmed);
    setError(null);
  }, [open, settings]);

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const n = Number(noticeDays);
    const c = Number(claimDays);
    const r = Number(rain);
    const a = allowance.trim() === '' ? null : Number(allowance);
    if (!Number.isInteger(n) || n < 0 || n > 365)
      return setError('The notice period is a whole number of days from 0 to 365.');
    if (!Number.isInteger(c) || c < 0 || c > 365)
      return setError('The claim period is a whole number of days from 0 to 365.');
    if (!Number.isFinite(r) || r < 0) return setError('The rain-day threshold is a number of mm.');
    if (a !== null && (!Number.isInteger(a) || a < 0))
      return setError('The wet-day allowance is a whole number of days.');
    m.saveSettings.mutate(
      {
        form,
        noticeDays: n,
        claimDays: c,
        dayBasis: basis,
        noticeClause: noticeClause.trim() || null,
        claimClause: claimClause.trim() || null,
        confirmed,
        rainThresholdMm: r,
        wetDayAllowance: a,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Contract periods"
      description="Time bars come from your contract, often amended by its special conditions. Nova counts the dates from what you enter here."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="eot-settings-form" loading={m.saveSettings.isPending}>
            Save periods
          </Button>
        </>
      }
    >
      <form id="eot-settings-form" className="stack" onSubmit={save} noValidate>
        {settings?.isDefault ? (
          <Alert tone="warning">
            These are the unamended AS 4000 defaults. Check your contract, then confirm.
          </Alert>
        ) : null}
        <div className="form-row">
          <Select
            label="Contract form"
            value={form}
            onChange={(e) => setForm(e.target.value as EotSettings['form'])}
            options={FORMS}
          />
          <Select
            label="Days are counted as"
            value={basis}
            onChange={(e) => setBasis(e.target.value as EotSettings['dayBasis'])}
            options={[
              { value: 'calendar', label: 'Calendar days' },
              { value: 'business', label: 'Weekdays (holidays not skipped)' },
            ]}
            hint="Calendar unless the contract says otherwise."
          />
        </div>
        <div className="form-row">
          <TextField
            label="Notice of delay within (days)"
            inputMode="numeric"
            value={noticeDays}
            onChange={(e) => setNoticeDays(e.target.value)}
          />
          <TextField
            label="Notice clause"
            value={noticeClause}
            onChange={(e) => setNoticeClause(e.target.value)}
            hint="For example cl 34.2."
          />
        </div>
        <div className="form-row">
          <TextField
            label="EOT claim within (days)"
            inputMode="numeric"
            value={claimDays}
            onChange={(e) => setClaimDays(e.target.value)}
          />
          <TextField
            label="Claim clause"
            value={claimClause}
            onChange={(e) => setClaimClause(e.target.value)}
            hint="For example cl 34.3."
          />
        </div>
        <div className="form-row">
          <TextField
            label="Rain day from (mm in the day)"
            inputMode="decimal"
            value={rain}
            onChange={(e) => setRain(e.target.value)}
            hint="Site diary rainfall at or above this marks a rain day."
          />
          <TextField
            label="Wet days allowed by the contract"
            inputMode="numeric"
            value={allowance}
            onChange={(e) => setAllowance(e.target.value)}
            hint="Leave blank if there is no allowance."
          />
        </div>
        <Checkbox
          label="I have checked these against the contract and its special conditions"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ErrorAlert error={m.saveSettings.error} title="We couldn't save the periods" />
      </form>
    </Dialog>
  );
}
