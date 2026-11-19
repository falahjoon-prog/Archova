'use client';

import { useId } from 'react';
import { BODY_PART_LABELS, MAPPED_BODY_PARTS, type BodyPart } from '@archova/domain';
import { heatColour } from '../lib/colours';
import type { InjuryCount } from '../lib/types';

type Shape =
  | { k: 'rect'; x: number; y: number; w: number; h: number }
  | { k: 'ellipse'; cx: number; cy: number; rx: number; ry: number };

const mirror = (s: Shape): Shape =>
  s.k === 'rect' ? { ...s, x: 100 - s.x - s.w } : { ...s, cx: 100 - s.cx };
const pair = (s: Shape): Shape[] => [s, mirror(s)];
const rect = (x: number, y: number, w: number, h: number): Shape => ({ k: 'rect', x, y, w, h });
const ell = (cx: number, cy: number, rx: number, ry: number): Shape => ({
  k: 'ellipse',
  cx,
  cy,
  rx,
  ry,
});

// One outline of an adult standing figure (8 heads tall), left side from the neck down to the feet; the right side
// is its mirror. The regions below are bands laid over it and clipped to it, so shading follows the body's contour.
const LEFT_SIDE: [number, number][] = [
  [45, 22],
  [45, 27],
  [38, 29.5],
  [29, 32],
  [24, 38],
  [22, 50],
  [20, 64],
  [17.5, 80],
  [15.5, 94],
  [14, 101],
  [15, 108],
  [19.5, 108],
  [21, 101],
  [23, 90],
  [25.5, 72],
  [27.5, 56],
  [30.5, 46],
  [31, 58],
  [32.5, 72],
  [31.5, 86],
  [32.5, 100],
  [35, 114],
  [35.5, 126],
  [36, 142],
  [37.5, 160],
  [37, 170],
  [35, 178],
  [34, 186],
  [40, 188],
  [46, 186],
  [46, 176],
  [45.5, 164],
  [45.5, 146],
  [46, 128],
  [47, 114],
  [48.5, 98],
  [50, 90],
];

/** Closed smooth path through the points, curves meeting at the midpoint of each segment. */
function smoothPath(pts: [number, number][]): string {
  const n = pts.length;
  const mid = (a: [number, number], b: [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const f = (v: number) => v.toFixed(2);
  const start = mid(pts[n - 1]!, pts[0]!);
  let d = `M${f(start[0]!)} ${f(start[1]!)}`;
  for (let i = 0; i < n; i += 1) {
    const p = pts[i]!;
    const m = mid(p, pts[(i + 1) % n]!);
    d += ` Q${f(p[0])} ${f(p[1])} ${f(m[0]!)} ${f(m[1]!)}`;
  }
  return `${d}Z`;
}

const BODY_PATH = (() => {
  const right = LEFT_SIDE.map(([x, y]) => [100 - x, y] as [number, number]).reverse();
  return smoothPath([...LEFT_SIDE, ...right]);
})();
const HEAD = { cx: 50, cy: 11, rx: 8.6, ry: 10.6 };

// Limbs and head are the same from the front and the back; the trunk differs.
const COMMON: [BodyPart, Shape[]][] = [
  ['head', [rect(38, 0, 24, 22)]],
  ['neck', [rect(40, 22, 20, 8)]],
  ['shoulder', pair(rect(10, 29, 26, 15))],
  ['upper_arm', pair(rect(10, 44, 20, 18))],
  ['elbow', pair(rect(10, 62, 19, 8))],
  ['forearm', pair(rect(10, 70, 18, 20))],
  ['wrist', pair(rect(10, 90, 16, 6))],
  ['hand', pair(rect(10, 96, 14, 7))],
  ['fingers', pair(rect(10, 103, 14, 8))],
  ['thigh', pair(rect(28, 90, 22, 22))],
  ['knee', pair(rect(28, 112, 22, 12))],
  ['lower_leg', pair(rect(28, 124, 22, 39))],
  ['ankle', pair(rect(28, 163, 22, 7))],
  ['foot', pair(rect(28, 170, 22, 11))],
  ['toes', pair(rect(28, 181, 22, 9))],
];

const TRUNK = {
  upper: [rect(36, 29, 28, 15), rect(30, 44, 40, 10)],
  lower: [rect(30, 54, 40, 16)],
  hips: [rect(28, 70, 44, 20)],
};

const FRONT: [BodyPart, Shape[]][] = [
  ...COMMON,
  ['face', [rect(41, 11, 18, 11)]],
  ['eye', pair(ell(45.5, 10.5, 2.2, 1.3))],
  ['chest', TRUNK.upper],
  ['abdomen', TRUNK.lower],
  ['hip_groin', TRUNK.hips],
];

const BACK: [BodyPart, Shape[]][] = [
  ...COMMON,
  ['upper_back', TRUNK.upper],
  ['lower_back', TRUNK.lower],
  ['hip_groin', TRUNK.hips],
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
  const clipId = `${useId()}-body`.replace(/:/g, '');
  return (
    <figure className="ia-body-figure">
      <svg
        className="ia-body"
        viewBox="0 0 100 192"
        role="group"
        aria-label={`Body map, ${title.toLowerCase()} view`}
      >
        <defs>
          <clipPath id={clipId}>
            <path d={BODY_PATH} />
            <ellipse cx={HEAD.cx} cy={HEAD.cy} rx={HEAD.rx} ry={HEAD.ry} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
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
                    <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} />
                  ) : (
                    <ellipse key={i} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} />
                  ),
                )}
              </g>
            );
          })}
        </g>
        <path d={BODY_PATH} className="ia-body__outline" />
        <ellipse cx={HEAD.cx} cy={HEAD.cy} rx={HEAD.rx} ry={HEAD.ry} className="ia-body__outline" />
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
