'use client';

import { useState } from 'react';
import { formatQuantity } from '@archova/markup';
import { Alert, Button, Select, StatusPill, TextField } from '@archova/ui';
import { Check, X } from '@archova/ui/icons';
import { captureSheetImage } from '../lib/sheet-image';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import type { useTakeoffMutations } from '../hooks/useTakeoff';
import {
  NOVA_BULK_ACCEPT,
  NOVA_SURE,
  type NovaFindInput,
  type NovaFound,
  type NovaKind,
  type TakeoffMeasurement,
} from '../lib/takeoff-types';

/** Nova's marks on the sheet: those still waiting, accepted and rejected, newest sheet state first. */
export const novaMarks = (rows: readonly TakeoffMeasurement[]) =>
  rows.filter((m) => m.source !== 'manual');

export function novaCounts(rows: readonly TakeoffMeasurement[]) {
  const marks = novaMarks(rows);
  return {
    accepted: marks.filter((m) => m.confirmed).length,
    rejected: marks.filter((m) => m.rejected).length,
    pending: marks.filter((m) => !m.confirmed && !m.rejected).length,
  };
}

const KINDS: Array<{ value: NovaKind; label: string }> = [
  { value: 'count', label: 'Count items' },
  { value: 'length', label: 'Measure lengths' },
  { value: 'area', label: 'Measure areas' },
];

type Mutations = ReturnType<typeof useTakeoffMutations>;

/**
 * "Nova count" (ai/10 E1): the estimator says what to find, Nova marks it, and each mark waits, dashed and out of the
 * totals, until a person accepts it. Nova never gives a quantity: it is worked out from the placed points and the
 * sheet's confirmed scale. Works for any trade; the words are the estimator's own.
 */
