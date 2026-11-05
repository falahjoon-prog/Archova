'use client';

import { useEffect, useMemo, useRef } from 'react';
import { StatusPill } from '@archova/ui';
import { formatLocalDate } from '@/shared/lib/format';
import type { ScheduleActivity, ScheduleDetail } from '../data/programme';
import { openItemsLabel, type OpenItems } from '../lib/links';
import { barBox, chartSpan, weekendBands, weekTicks, ZOOMS, type Zoom } from '../lib/gantt';

const ROW_H = 44;
const HEAD_H = 32;

/**
 * The programme as a Gantt chart: the activity list on the left stays put while the timeline scrolls sideways inside
 * the chart (never the page). Critical activities are red, broken links are drawn dashed, today is the marked line.
 */
export function GanttChart({
  detail,
  today,
  zoom,
  openItems,
  onSelect,
}: {
  detail: ScheduleDetail;
  today: string;
  zoom: Zoom;
  /** Linked RFIs and submittals still open, by activity id; each gets a marker (SCH-US10). */
  openItems?: ReadonlyMap<string, OpenItems>;
  /** Set when the caller may edit; each activity then opens its editor. */
  onSelect?: (a: ScheduleActivity) => void;
}) {
  const dayWidth = ZOOMS[zoom];
  const { activities, dependencies, schedule } = detail;
  const span = useMemo(
    () =>
      chartSpan(
        activities.flatMap((a) => [a.start, a.finish]),
        today,
      ),
    [activities, today],
  );
  const width = span.days * dayWidth;
  const ticks = useMemo(() => weekTicks(span, dayWidth), [span, dayWidth]);
  const weekends = useMemo(() => weekendBands(span, dayWidth), [span, dayWidth]);
  const scroller = useRef<HTMLDivElement>(null);
  const rowOf = new Map(activities.map((a, i) => [a.id, i]));
  const byId = new Map(activities.map((a) => [a.id, a]));
  const todayLeft = barBox(span, today, today, dayWidth).left + dayWidth / 2;
  const dataLeft = schedule.dataDate
    ? barBox(span, schedule.dataDate, schedule.dataDate, dayWidth).left + dayWidth / 2
    : null;

  // Open on today, with a little of the past before it, instead of the programme's first week.
  useEffect(() => {
    scroller.current?.scrollTo({ left: Math.max(0, todayLeft - 96) });
  }, [todayLeft]);

  const links = dependencies.flatMap((d) => {
    const p = byId.get(d.predecessorId);
    const s = byId.get(d.successorId);
    if (!p || !s) return [];
    const pb = barBox(span, p.start, p.finish, dayWidth);
    const sb = barBox(span, s.start, s.finish, dayWidth);
    const fromEnd = d.type === 'FS' || d.type === 'FF';
    const toStart = d.type === 'FS' || d.type === 'SS';
    const x1 = fromEnd ? pb.left + pb.width : pb.left;
    const x2 = toStart ? sb.left : sb.left + sb.width;
    const y1 = rowOf.get(p.id)! * ROW_H + ROW_H / 2;
    const y2 = rowOf.get(s.id)! * ROW_H + ROW_H / 2;
    const out = fromEnd ? x1 + 8 : x1 - 8;
    const into = toStart ? x2 - 8 : x2 + 8;
    const yMid = y2 > y1 ? y1 + ROW_H / 2 : y1 - ROW_H / 2;
    return [
      { id: d.id, violated: d.violated, d: `M${x1} ${y1} H${out} V${yMid} H${into} V${y2} H${x2}` },
    ];
  });

  return (
    <div className="gantt" role="group" aria-label={`Gantt chart of ${schedule.name}`}>
      <div className="gantt__scroll" ref={scroller}>
        <div className="gantt__grid" style={{ ['--gantt-chart-w' as string]: `${width}px` }}>
          <div className="gantt__row gantt__row--head" style={{ height: HEAD_H }}>
            <div className="gantt__list gantt__list--head">Activity</div>
            <div className="gantt__lane gantt__lane--head" aria-hidden="true">
              {ticks.map((t) => (
                <span key={t.date} className="gantt__tick" style={{ left: t.left }}>
                  {t.label}
                </span>
              ))}
            </div>
          </div>
          <div className="gantt__body">
            {activities.map((a) => {
              const box = barBox(span, a.start, a.finish, dayWidth);
              const open = openItems?.get(a.id);
              const openText = open ? openItemsLabel(open) : '';
              const range = `${formatLocalDate(a.start)}${a.kind === 'milestone' ? '' : ` to ${formatLocalDate(a.finish)}`}`;
              return (
                <div key={a.id} className="gantt__row" style={{ height: ROW_H }}>
                  <div className="gantt__list">
                    {onSelect ? (
                      <button
                        type="button"
                        className="gantt__name gantt__name--button"
                        onClick={() => onSelect(a)}
                      >
                        {a.name}
                      </button>
                    ) : (
                      <span className="gantt__name">{a.name}</span>
                    )}
                    <span className="gantt__meta" title={openText || undefined}>
                      {a.wbs ? `${a.wbs} · ` : ''}
                      {range}
                      {a.assignee ? ` · ${a.assignee}` : ''}
                      {open ? (
                        <span className="gantt__open" data-risk={open.atRisk || undefined}>
                          {' · '}
                          {openText}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="gantt__lane">
                    {weekends.map((w) => (
                      <span
                        key={w.left}
                        className="gantt__weekend"
                        style={{ left: w.left, width: w.width }}
                      />
                    ))}
                    {open ? (
                      <span
                        className="gantt__flag"
                        data-risk={open.atRisk || undefined}
                        style={{
                          left: box.left + (a.kind === 'milestone' ? dayWidth : box.width) + 6,
                        }}
                        role="img"
                        aria-label={openText}
                        title={openText}
                      >
                        {open.rfis + open.submittals}
                      </span>
                    ) : null}
                    {a.kind === 'milestone' ? (
                      <span
                        className="gantt__milestone"
                        data-critical={a.critical || undefined}
                        style={{ left: box.left + dayWidth / 2 - 8 }}
                        role="img"
                        aria-label={`${a.name}, milestone, ${range}`}
                      />
                    ) : (
                      <span
                        className="gantt__bar"
                        data-critical={a.critical || undefined}
                        style={{ left: box.left, width: box.width }}
                        role="img"
                        aria-label={`${a.name}, ${range}, ${a.pctComplete}% complete${a.critical ? ', critical' : ''}`}
                      >
                        <span className="gantt__progress" style={{ width: `${a.pctComplete}%` }} />
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            <svg
              className="gantt__links"
              width={width}
              height={activities.length * ROW_H}
              aria-hidden="true"
            >
              {links.map((l) => (
                <path
                  key={l.id}
                  d={l.d}
                  className="gantt__link"
                  data-violated={l.violated || undefined}
                />
              ))}
            </svg>
            <span
              className="gantt__today"
              style={{ left: `calc(var(--gantt-list-w) + ${todayLeft}px)` }}
              aria-hidden="true"
            />
            {dataLeft !== null ? (
              <span
                className="gantt__data-date"
                style={{ left: `calc(var(--gantt-list-w) + ${dataLeft}px)` }}
                aria-hidden="true"
              />
            ) : null}
          </div>
        </div>
      </div>
      <ul className="gantt__legend" aria-label="Key">
        <li>
          <span className="gantt__swatch" /> Activity
        </li>
        <li>
          <span className="gantt__swatch" data-critical="true" /> Critical (no float)
        </li>
        <li>
          <span className="gantt__swatch gantt__swatch--link" /> Link
        </li>
        <li>
          <span className="gantt__swatch gantt__swatch--flag" /> Open RFIs or submittals
        </li>
        <li>
          <span className="gantt__swatch gantt__swatch--link" data-violated="true" /> Broken link
        </li>
        <li>
          <span className="gantt__swatch gantt__swatch--today" /> Today
        </li>
        {schedule.dataDate ? (
          <li>
            <StatusPill tone="neutral">Data date {formatLocalDate(schedule.dataDate)}</StatusPill>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
