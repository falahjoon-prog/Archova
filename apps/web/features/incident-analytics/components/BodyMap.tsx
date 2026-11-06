'use client';

import { BODY_PART_LABELS, MAPPED_BODY_PARTS, type BodyPart } from '@archova/domain';
import { heatColour } from '../lib/colours';
import type { InjuryCount } from '../lib/types';

type Shape =
  | { k: 'rect'; x: number; y: number; w: number; h: number; r?: number }
  | { k: 'ellipse'; cx: number; cy: number; rx: number; ry: number };

const mirror = (s: Shape): Shape =>
  s.k === 'rect' ? { ...s, x: 100 - s.x - s.w } : { ...s, cx: 100 - s.cx };
const pair = (s: Shape): Shape[] => [s, mirror(s)];

const rect = (x: number, y: number, w: number, h: number, r = 3): Shape => ({
  k: 'rect',
  x,
  y,
  w,
  h,
  r,
});
const ell = (cx: number, cy: number, rx: number, ry: number): Shape => ({
  k: 'ellipse',
  cx,
  cy,
  rx,
  ry,
});

// Limbs and head are the same from the front and the back; the trunk differs.
const COMMON: [BodyPart, Shape[]][] = [
  ['head', [ell(50, 12, 9.5, 10)]],
  ['neck', [rect(46, 24, 8, 7, 2)]],
  ['shoulder', pair(ell(32, 37, 7.5, 5.5))],
  ['upper_arm', pair(rect(22, 41, 8, 22))],
  ['elbow', pair(ell(26, 66, 4.5, 4))],
  ['forearm', pair(rect(21, 70, 8, 20))],
  ['wrist', pair(rect(21.5, 91, 7, 5, 2))],
  ['hand', pair(ell(25, 101, 5, 6))],
  ['fingers', pair(rect(21.5, 107, 7, 8, 3))],
  ['thigh', pair(rect(38, 82, 11.5, 31, 5))],
  ['knee', pair(ell(43.5, 118, 6, 5))],
  ['lower_leg', pair(rect(38.5, 124, 10.5, 36, 4))],
  ['ankle', pair(rect(39.5, 161, 8.5, 6, 2))],
  ['foot', pair(ell(43, 173, 6, 5))],
  ['toes', pair(rect(37.5, 179, 10, 5, 2))],
];

const FRONT: [BodyPart, Shape[]][] = [
  ...COMMON,
  ['face', [rect(44, 16, 12, 8, 3)]],
  ['eye', pair(ell(46, 11, 2.4, 1.8))],
  ['chest', [rect(36, 34, 28, 19)]],
  ['abdomen', [rect(37, 54, 26, 15)]],
  ['hip_groin', [rect(36, 70, 28, 11, 4)]],
];

const BACK: [BodyPart, Shape[]][] = [
  ...COMMON,
  ['upper_back', [rect(36, 34, 28, 19)]],
  ['lower_back', [rect(37, 54, 26, 15)]],
  ['hip_groin', [rect(36, 70, 28, 11, 4)]],
];

function Figure({
  title,
  regions,
  counts,
  max,
  selected,
  onSelect,
}: {
  title: string;
  regions: [BodyPart, Shape[]][];
  counts: Map<string, number>;
  max: number;
  selected: string;
  onSelect: (part: string) => void;
}) {
  return (
    <figure className="ia-body-figure">
      <svg
        className="ia-body"
        viewBox="0 0 100 190"
        role="group"
        aria-label={`Body map, ${title.toLowerCase()} view`}
      >
        {regions.map(([part, shapes]) => {
          const n = counts.get(part) ?? 0;
          const label = `${BODY_PART_LABELS[part]}: ${n} ${n === 1 ? 'injury' : 'injuries'}`;
          return (
            <g
              key={part}
              role="button"
              tabIndex={0}
              aria-pressed={selected === part}
              aria-label={label}
              className="ia-region"
              onClick={() => onSelect(selected === part ? '' : part)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(selected === part ? '' : part);
                }
              }}
              style={{ fill: heatColour(n, max) }}
            >
              <title>{label}</title>
              {shapes.map((s, i) =>
                s.k === 'rect' ? (
                  <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r ?? 0} />
                ) : (
                  <ellipse key={i} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} />
                ),
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="ia-body__caption">{title}</figcaption>
    </figure>
  );
}

/**
 * Front and back outlines shaded by how many injuries each part has (one blue ramp, darker is more). Click or press
 * a part to filter to it. Parts that are not one place on the body are listed underneath.
 */
export function BodyMap({
  byBodyPart,
  selected,
  onSelect,
}: {
  byBodyPart: readonly InjuryCount[];
  selected: string;
  onSelect: (part: string) => void;
}) {
  const counts = new Map(byBodyPart.map((c) => [c.key, c.count]));
  const max = Math.max(0, ...MAPPED_BODY_PARTS.map((p) => counts.get(p) ?? 0));
  const unplaced = [
    ['multiple', BODY_PART_LABELS.multiple],
    ['systemic', BODY_PART_LABELS.systemic],
    ['unknown', 'Not recorded'],
  ] as const;
  return (
    <div>
      <div className="ia-bodies">
        <Figure
          title="Front"
          regions={FRONT}
          counts={counts}
          max={max}
          selected={selected}
          onSelect={onSelect}
        />
        <Figure
          title="Back"
          regions={BACK}
          counts={counts}
          max={max}
          selected={selected}
          onSelect={onSelect}
        />
      </div>
      <div className="ia-scale" aria-hidden="true">
        <span>Fewer</span>
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <span key={n} className="ia-scale__swatch" style={{ background: `var(--ia-seq-${n})` }} />
        ))}
        <span>More injuries{max > 0 ? ` (up to ${max})` : ''}</span>
      </div>
      <ul className="ia-legend" aria-label="Injuries not placed on the body">
        {unplaced.map(([key, label]) => (
          <li key={key} className="ia-legend__item">
            {key === 'unknown' ? (
              label
            ) : (
              <button
                type="button"
                className="link"
                aria-pressed={selected === key}
                onClick={() => onSelect(selected === key ? '' : key)}
              >
                {label}
              </button>
            )}
            <span className="ia-legend__count">{counts.get(key) ?? 0}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
