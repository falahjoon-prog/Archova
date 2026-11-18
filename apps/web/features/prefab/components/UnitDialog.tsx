'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Button, Dialog, Select, SkeletonRows, StatusPill, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import type { Check } from '../data/api';
import { usePrefabDetail, type usePrefabMutations } from '../hooks/usePrefab';
import {
  ACTION_LABELS,
  KIND_LABELS,
  NEEDS_REASON,
  NEXT_STEP,
  STATUS_LABELS,
  STATUS_TONES,
  fmtDate,
  type ActionName,
} from '../lib/units';

const RESULT_LABELS: Record<Check['result'], string> = {
  pending: 'Pending',
  pass: 'Passed',
  fail: 'Failed',
  na: 'Not applicable',
};
const RESULT_TONES = {
  pending: 'neutral',
  pass: 'success',
  fail: 'danger',
  na: 'neutral',
} as const;

/** One unit: where it is, the QA checklist that gates shipping and install, and the moves open to it. */
export function UnitDialog({
  projectId,
  unitId,
  onClose,
  canWrite,
  tz,
  m,
}: {
  projectId: string;
  unitId: string | null;
  onClose: () => void;
  canWrite: boolean;
  tz: string;
  m: ReturnType<typeof usePrefabMutations>;
}) {
  const detail = usePrefabDetail(projectId, unitId);
  const u = detail.data?.unit;
  const checks = detail.data?.checks ?? [];
  const [reasonFor, setReasonFor] = useState<ActionName | null>(null);
  const [reason, setReason] = useState('');
  const [failing, setFailing] = useState<{ id: string; note: string } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [newCheck, setNewCheck] = useState('');
  const [newStage, setNewStage] = useState<'factory' | 'site'>('factory');
  const step = u ? NEXT_STEP[u.status] : null;

  function move(action: ActionName) {
    if (!u) return;
    if (NEEDS_REASON.includes(action) && reasonFor !== action) {
      setReasonFor(action);
      setReason('');
      return;
    }
    m.transition.mutate(
      { unitId: u.id, body: { action, ...(reason.trim() ? { reason: reason.trim() } : {}) } },
      {
        onSuccess: () => {
          setReasonFor(null);
          setReason('');
        },
      },
    );
  }
  function savePercent(e: FormEvent) {
    e.preventDefault();
    const n = Number(progress);
    if (!u || progress === null || !Number.isInteger(n) || n < 0 || n > 100) return;
    m.progress.mutate({ unitId: u.id, progressPct: n }, { onSuccess: () => setProgress(null) });
  }
  function addCheck(e: FormEvent) {
    e.preventDefault();
    if (!u || !newCheck.trim()) return;
    m.addCheck.mutate(
      { unitId: u.id, stage: newStage, label: newCheck.trim() },
      { onSuccess: () => setNewCheck('') },
    );
  }

  const stageChecks = (stage: Check['stage']) => checks.filter((c) => c.stage === stage);

  return (
    <Dialog
      open={unitId !== null}
      onClose={onClose}
      title={u ? `${u.code}: ${u.name}` : 'Unit'}
      description={
        u ? [KIND_LABELS[u.kind], u.factoryName, u.location].filter(Boolean).join(' · ') : undefined
      }
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {detail.isPending ? <SkeletonRows label="Loading unit…" /> : null}
      <ErrorAlert error={detail.error} title="We couldn't load this unit" />
      <ErrorAlert
        error={
          m.transition.error ??
          m.draftDelivery.error ??
          m.recordCheck.error ??
          m.progress.error ??
          m.addCheck.error
        }
        title="We couldn't save that"
      />
      {u && step ? (
        <div className="stack">
          <p className="u-m-0">
            <StatusPill tone={STATUS_TONES[u.status]}>{STATUS_LABELS[u.status]}</StatusPill>
            {u.statusReason ? <span className="u-caption"> {u.statusReason}</span> : null}
          </p>
          <dl className="pfb-facts">
            <dt>Fabrication</dt>
            <dd>
              {fmtDate(u.fabStart)} to {fmtDate(u.fabDue)}, {u.progressPct}% done
            </dd>
            <dt>Ships</dt>
            <dd>{fmtDate(u.shipDate)}</dd>
            <dt>Install</dt>
            <dd>
              {fmtDate(u.installDate)}
              {u.installSequence ? ` · number ${u.installSequence} in the sequence` : ''}
            </dd>
            <dt>Site delivery</dt>
            <dd>
              {u.deliveryLabel ?? 'Not booked'}
              {!u.deliveryId && canWrite && (u.installDate || u.shipDate) ? (
                <>
                  {' '}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={m.draftDelivery.isPending}
                    onClick={() => m.draftDelivery.mutate(u.id)}
                  >
                    Draft a delivery
                  </Button>
                </>
              ) : null}
            </dd>
            {u.weightKg || u.dimensions ? (
              <>
                <dt>Size</dt>
                <dd>
                  {[u.dimensions, u.weightKg ? `${u.weightKg.toLocaleString('en-AU')} kg` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </dd>
              </>
            ) : null}
          </dl>
          {u.notes ? <p className="u-m-0">{u.notes}</p> : null}

          {canWrite ? (
            <div className="stack-sm">
              <div className="row-actions">
                {step.main ? (
                  <Button disabled={m.transition.isPending} onClick={() => move(step.main!)}>
                    {ACTION_LABELS[step.main]}
                  </Button>
                ) : null}
                {step.others.map((a) => (
                  <Button
                    key={a}
                    variant="secondary"
                    disabled={m.transition.isPending}
                    onClick={() => move(a)}
                  >
                    {ACTION_LABELS[a]}
                  </Button>
                ))}
              </div>
              {reasonFor ? (
                <div className="stack-sm">
                  <TextField
                    label={`Why: ${ACTION_LABELS[reasonFor].toLowerCase()}`}
                    required
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <div className="row-actions">
                    <Button
                      size="sm"
                      disabled={!reason.trim() || m.transition.isPending}
                      onClick={() => move(reasonFor)}
                    >
                      Confirm
                    </Button>
                    <Button size="sm" variant="tertiary" onClick={() => setReasonFor(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
              {u.status === 'in_fabrication' ? (
                <form className="pfb-progress" onSubmit={savePercent}>
                  <TextField
                    label="Fabrication progress (%)"
                    inputMode="numeric"
                    value={progress ?? String(u.progressPct)}
                    onChange={(e) => setProgress(e.target.value)}
                  />
                  <Button type="submit" variant="secondary" disabled={progress === null}>
                    Save
                  </Button>
                </form>
              ) : null}
            </div>
          ) : null}

          {(['factory', 'site'] as const).map((stage) => (
            <section key={stage} className="stack-sm" aria-label={`${stage} checks`}>
              <h3 className="u-m-0">{stage === 'factory' ? 'Factory checks' : 'Site checks'}</h3>
              <p className="u-m-0 u-caption">
                {stage === 'factory'
                  ? 'Every required check must pass before the unit can be released to ship.'
                  : 'Every required check must pass before the unit can be marked installed.'}
              </p>
              {stageChecks(stage).length === 0 ? <p className="u-m-0">No checks.</p> : null}
              <ul className="pfb-checks">
                {stageChecks(stage).map((c) => (
                  <li key={c.id} className="pfb-check">
                    <div className="pfb-check__main">
                      <span className="pfb-check__label">
                        {c.label}
                        {c.required ? null : <span className="u-caption"> (optional)</span>}
                      </span>
                      <StatusPill tone={RESULT_TONES[c.result]}>
                        {RESULT_LABELS[c.result]}
                      </StatusPill>
                    </div>
                    {c.note ? <p className="u-m-0 u-caption">{c.note}</p> : null}
                    {canWrite && u.status !== 'installed' && u.status !== 'rejected' ? (
                      <div className="row-actions">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={m.recordCheck.isPending}
                          onClick={() =>
                            m.recordCheck.mutate({ unitId: u.id, checkId: c.id, result: 'pass' })
                          }
                        >
                          Pass
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setFailing({ id: c.id, note: '' })}
                        >
                          Fail
                        </Button>
                        <Button
                          size="sm"
                          variant="tertiary"
                          disabled={m.recordCheck.isPending}
                          onClick={() =>
                            m.recordCheck.mutate({ unitId: u.id, checkId: c.id, result: 'na' })
                          }
                        >
                          N/A
                        </Button>
                        {c.result !== 'pending' ? (
                          <Button
                            size="sm"
                            variant="tertiary"
                            disabled={m.recordCheck.isPending}
                            onClick={() =>
                              m.recordCheck.mutate({
                                unitId: u.id,
                                checkId: c.id,
                                result: 'pending',
                              })
                            }
                          >
                            Reset
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    {failing?.id === c.id ? (
                      <div className="stack-sm">
                        <TextField
                          label="What failed"
                          required
                          value={failing.note}
                          onChange={(e) => setFailing({ id: c.id, note: e.target.value })}
                        />
                        <div className="row-actions">
                          <Button
                            size="sm"
                            disabled={!failing.note.trim() || m.recordCheck.isPending}
                            onClick={() =>
                              m.recordCheck.mutate(
                                {
                                  unitId: u.id,
                                  checkId: c.id,
                                  result: 'fail',
                                  note: failing.note.trim(),
                                },
                                { onSuccess: () => setFailing(null) },
                              )
                            }
                          >
                            Record failure
                          </Button>
                          <Button size="sm" variant="tertiary" onClick={() => setFailing(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {u.qaFailed > 0 ? (
            <Alert tone="warning">
              {u.qaFailed} failed check{u.qaFailed === 1 ? '' : 's'}. Re-test and pass them, or
              reset them, before the unit moves on.
            </Alert>
          ) : null}
          {canWrite && u.status !== 'installed' && u.status !== 'rejected' ? (
            <form className="pfb-addcheck" onSubmit={addCheck}>
              <TextField
                label="Add a check"
                value={newCheck}
                onChange={(e) => setNewCheck(e.target.value)}
              />
              <Select
                label="At"
                value={newStage}
                onChange={(e) => setNewStage(e.target.value as 'factory' | 'site')}
                options={[
                  { value: 'factory', label: 'Factory' },
                  { value: 'site', label: 'Site' },
                ]}
              />
              <Button type="submit" variant="secondary" disabled={!newCheck.trim()}>
                Add
              </Button>
            </form>
          ) : null}

          <section className="stack-sm" aria-label="History">
            <h3 className="u-m-0">History</h3>
            <ul className="pfb-history">
              {[...(detail.data?.events ?? [])].reverse().map((e) => (
                <li key={e.id}>
                  <span className="u-caption">{formatInstant(e.at, tz)}</span>{' '}
                  {e.kind.replaceAll('_', ' ')}
                  {e.detail ? <span className="u-caption"> · {e.detail}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </Dialog>
  );
}
