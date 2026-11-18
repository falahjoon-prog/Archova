'use client';

import { useMemo, useState } from 'react';
import { Alert, Button, Card, EmptyState, Select, SkeletonRows, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { divisionOf } from '../lib/costReport';
import {
  CURVES,
  CURVE_LABEL,
  fromCents,
  monthLabel,
  monthsBetween,
  spread,
  toCents,
  type Curve,
} from '../lib/forecast';
import { aud, parseAmount } from '../lib/money';
import { useForecast, useSaveForecast } from '../hooks/useBudget';

type Draft = Record<string, Record<string, string>>;

/**
 * Cash-flow forecast: what each cost code is expected to spend each month. Pick rows, give a date range and a
 * curve to spread their projected cost, or type a month's amount directly. Nothing is saved until you save.
 */
export function ForecastPanel({ canManage }: { canManage: boolean }) {
  const project = useCurrentProject();
  const forecast = useForecast(project.projectId);
  const save = useSaveForecast(project.projectId);
  const [draft, setDraft] = useState<Draft>({});
  const [extra, setExtra] = useState<string[]>([]);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [curve, setCurve] = useState<Curve>('even');
  const [problem, setProblem] = useState<string | null>(null);

  const lines = forecast.data?.lines ?? [];
  const months = useMemo(
    () => [...new Set([...(forecast.data?.months ?? []), ...extra])].sort(),
    [forecast.data?.months, extra],
  );
  if (forecast.isPending) return <SkeletonRows rows={5} />;
  if (forecast.error)
    return <ErrorAlert error={forecast.error} title="We couldn't load the forecast" />;
  if (!forecast.data.hasBudget || lines.length === 0)
    return (
      <EmptyState
        title="No budget lines yet"
        description="Add budget lines, then spread their cost over the months here."
      />
    );

  const valueOf = (lineId: string, m: string) =>
    draft[lineId]?.[m] ?? lines.find((l) => l.lineId === lineId)?.entries[m] ?? '';
  const rowCents = (lineId: string) =>
    months.reduce((n, m) => n + toCents(valueOf(lineId, m) || '0'), 0);
  const dirty = Object.keys(draft);

  const apply = () => {
    const range = monthsBetween(start, end);
    if (!range) {
      setProblem('Give a start and end month like 2026-11, with the end after the start.');
      return;
    }
    if (picked.size === 0) {
      setProblem('Select at least one cost code.');
      return;
    }
    setProblem(null);
    setExtra((e) => [...new Set([...e, ...range])]);
    setDraft((d) => {
      const next = { ...d };
      for (const id of picked) {
        const l = lines.find((x) => x.lineId === id);
        if (!l) continue;
        const total = Math.max(toCents(l.projected), 0);
        // The range replaces this line's forecast: months outside it are cleared.
        next[id] = Object.fromEntries([...new Set([...months, ...range])].map((m) => [m, '0.00']));
        Object.assign(next[id]!, spread(total, range, curve));
      }
      return next;
    });
  };

  const edit = (lineId: string, m: string, v: string) => {
    setDraft((d) => {
      const base = d[lineId] ?? Object.fromEntries(months.map((x) => [x, valueOf(lineId, x)]));
      return { ...d, [lineId]: { ...base, [m]: v } };
    });
  };

  const bad = dirty.some((id) =>
    Object.values(draft[id]!).some((v) => v !== '' && parseAmount(v) === null),
  );
  const onSave = () =>
    save.mutate(
      dirty.map((lineId) => ({
        lineId,
        entries: Object.fromEntries(
          Object.entries(draft[lineId]!).filter(([, v]) => v !== '' && parseAmount(v) !== null),
        ),
      })),
      {
        onSuccess: () => {
          setDraft({});
          setExtra([]);
          setPicked(new Set());
        },
      },
    );

  const divisions = [...new Set(lines.map((l) => divisionOf(l.code)))];
  const sumFor = (ids: string[], m: string) =>
    ids.reduce((n, id) => n + toCents(valueOf(id, m) || '0'), 0);
  const money = (c: number) => <span className="u-mono u-nowrap">{aud(fromCents(c))}</span>;
  const colSum = (ids: string[], pick: (l: (typeof lines)[number]) => string) =>
    money(ids.reduce((n, id) => n + toCents(pick(lines.find((l) => l.lineId === id)!)), 0));

  const row = (ids: string[], label: React.ReactNode, strong: boolean, lineId?: string) => (
    <tr key={lineId ?? String(label)} style={strong ? { fontWeight: 600 } : undefined}>
      <th scope="row">
        {lineId && canManage ? (
          <input
            type="checkbox"
            aria-label={`Select ${label as string}`}
            checked={picked.has(lineId)}
            onChange={(e) =>
              setPicked((p) => {
                const n = new Set(p);
                if (e.target.checked) n.add(lineId);
                else n.delete(lineId);
                return n;
              })
            }
          />
        ) : null}{' '}
        {label}
      </th>
      <td className="ac-table__num">{colSum(ids, (l) => l.revised)}</td>
      <td className="ac-table__num">{colSum(ids, (l) => l.approved)}</td>
      <td className="ac-table__num">{colSum(ids, (l) => l.pending)}</td>
      <td className="ac-table__num">{colSum(ids, (l) => l.nonCommitted)}</td>
      <td className="ac-table__num">{colSum(ids, (l) => l.projected)}</td>
      {months.map((m) => (
        <td key={m} className="ac-table__num">
          {lineId && canManage ? (
            <input
              className="ac-input"
              style={{ width: '7.5rem', textAlign: 'right' }}
              inputMode="decimal"
              aria-label={`${label as string} ${monthLabel(m)}`}
              value={valueOf(lineId, m)}
              onChange={(e) => edit(lineId, m, e.target.value)}
            />
          ) : (
            money(sumFor(ids, m))
          )}
        </td>
      ))}
      <td className="ac-table__num">{money(ids.reduce((n, id) => n + rowCents(id), 0))}</td>
      <td className="ac-table__num">
        {money(
          ids.reduce(
            (n, id) => n + toCents(lines.find((l) => l.lineId === id)!.projected) - rowCents(id),
            0,
          ),
        )}
      </td>
    </tr>
  );

  return (
    <Card>
      <section aria-labelledby="forecast-title" className="stack">
        <div>
          <h2 id="forecast-title" className="u-m-0">
            Forecast
          </h2>
          <p className="u-m-0 u-caption">
            Spread each cost code&apos;s projected cost over the months it will be spent. Not yet
            placed shows what is left to spread. Changes are not saved until you press Save.
          </p>
        </div>

        {canManage ? (
          <div className="row-actions" role="group" aria-label="Spread selected cost codes">
            <TextField
              label="Start month"
              placeholder="2026-11"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
            <TextField
              label="End month"
              placeholder="2027-08"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
            <Select
              label="Curve"
              value={curve}
              options={CURVES.map((c) => ({ value: c, label: CURVE_LABEL[c] }))}
              onChange={(e) => setCurve(e.target.value as Curve)}
            />
            <Button variant="secondary" onClick={apply}>
              Apply to {picked.size} selected
            </Button>
            <Button variant="secondary" onClick={() => setPicked(new Set())}>
              Cancel
            </Button>
          </div>
        ) : null}
        {problem ? <Alert tone="warning">{problem}</Alert> : null}
        <ErrorAlert error={save.error} title="We couldn't save the forecast" />

        <div className="ac-table-wrap">
          <table className="ac-table ac-table--compact">
            <thead>
              <tr>
                <th scope="col">Cost code</th>
                <th scope="col" className="ac-table__num">
                  Current budget
                </th>
                <th scope="col" className="ac-table__num">
                  Total committed
                </th>
                <th scope="col" className="ac-table__num">
                  Pending contracts
                </th>
                <th scope="col" className="ac-table__num">
                  Uncommitted
                </th>
                <th scope="col" className="ac-table__num">
                  Total anticipated
                </th>
                {months.map((m) => (
                  <th key={m} scope="col" className="ac-table__num">
                    {monthLabel(m)}
                  </th>
                ))}
                <th scope="col" className="ac-table__num">
                  Placed
                </th>
                <th scope="col" className="ac-table__num">
                  Not yet placed
                </th>
              </tr>
            </thead>
            {divisions.map((d) => {
              const ls = lines.filter((l) => divisionOf(l.code) === d);
              const ids = ls.map((l) => l.lineId);
              return (
                <tbody key={d}>
                  {row(ids, `Subtotal ${d}`, true)}
                  {ls.map((l) =>
                    row([l.lineId], `${l.code} ${l.codeDescription}`, false, l.lineId),
                  )}
                </tbody>
              );
            })}
            <tfoot>
              {row(
                lines.map((l) => l.lineId),
                'Grand total',
                true,
              )}
            </tfoot>
          </table>
        </div>

        {canManage ? (
          <div className="row-actions">
            <Button
              loading={save.isPending}
              disabled={dirty.length === 0 || bad || save.isPending}
              onClick={onSave}
            >
              Save forecast
            </Button>
            <Button
              variant="secondary"
              disabled={dirty.length === 0}
              onClick={() => {
                setDraft({});
                setExtra([]);
              }}
            >
              Discard changes
            </Button>
            {bad ? <span className="u-caption">Fix the amounts shown in red first.</span> : null}
          </div>
        ) : null}
      </section>
    </Card>
  );
}
