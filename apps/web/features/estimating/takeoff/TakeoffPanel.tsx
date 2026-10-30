'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  UNIT_FOR_KIND,
  buildSnapIndex,
  calibrateScale,
  formatQuantity,
  formatScale,
  parseScale,
  takeoffQuantity,
  snapPoint,
  type Point,
  type TakeoffUnit,
} from '@archova/markup';
import { Alert, Button, Dialog, Select, StatusPill, TextField, ToggleGroup } from '@archova/ui';
import { Download } from '@archova/ui/icons';
import type { ViewerExtensionProps, ViewerToolBinding } from '@/shared/drawing-viewer/extension';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { measurementsToCsv } from '../data/takeoff-source';
import { usePackages } from '../hooks/useQuotes';
import { useMeasurements, useTakeoffMutations } from '../hooks/useTakeoff';
import { formatPackageNumber } from '../lib/quote-types';
import {
  NOVA_SURE,
  TRADES,
  type NewMeasurement,
  type TakeoffMeasurement,
} from '../lib/takeoff-types';
import { NovaTakeoffSection } from './NovaTakeoffSection';
import { ScaleSection } from './ScaleSection';
import { CursorLayer, GeometrySvg } from './TakeoffLayer';
import { geometryOf, useTakeoffTool, type TakeoffTool } from './useTakeoffTool';

/** Snap radius in screen pixels, converted to sheet units at the current zoom. */
const SNAP_PX = 10;

const TOOL_KEYS: Record<string, TakeoffTool> = { l: 'length', a: 'area', c: 'count' };

/**
 * Measure and count (F1.3a, EST-AC8 to AC11), registered into the drawing viewer. Scale first; then length, area
 * with cut-outs and count, snapping to the sheet's vector geometry; a quantities panel with totals by tag and unit,
 * saved per revision, exported to CSV. Keyboard: L/A/C pick a tool, Enter finishes, Esc cancels, Backspace undoes
 * the last point, arrow keys nudge it.
 */
