'use client';

import { KIND_LABELS, layoutDay, fmtTime } from '../lib/board';
import type { Delivery, DeliveryFlag, Resource } from '../data/api';

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;

/**
 * The day laid out by dock and crane, so clashes and gaps are visible at a glance. Blocks for deliveries Nova has
 * flagged get a red outline. The timeline scrolls inside its own frame on a phone; the list below is the main view there.
 */
export function DayTimeline({
  deliveries,
  resources,
  flags,
  day,
  tz,
  onOpen,
}: {
  deliveries: readonly Delivery[];
  resources: readonly Resource[];
  flags: readonly DeliveryFlag[];
  day: string;
  tz: string;
  onOpen: (id: string) => void;
}) {
  const { lanes, hours } = layoutDay(deliveries, resources, day, tz);
  const hourList = Array.from({ length: hours.end - hours.start }, (_, i) => hours.start + i);
  if (lanes.length === 0) return null;
  const clashing = new Set(
    flags
      .filter((f) => f.kind === 'double_booked' || f.kind === 'lift_clash')
      .map((f) => f.deliveryId),
  );
  return (
    <div className="dlv-timeline" role="group" aria-label="Day schedule by dock and crane">
      <div className="dlv-timeline__scroll">
        <div className="dlv-timeline__grid">
          <div className="dlv-row dlv-row--head">
            <span className="dlv-row__name" />
            <span
              className="dlv-row__track dlv-hours"
              style={{ gridTemplateColumns: `repeat(${hourList.length}, 1fr)` }}
            >
              {hourList.map((h, i) => (
                <span key={h}>{i % (hourList.length > 14 ? 2 : 1) === 0 ? hourLabel(h) : ''}</span>
              ))}
            </span>
          </div>
          {lanes.map(({ resource, blocks }) => (
            <div className="dlv-row" key={resource.id}>
              <span className="dlv-row__name">
                {resource.name}
                <span className="u-caption"> {KIND_LABELS[resource.kind]}</span>
              </span>
              <span className="dlv-row__track">
                {blocks.map((b) => (
                  <button
                    key={`${b.delivery.id}-${b.lift ? 'lift' : 'dock'}`}
                    type="button"
                    className={`dlv-block dlv-block--${b.delivery.status}${clashing.has(b.delivery.id) ? ' dlv-block--clash' : ''}`}
                    style={{ left: `${b.left}%`, width: `${b.width}%` }}
                    onClick={() => onOpen(b.delivery.id)}
                    title={`#${b.delivery.number} ${b.delivery.supplierName}, ${fmtTime(b.delivery.windowStart, tz)}`}
                  >
                    #{b.delivery.number} {b.delivery.supplierName}
                  </button>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
