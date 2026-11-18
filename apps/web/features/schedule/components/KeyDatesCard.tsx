'use client';

import { useState } from 'react';
import { can, type EffectivePermissions } from '@archova/domain/permissions';
import { Button, Card, Dialog, SkeletonRows, StatusPill } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant, formatLocalDate, todayIn } from '@/shared/lib/format';
import type { KeyDates } from '../data/api';
import { useKeyDateChanges, useKeyDates } from '../hooks/useSchedule';
import {
  FIELD_LABELS,
  REASON_LABELS,
  formatChangeValue,
  formatLdRate,
  pcCountdown,
} from '../lib/labels';
import { KeyDatesForm } from './KeyDatesForm';
import { MilestoneStrip } from './MilestoneStrip';

const date = (d: string | null) => (d ? formatLocalDate(d) : 'Not set');

/** The countdown reads "danger" once PC is past target, "warning" in the last 28 days. */
function countdownTone(k: KeyDates) {
  if (k.daysToPc === null) return 'neutral' as const;
  if (k.daysToPc < 0) return 'danger' as const;
  return k.daysToPc <= 28 ? ('warning' as const) : ('info' as const);
}

/** Project home: how long to PC, what a day over costs, and every key date with its history (SCH-AC1). */
export function KeyDatesCard({
  projectId,
  timeZone,
  permissions,
}: {
  projectId: string;
  timeZone: string;
  permissions: EffectivePermissions | undefined;
}) {
  const dates = useKeyDates(projectId);
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const history = useKeyDateChanges(projectId, showHistory && (dates.data?.version ?? 0) > 0);
  const canEdit = permissions ? can(permissions, 'platform.projects.update') : false;

  const k = dates.data;
  const countdown = k ? pcCountdown(k) : null;
  const rate = k ? formatLdRate(k.ldRatePerDay, k.currency) : null;

  return (
    <Card
      title="Key dates"
      actions={
        canEdit && k ? (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {k.version === 0 ? 'Set key dates' : 'Edit'}
          </Button>
        ) : undefined
      }
    >
      <ErrorAlert error={dates.error} title="We couldn't load the key dates" />
      {dates.isPending ? <SkeletonRows rows={3} label="Loading key dates…" /> : null}
      {k && k.version === 0 ? (
        <p className="u-muted">
          No key dates yet.{' '}
          {canEdit
            ? 'Set site possession, the PC target and the LD rate so everyone sees how long is left.'
            : 'A project admin can set them.'}
        </p>
      ) : null}
      {k && k.version > 0 ? (
        <div className="stack">
          {countdown ? (
            <p className="key-dates__headline">
              <StatusPill tone={countdownTone(k)}>{countdown}</StatusPill>
              {rate ? <span className="u-caption">A day over costs {rate}.</span> : null}
            </p>
          ) : null}
          <MilestoneStrip dates={k} today={todayIn(timeZone)} />
          <dl className="details">
            <div>
              <dt>Site possession</dt>
              <dd>{date(k.possessionDate)}</dd>
            </div>
            <div>
              <dt>PC target</dt>
              <dd>{date(k.pcTarget)}</dd>
            </div>
            <div>
              <dt>PC actual</dt>
              <dd>{date(k.pcActual)}</dd>
            </div>
            <div>
              <dt>End of defects liability</dt>
              <dd>
                {date(k.dlpEnd)}
                {k.daysToDlpEnd !== null && k.daysToDlpEnd >= 0 && k.pcActual ? (
                  <span className="u-caption"> · in {k.daysToDlpEnd} days</span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Liquidated damages</dt>
              <dd>{rate ? `${rate} per day` : 'Not set'}</dd>
            </div>
          </dl>
          {k.sections.length ? (
            <div>
              <h3 className="panel-heading">Sectional completion</h3>
              <ul className="key-sections__list">
                {k.sections.map((s) => (
                  <li key={s.id}>
                    <span>{s.name}</span>
                    <span className="u-caption">
                      Target {date(s.targetDate)}
                      {s.actualDate ? ` · reached ${formatLocalDate(s.actualDate)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <Button
              variant="secondary"
              onClick={() => setShowHistory((v) => !v)}
              aria-expanded={showHistory}
            >
              {showHistory ? 'Hide change history' : 'Change history'}
            </Button>
          </div>
          {showHistory ? (
            <>
              <ErrorAlert error={history.error} title="We couldn't load the history" />
              {history.isPending ? <SkeletonRows rows={3} label="Loading history…" /> : null}
              {history.data ? (
                <ul className="key-history">
                  {history.data.map((c) => (
                    <li key={c.id}>
                      <strong>
                        {FIELD_LABELS[c.field]}
                        {c.sectionName && c.field !== 'sectionAdded' && c.field !== 'sectionRemoved'
                          ? ` (${c.sectionName})`
                          : ''}
                      </strong>
                      : {formatChangeValue(c.field, c.from)} → {formatChangeValue(c.field, c.to)}
                      {c.reason ? ` · ${REASON_LABELS[c.reason]}` : ''}
                      {c.note ? ` · ${c.note}` : ''}
                      <span className="u-caption">
                        {' '}
                        {c.changedBy ? `${c.changedBy.name}, ` : ''}
                        {formatInstant(c.changedAt, timeZone)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
      {k ? (
        <Dialog open={editing} onClose={() => setEditing(false)} title="Key dates">
          {/* Remounted per open so the form starts from the saved dates. */}
          {editing ? (
            <KeyDatesForm projectId={projectId} keyDates={k} onDone={() => setEditing(false)} />
          ) : null}
        </Dialog>
      ) : null}
    </Card>
  );
}