export function NovaTakeoffSection({
  rows,
  canFind,
  context,
  mutations,
  selectedId,
  onSelect,
  sheetElement,
}: {
  rows: readonly TakeoffMeasurement[];
  canFind: boolean;
  /** Everything Nova's request needs besides what to find. */
  context: Omit<NovaFindInput, 'kind' | 'what'>;
  mutations: Mutations;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Any element in the viewer, to find the drawn sheet from. */
  sheetElement: Element | null;
}) {
  const [what, setWhat] = useState('');
  const [kind, setKind] = useState<NovaKind>('count');
  const [result, setResult] = useState<NovaFound | null>(null);
  const marks = novaMarks(rows);
  const counts = novaCounts(rows);
  const sure = marks.filter(
    (m) => !m.confirmed && !m.rejected && (m.confidence ?? 0) >= NOVA_BULK_ACCEPT,
  ).length;

  const [capturing, setCapturing] = useState(false);
  const find = async () => {
    setCapturing(true);
    try {
      const image = await captureSheetImage(sheetElement).catch(() => null);
      mutations.findWithNova.mutate(
        { ...context, kind, what: what.trim(), image },
        { onSuccess: (r) => setResult(r) },
      );
    } finally {
      setCapturing(false);
    }
  };

  return (
    <section aria-labelledby="nova-takeoff" className="stack nova-takeoff">
      <h3 id="nova-takeoff" className="panel-subheading">
        Nova count
      </h3>
      <p className="u-caption u-m-0">
        Say what to find, for any trade. Nova&apos;s marks stay dashed and out of the totals until
        you accept them.
      </p>
      <div className="form-row">
        <TextField
          label="What should Nova find?"
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          placeholder="e.g. power points, strip footings"
          maxLength={120}
        />
        <Select
          label="Nova should"
          value={kind}
          onChange={(e) => setKind(e.target.value as NovaKind)}
          options={KINDS}
        />
      </div>
      <div>
        <Button
          loading={capturing || mutations.findWithNova.isPending}
          disabled={!canFind || !what.trim()}
          onClick={() => void find()}
        >
          Find with Nova
        </Button>
      </div>
      {!canFind ? <p className="u-caption u-m-0">Confirm the scale to use Nova.</p> : null}
      <ErrorAlert error={mutations.findWithNova.error} title="Nova couldn't read this sheet" />
      {result && !result.marks.length ? (
        <Alert tone="info" title="Nova didn't find any">
          {result.caveat ?? 'Try describing it differently, or use the Count tool by hand.'}
        </Alert>
      ) : null}
      {result?.scanned && result.marks.length ? (
        <StatusPill tone="warning">Scanned sheet: check every mark</StatusPill>
      ) : null}
      {result?.caveat && result.marks.length ? (
        <p className="u-caption u-m-0">{result.caveat}</p>
      ) : null}

      {marks.length ? (
        <>
          <dl className="nova-tally" aria-label="Nova's marks on this sheet">
            <div>
              <dt>Accepted</dt>
              <dd>{counts.accepted}</dd>
            </div>
            <div>
              <dt>Waiting</dt>
              <dd>{counts.pending}</dd>
            </div>
            <div>
              <dt>Rejected</dt>
              <dd>{counts.rejected}</dd>
            </div>
          </dl>
          <ul className="plain-list">
            {marks.map((m) => (
              <MarkRow
                key={m.id}
                m={m}
                selected={m.id === selectedId}
                onSelect={() => onSelect(m.id === selectedId ? null : m.id)}
                onAccept={() => mutations.accept.mutate(m.id)}
                onReject={() => mutations.reject.mutate(m.id)}
                busy={mutations.accept.isPending || mutations.reject.isPending}
              />
            ))}
          </ul>
          <ErrorAlert
            error={mutations.accept.error ?? mutations.reject.error ?? mutations.acceptAbove.error}
            title="We couldn't update that mark"
          />
          <div>
            <Button
              variant="secondary"
              disabled={!sure || mutations.acceptAbove.isPending}
              loading={mutations.acceptAbove.isPending}
              onClick={() =>
                mutations.acceptAbove.mutate({
                  revisionId: context.revisionId,
                  minConfidence: NOVA_BULK_ACCEPT,
                })
              }
            >
              Accept {Math.round(NOVA_BULK_ACCEPT * 100)}% and over ({sure})
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}

function MarkRow({
  m,
  selected,
  busy,
  onSelect,
  onAccept,
  onReject,
}: {
  m: TakeoffMeasurement;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onAccept: () => void;
  onReject: () => void;
}) {
  const pct = m.confidence === null ? null : Math.round(m.confidence * 100);
  const low = (m.confidence ?? 0) < NOVA_SURE;
  const waiting = !m.confirmed && !m.rejected;
  return (
    <li
      className={`plain-list__item takeoff-row nova-mark${selected ? ' nova-mark--selected' : ''}${low && waiting ? ' nova-mark--low' : ''}`}
    >
      <button type="button" className="nova-mark__name" aria-pressed={selected} onClick={onSelect}>
        <span className={m.rejected ? 'nova-mark__struck' : undefined}>{m.label}</span>
        {pct !== null ? (
          <span className="u-caption">
            {' '}
            · {pct}%{low && waiting ? ' · low, review' : ''}
          </span>
        ) : null}
      </button>
      <span className="u-mono">{formatQuantity(m.quantity, m.unit)}</span>
      {m.confirmed ? (
        <StatusPill tone="success">Accepted</StatusPill>
      ) : (
        <span className="row-actions">
          {m.rejected ? <StatusPill tone="neutral">Rejected</StatusPill> : null}
          <Button size="sm" aria-label={`Accept ${m.label}`} disabled={busy} onClick={onAccept}>
            <Check size={16} strokeWidth={1.5} aria-hidden="true" />
          </Button>
          {m.rejected ? null : (
            <Button
              size="sm"
              variant="secondary"
              aria-label={`Reject ${m.label}`}
              disabled={busy}
              onClick={onReject}
            >
              <X size={16} strokeWidth={1.5} aria-hidden="true" />
            </Button>
          )}
        </span>
      )}
    </li>
  );
}
