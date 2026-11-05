'use client';

import { useMemo, useState } from 'react';
import { EmptyState, Select, SkeletonRows, StatusPill, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate } from '@/shared/lib/format';
import { addDays, type LocalDate } from '@archova/time';
import { useLookahead } from '../hooks/useProgramme';
import { floatLabel } from '../lib/labels';
import { groupByWeek } from '../lib/lookahead';

const WEEK_OPTIONS = [2, 3, 4, 6].map((n) => ({ value: String(n), label: `${n} weeks` }));

/** SCH-US8: what is on site over the next few weeks, week by week, so it can be agreed with the trades. */
export function LookaheadView({
  scheduleId,
  onOpen,
}: {
  scheduleId: string;
  onOpen?: (activityId: string) => void;
}) {
  const [weeks, setWeeks] = useState(3);
  const [who, setWho] = useState('');
  const q = useLookahead(scheduleId, weeks);
  const items = useMemo(() => {
    const all = q.data?.items ?? [];
    const needle = who.trim().toLowerCase();
    return needle ? all.filter((i) => i.activity.assignee.toLowerCase().includes(needle)) : all;
  }, [q.data, who]);
  const groups = useMemo(
    () => (q.data ? groupByWeek(items, q.data.windowStart, weeks) : []),
    [items, q.data, weeks],
  );

  return (
    <div className="stack">
      <div className="form-row form-row--end">
        <Select
          label="Look ahead"
          options={WEEK_OPTIONS}
          value={String(weeks)}
          onChange={(e) => setWeeks(Number(e.target.value))}
        />
        <TextField
          label="Filter by who does it"
          hint="A company or crew name."
          value={who}
          onChange={(e) => setWho(e.target.value)}
        />
      </div>
      <ErrorAlert error={q.error} title="We couldn't load the look-ahead" />
      {q.isPending ? <SkeletonRows rows={4} label="Loading look-ahead…" /> : null}
      {q.data && !items.length ? (
        <EmptyState
          title="Nothing on the programme in this window"
          description={
            who
              ? 'No activity matches that name.'
              : `No unfinished work between ${formatLocalDate(q.data.windowStart)} and ${formatLocalDate(q.data.windowEnd)}.`
          }
        />
      ) : null}
      {groups.map((g) => (
        <section
          key={g.start}
          className="lookahead-week"
          aria-label={`Week of ${formatLocalDate(g.start)}`}
        >
          <h3 className="lookahead-week__title">
            Week of {formatLocalDate(g.start)}
            <span className="u-muted"> to {formatLocalDate(addDays(g.start, 6) as LocalDate)}</span>
          </h3>
          {g.items.length ? (
            <ul className="lookahead-list">
              {g.items.map((i) => (
                <li key={i.activity.id} className="lookahead-item">
                  <div className="lookahead-item__main">
                    {onOpen ? (
                      <button
                        type="button"
                        className="gantt__name gantt__name--button"
                        onClick={() => onOpen(i.activity.id)}
                      >
                        {i.activity.name}
                      </button>
                    ) : (
                      <span className="gantt__name">{i.activity.name}</span>
                    )}
                    <span className="gantt__meta">
                      {i.activity.kind === 'milestone'
                        ? formatLocalDate(i.activity.start)
                        : `${formatLocalDate(i.activity.start)} to ${formatLocalDate(i.activity.finish)}`}
                      {i.activity.assignee ? ` · ${i.activity.assignee}` : ''}
                      {i.activity.pctComplete ? ` · ${i.activity.pctComplete}% done` : ''}
                    </span>
                  </div>
                  <div className="lookahead-item__pills">
                    {i.late ? <StatusPill tone="danger">Behind</StatusPill> : null}
                    {i.activity.critical ? (
                      <StatusPill tone="warning">
                        {floatLabel(i.activity.floatDays, true)}
                      </StatusPill>
                    ) : null}
                    {i.activity.kind === 'milestone' ? (
                      <StatusPill tone="info">Milestone</StatusPill>
                    ) : null}
                    {g.starting.has(i.activity.id) ? (
                      <StatusPill tone="neutral">Starts</StatusPill>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="u-muted u-m-0">No work starts or runs this week.</p>
          )}
        </section>
      ))}
    </div>
  );
}