export function TakeoffPanel({ sheet, bindTool, overlayTarget }: ViewerExtensionProps) {
  const project = useCurrentProject();
  const g = sheet.geometry;
  const scaleText = g?.scaleConfirmed ?? null;
  const ratio = scaleText ? parseScale(scaleText) : null;
  const canMeasure = Boolean(ratio) && sheet.isCurrent;
  const aspect = sheet.size.widthMm / sheet.size.heightMm;

  const { state, actions } = useTakeoffTool();
  const [hover, setHover] = useState<{ point: Point; snapped: boolean } | null>(null);
  const [label, setLabel] = useState('');
  const [trade, setTrade] = useState('');
  const [drafts, setDrafts] = useState<NewMeasurement[]>([]);
  const [calibrationLine, setCalibrationLine] = useState<[Point, Point] | null>(null);
  const [knownLength, setKnownLength] = useState('');
  const [showOld, setShowOld] = useState(false);

  const olderRevisionIds = sheet.revisions
    .filter((r) => r.id !== sheet.revisionId)
    .map((r) => r.id);
  const measurements = useMeasurements(project.projectId, [sheet.revisionId, ...olderRevisionIds]);
  const mutations = useTakeoffMutations(project.projectId);
  const onSheet = (measurements.data ?? []).filter((m) => m.revisionId === sheet.revisionId);
  // Only accepted marks count: Nova's pending and rejected ones are shown on the sheet, never totalled or sent on.
  const saved = onSheet.filter((m) => m.confirmed);
  const [selectedMark, setSelectedMark] = useState<string | null>(null);
  const packages = usePackages();
  const [packageId, setPackageId] = useState('');
  const unsent = saved.filter((m) => !m.packageId && m.scaleConfirmed);
  const older = (measurements.data ?? []).filter((m) => m.revisionId !== sheet.revisionId);
  const olderRev = (id: string) => sheet.revisions.find((r) => r.id === id)?.rev ?? '?';

  const index = useMemo(
    () => (g?.hasVector && g.segments.length ? buildSnapIndex(g.segments) : null),
    [g],
  );

  // Latest values for the stable pointer handlers handed to the viewer.
  const live = useRef({ state, actions, index, canMeasure });
  live.current = { state, actions, index, canMeasure };

  const geometry = geometryOf(state);
  const liveQuantity =
    ratio && geometry && state.tool !== 'calibrate'
      ? formatQuantity(takeoffQuantity(geometry, sheet.size, ratio), UNIT_FOR_KIND[geometry.kind])
      : null;

  const finish = () => {
    const s = live.current.state;
    if (s.tool === 'calibrate') return;
    const geo = geometryOf(s);
    if (!geo) return;
    setDrafts((d) => [
      ...d,
      {
        revisionId: sheet.revisionId,
        sheetNo: g?.sheetNo ?? '1',
        geometry: geo,
        label: label.trim() || defaultLabel(geo.kind, d.length + saved.length + 1),
        trade,
        raster: !g?.hasVector,
      },
    ]);
    actions.reset();
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  const tool = state.tool;
  useEffect(() => {
    if (!tool) {
      bindTool(null);
      return;
    }
    const snap = (p: Point, pxPerUnit: number) => {
      const idx = live.current.index;
      const hit = idx ? snapPoint(idx, p, SNAP_PX / pxPerUnit) : null;
      return hit ? { point: hit.point, snapped: true } : { point: p, snapped: false };
    };
    const binding: ViewerToolBinding = {
      cursor: 'crosshair',
      onPointerMove: (e) => setHover(snap(e.point, e.pxPerUnit)),
      onPointerLeave: () => setHover(null),
      onPointerDown: (e) => {
        const { state: s, actions: a } = live.current;
        const { point } = snap(e.point, e.pxPerUnit);
        if (s.tool === 'calibrate') {
          if (s.points.length === 1) {
            setCalibrationLine([s.points[0]!, point]);
            a.pick(null);
          } else a.add(point);
          return;
        }
        // Clicking the first point of a ring closes it (area); a double-click finishes a line.
        const first = s.points[0];
        if (
          s.tool === 'area' &&
          first &&
          s.points.length >= 3 &&
          Math.hypot(first.x - point.x, first.y - point.y) * e.pxPerUnit < SNAP_PX
        ) {
          a.closeRing();
          return;
        }
        a.add(point);
      },
      onKeyDown: (e) => {
        const { state: s, actions: a } = live.current;
        const nudge = e.shiftKey ? 0.01 : 0.001;
        switch (e.key) {
          case 'Enter':
            finishRef.current();
            return true;
          case 'Escape':
            a.reset();
            return true;
          case 'Backspace':
            a.undo();
            return true;
          case 'ArrowLeft':
          case 'ArrowRight':
          case 'ArrowUp':
          case 'ArrowDown':
            if (!s.points.length) return false;
            a.nudge(
              e.key === 'ArrowLeft' ? -nudge : e.key === 'ArrowRight' ? nudge : 0,
              e.key === 'ArrowUp' ? -nudge : e.key === 'ArrowDown' ? nudge : 0,
            );
            return true;
          default: {
            const t = TOOL_KEYS[e.key.toLowerCase()];
            if (t && live.current.canMeasure && !e.metaKey && !e.ctrlKey) {
              a.pick(t);
              return true;
            }
            return false;
          }
        }
      },
    };
    bindTool(binding);
  }, [tool, bindTool]);

  // Release the canvas when the panel closes.
  useEffect(() => () => bindTool(null), [bindTool]);

  const save = () =>
    mutations.save.mutate(
      { items: drafts, scale: scaleText!, scaleConfirmed: true, size: sheet.size },
      { onSuccess: () => setDrafts([]) },
    );

  const exportCsv = () => {
    const csv = measurementsToCsv(saved, () => `${sheet.sheetNumber} Rev ${sheet.rev}`);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sheet.sheetNumber}-rev-${sheet.rev}-quantities.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const applyCalibration = () => {
    const n = Number(knownLength);
    if (!calibrationLine || !(n > 0)) return;
    const r = calibrateScale(calibrationLine[0], calibrationLine[1], n, sheet.size);
    void sheet.confirmScale(formatScale(Math.round(r * 100) / 100));
    setCalibrationLine(null);
    setKnownLength('');
  };

  const totals = useMemo(() => totalsByTag(saved), [saved]);

  const overlay = (
    <>
      {showOld
        ? older.map((m) => (
            <GeometrySvg
              key={m.id}
              geometry={m.geometry}
              aspect={aspect}
              tone="old"
              label={`${m.label} (Rev ${olderRev(m.revisionId)})`}
            />
          ))
        : null}
      {onSheet.map((m) => (
        <GeometrySvg
          key={m.id}
          geometry={m.geometry}
          aspect={aspect}
          tone={markTone(m)}
          label={
            m.confirmed
              ? `${m.label}: ${formatQuantity(m.quantity, m.unit)}`
              : m.id === selectedMark && m.confidence !== null
                ? `${m.label} ${Math.round(m.confidence * 100)}%`
                : undefined
          }
        />
      ))}
      {drafts.map((d, i) => (
        <GeometrySvg key={i} geometry={d.geometry} aspect={aspect} tone="draft" label={d.label} />
      ))}
      {state.outer ? (
        <GeometrySvg
          geometry={{ kind: 'area', outer: state.outer, holes: state.holes }}
          aspect={aspect}
          tone="active"
        />
      ) : null}
      {state.tool === 'count' && state.points.length ? (
        <GeometrySvg
          geometry={{ kind: 'count', points: state.points }}
          aspect={aspect}
          tone="active"
        />
      ) : null}
      {state.tool && state.tool !== 'count' && state.points.length > 1 ? (
        <polyline
          points={state.points.map((p) => `${p.x * 1000},${(p.y * 1000) / aspect}`).join(' ')}
          fill="none"
          stroke="var(--c-action-primary)"
          strokeWidth={2}
        />
      ) : null}
      {state.tool ? (
        <CursorLayer
          points={state.tool === 'count' ? [] : state.points}
          hover={hover?.point ?? null}
          snapped={hover?.snapped ?? false}
          closing={state.tool === 'area'}
          aspect={aspect}
          live={liveQuantity}
        />
      ) : null}
    </>
  );

  return (
    <div className="stack takeoff-panel">
      {overlayTarget ? createPortal(overlay, overlayTarget) : null}
      <h2 className="panel-heading">Measure</h2>

      {!sheet.isCurrent && sheet.currentRevisionId ? (
        <Alert
          tone="warning"
          title={`Measured on Rev ${sheet.rev}, Rev ${sheet.currentRev} is current`}
          action={
            <Link className="link" href={sheet.revisionHref(sheet.currentRevisionId)}>
              Re-measure on Rev {sheet.currentRev}
            </Link>
          }
        >
          These quantities stay on Rev {sheet.rev}. Measure again on the current revision to update
          them.
        </Alert>
      ) : null}

      {sheet.isCurrent && older.length ? (
        <Alert
          tone="warning"
          title={`${older.length} measurement${older.length === 1 ? ' was' : 's were'} made on Rev ${olderRev(older[0]!.revisionId)}`}
          action={
            <Link className="link" href={sheet.compareHref(older[0]!.revisionId)}>
              Compare revisions
            </Link>
          }
        >
          They stay on that revision and are never moved. Show them over this sheet and re-measure
          what changed.
          <div>
            <Button
              size="sm"
              variant="secondary"
              aria-pressed={showOld}
              onClick={() => setShowOld((v) => !v)}
            >
              {showOld ? 'Hide' : 'Show'} Rev {olderRev(older[0]!.revisionId)} measurements
            </Button>
          </div>
        </Alert>
      ) : null}

      {sheet.isCurrent && !g ? (
        <Alert tone="info" title="Measuring isn't ready for this sheet">
          Archova hasn&apos;t read this sheet&apos;s scale and linework yet, so quantities
          can&apos;t be trusted. Measure and count open up once it has.
        </Alert>
      ) : null}

      {sheet.isCurrent && g ? (
        <ScaleSection
          sheet={sheet}
          timezone={project.timezone}
          calibrating={state.tool === 'calibrate'}
          onCalibrate={() => actions.pick(state.tool === 'calibrate' ? null : 'calibrate')}
        />
      ) : null}

      {g && !g.hasVector ? (
        <StatusPill tone="warning">Scanned sheet: no snapping, lower confidence</StatusPill>
      ) : null}

      <ToggleGroup<TakeoffTool | 'none'>
        label="Measuring tool"
        value={state.tool && state.tool !== 'calibrate' ? state.tool : 'none'}
        onValueChange={(v) => actions.pick(v === 'none' || v === state.tool ? null : v)}
        options={[
          { value: 'length', label: 'Length', shortcut: 'L', disabled: !canMeasure },
          { value: 'area', label: 'Area', shortcut: 'A', disabled: !canMeasure },
          { value: 'count', label: 'Count', shortcut: 'C', disabled: !canMeasure },
        ]}
      />
      {!canMeasure && sheet.isCurrent ? (
        <p className="u-caption u-m-0">Confirm the scale to start measuring.</p>
      ) : null}

      {sheet.isCurrent && g ? (
        <NovaTakeoffSection
          rows={onSheet}
          canFind={canMeasure}
          mutations={mutations}
          selectedId={selectedMark}
          onSelect={setSelectedMark}
          context={{
            revisionId: sheet.revisionId,
            trade,
            scale: scaleText ?? '',
            scaleConfirmed: Boolean(scaleText),
            size: sheet.size,
          }}
        />
      ) : null}

      <div className="form-row">
        <TextField
          label="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Door D1"
        />
        <Select
          label="Trade"
          placeholder="No trade"
          value={trade}
          onChange={(e) => setTrade(e.target.value)}
          options={TRADES.map((t) => ({ value: t, label: t }))}
        />
      </div>

      {state.tool && state.tool !== 'calibrate' ? (
        <div className="takeoff-active" aria-live="polite">
          <p className="u-m-0">
            {instructions(state.tool, Boolean(state.outer))}
            {liveQuantity ? (
              <>
                {' '}
                <strong>{liveQuantity}</strong>
              </>
            ) : null}
          </p>
          <div className="row-actions">
            <Button size="sm" disabled={!geometry} onClick={finish}>
              Finish
            </Button>
            {state.tool === 'area' && (state.points.length >= 3 || state.outer) ? (
              <Button size="sm" variant="secondary" onClick={actions.closeRing}>
                {state.outer ? 'Add another cut-out' : 'Close and add a cut-out'}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              disabled={!state.points.length && !state.outer}
              onClick={actions.undo}
            >
              Undo point
            </Button>
            <Button size="sm" variant="tertiary" onClick={actions.reset}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {drafts.length ? (
        <section aria-labelledby="takeoff-unsaved" className="stack">
          <h3 id="takeoff-unsaved" className="panel-subheading">
            Not saved yet ({drafts.length})
          </h3>
          <ul className="plain-list">
            {drafts.map((d, i) => (
              <li key={i} className="plain-list__item takeoff-row">
                <span>
                  {d.label}
                  {d.trade ? <span className="u-caption"> · {d.trade}</span> : null}
                </span>
                <span className="u-mono">
                  {ratio
                    ? formatQuantity(
                        takeoffQuantity(d.geometry, sheet.size, ratio),
                        UNIT_FOR_KIND[d.geometry.kind],
                      )
                    : null}
                </span>
                <Button
                  size="sm"
                  variant="tertiary"
                  onClick={() => setDrafts((all) => all.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <Button loading={mutations.save.isPending} onClick={save}>
            Save measurements
          </Button>
        </section>
      ) : null}
      <ErrorAlert
        error={mutations.save.error ?? measurements.error}
        title="We couldn't save the measurements"
      />

      <section aria-labelledby="takeoff-quantities" className="stack">
        <div className="row-actions takeoff-quantities__head">
          <h3 id="takeoff-quantities" className="panel-subheading">
            Quantities on Rev {sheet.rev}
          </h3>
          <Button size="sm" variant="secondary" disabled={!saved.length} onClick={exportCsv}>
            <Download size={16} strokeWidth={1.5} aria-hidden="true" />
            Export CSV
          </Button>
        </div>
        {saved.length === 0 ? (
          <p className="u-muted">No saved measurements on this revision.</p>
        ) : (
          <>
            <table className="ac-table ac-table--compact">
              <caption className="ac-visually-hidden">Totals by tag and unit</caption>
              <thead>
                <tr>
                  <th scope="col">Tag</th>
                  <th scope="col" className="ac-table__num">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {totals.map((t) => (
                  <tr key={`${t.tag}-${t.unit}`}>
                    <th scope="row">{t.tag}</th>
                    <td className="ac-table__num">{formatQuantity(t.quantity, t.unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="plain-list">
              {saved.map((m) => (
                <MeasurementRow key={m.id} m={m} onDelete={() => mutations.remove.mutate(m.id)} />
              ))}
            </ul>
            <div className="stack">
              <Select
                label="Send to tender package"
                value={packageId}
                placeholder="Choose a package"
                options={(packages.data ?? [])
                  .filter((p) => p.status !== 'awarded' && p.status !== 'cancelled')
                  .map((p) => ({
                    value: p.id,
                    label: `${formatPackageNumber(p.number)} ${p.name} (${p.trade})`,
                  }))}
                onChange={(e) => setPackageId(e.target.value)}
              />
              <div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!packageId || !unsent.length || mutations.sendToPackage.isPending}
                  onClick={() =>
                    mutations.sendToPackage.mutate({ ids: unsent.map((m) => m.id), packageId })
                  }
                >
                  Send {unsent.length} {unsent.length === 1 ? 'measurement' : 'measurements'}
                </Button>
              </div>
              {mutations.sendToPackage.isSuccess ? (
                <p className="u-caption u-m-0" role="status">
                  Sent as scope lines, one per tag and unit.
                </p>
              ) : null}
              <ErrorAlert
                error={mutations.sendToPackage.error}
                title="We couldn't send the quantities"
              />
            </div>
          </>
        )}
      </section>

      <Dialog
        open={calibrationLine !== null}
        onClose={() => setCalibrationLine(null)}
        title="How long is that line on site?"
        description="Type the real length of the dimension you traced. We work out the scale from it."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCalibrationLine(null)}>
              Cancel
            </Button>
            <Button disabled={!(Number(knownLength) > 0)} onClick={applyCalibration}>
              Set scale
            </Button>
          </>
        }
      >
        <TextField
          label="Length in metres"
          inputMode="decimal"
          value={knownLength}
          onChange={(e) => setKnownLength(e.target.value)}
          autoFocus
        />
      </Dialog>
    </div>
  );
}

function MeasurementRow({ m, onDelete }: { m: TakeoffMeasurement; onDelete: () => void }) {
  return (
    <li className="plain-list__item takeoff-row">
      <span>
        {m.label}
        {m.trade ? <span className="u-caption"> · {m.trade}</span> : null}
        <span className="u-caption"> · {m.createdBy}</span>
        {m.raster ? <StatusPill tone="warning">Lower confidence</StatusPill> : null}
        {m.source === 'manual' ? null : <StatusPill tone="ai">Nova-assisted</StatusPill>}
      </span>
      <span className="u-mono">{formatQuantity(m.quantity, m.unit)}</span>
      <Button size="sm" variant="tertiary" onClick={onDelete} aria-label={`Delete ${m.label}`}>
        Delete
      </Button>
    </li>
  );
}

export function totalsByTag(
  rows: readonly TakeoffMeasurement[],
): Array<{ tag: string; unit: TakeoffUnit; quantity: number }> {
  const map = new Map<string, { tag: string; unit: TakeoffUnit; quantity: number }>();
  for (const m of rows) {
    // Nova's marks carry the room after a dot ("Power point · Living"); the totals add up per item.
    const name = m.source === 'manual' ? m.label : (m.label.split(' · ')[0] ?? m.label);
    const tag = m.trade ? `${m.trade}: ${name}` : name;
    const key = `${tag}|${m.unit}`;
    const t = map.get(key) ?? { tag, unit: m.unit, quantity: 0 };
    t.quantity += m.quantity;
    map.set(key, t);
  }
  return [...map.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}

/** How a mark is drawn: accepted and hand-drawn are solid; Nova's waiting marks are dashed, teal when sure. */
function markTone(m: TakeoffMeasurement) {
  if (m.confirmed) return 'saved' as const;
  if (m.rejected) return 'rejected' as const;
  return (m.confidence ?? 0) >= NOVA_SURE ? ('nova' as const) : ('nova-low' as const);
}

function defaultLabel(kind: 'length' | 'area' | 'count', n: number): string {
  return `${kind === 'length' ? 'Length' : kind === 'area' ? 'Area' : 'Count'} ${n}`;
}

function instructions(tool: TakeoffTool, hasOuter: boolean): string {
  switch (tool) {
    case 'length':
      return 'Click each point along the run. Enter or Finish ends it.';
    case 'area':
      return hasOuter
        ? 'Click the corners of the cut-out to deduct.'
        : 'Click each corner. Click the first point again to close.';
    case 'count':
      return 'Click each item to drop a numbered marker.';
    case 'calibrate':
      return 'Click both ends of a known dimension.';
  }
}
