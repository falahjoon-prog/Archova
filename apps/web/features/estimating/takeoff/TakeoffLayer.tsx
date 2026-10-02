import type { Point, TakeoffGeometry } from '@archova/markup';

// Measurement layer, drawn in the viewer's overlay (normalised × 1000, × 1000/aspect). Manual measurements are solid;
// measurements from an older revision shown for comparison are dashed in the warning colour (frontend 07 §3).

const P = (p: Point, aspect: number) => `${p.x * 1000},${(p.y * 1000) / aspect}`;

export type LayerTone = 'saved' | 'draft' | 'active' | 'old';

const STROKE: Record<LayerTone, string> = {
  saved: 'var(--c-action-primary)',
  draft: 'var(--c-status-info)',
  active: 'var(--c-action-primary)',
  old: 'var(--c-status-warning)',
};

export function GeometrySvg({
  geometry,
  aspect,
  tone,
  label,
}: {
  geometry: TakeoffGeometry;
  aspect: number;
  tone: LayerTone;
  label?: string;
}) {
  const stroke = STROKE[tone];
  const dash = tone === 'old' ? '6 4' : tone === 'draft' ? '3 2' : undefined;
  const at = (p: Point) => ({ x: p.x * 1000, y: (p.y * 1000) / aspect });
  switch (geometry.kind) {
    case 'length': {
      const end = geometry.points[geometry.points.length - 1];
      return (
        <g>
          <polyline
            points={geometry.points.map((p) => P(p, aspect)).join(' ')}
            fill="none"
            stroke={stroke}
            strokeWidth={2}
            strokeDasharray={dash}
          />
          {label && end ? <Tag x={at(end).x} y={at(end).y} text={label} colour={stroke} /> : null}
        </g>
      );
    }
    case 'area': {
      const d = [geometry.outer, ...geometry.holes]
        .filter((ring) => ring.length > 0)
        .map((ring) => `M ${ring.map((p) => P(p, aspect)).join(' L ')} Z`)
        .join(' ');
      const c = centroid(geometry.outer);
      return (
        <g>
          <path
            d={d}
            fillRule="evenodd"
            fill={stroke}
            fillOpacity={0.12}
            stroke={stroke}
            strokeWidth={1.5}
            strokeDasharray={dash}
          />
          {label && c ? <Tag x={at(c).x} y={at(c).y} text={label} colour={stroke} /> : null}
        </g>
      );
    }
    case 'count':
      return (
        <g>
          {geometry.points.map((p, i) => {
            const q = at(p);
            return (
              <g key={i} transform={`translate(${q.x} ${q.y})`}>
                <circle
                  r={6}
                  fill={stroke}
                  stroke="var(--c-surface)"
                  strokeWidth={1}
                  strokeDasharray={dash}
                />
                <text
                  y={3}
                  fontSize={7}
                  textAnchor="middle"
                  fill="var(--c-surface)"
                  fontWeight={700}
                  fontFamily="var(--font-family)"
                >
                  {i + 1}
                </text>
              </g>
            );
          })}
        </g>
      );
  }
}

function centroid(points: readonly Point[]): Point | null {
  if (!points.length) return null;
  return {
    x: points.reduce((s, p) => s + p.x, 0) / points.length,
    y: points.reduce((s, p) => s + p.y, 0) / points.length,
  };
}

export function Tag({
  x,
  y,
  text,
  colour,
}: {
  x: number;
  y: number;
  text: string;
  colour: string;
}) {
  const w = Math.max(24, text.length * 4.6 + 8);
  return (
    <g transform={`translate(${x + 6} ${y - 18})`}>
      <rect
        width={w}
        height={13}
        rx={2}
        fill="var(--c-surface)"
        stroke={colour}
        strokeWidth={0.8}
      />
      <text x={4} y={9.5} fontSize={8} fill="var(--c-text)" fontFamily="var(--font-family)">
        {text}
      </text>
    </g>
  );
}

/** Rubber band from the last point to the cursor, the cursor marker, and the snap indicator. */
export function CursorLayer({
  points,
  hover,
  snapped,
  closing,
  aspect,
  live,
}: {
  points: readonly Point[];
  hover: Point | null;
  snapped: boolean;
  closing: boolean;
  aspect: number;
  live: string | null;
}) {
  if (!hover) return null;
  const h = { x: hover.x * 1000, y: (hover.y * 1000) / aspect };
  const last = points[points.length - 1];
  const first = points[0];
  return (
    <g pointerEvents="none">
      {last ? (
        <line
          x1={last.x * 1000}
          y1={(last.y * 1000) / aspect}
          x2={h.x}
          y2={h.y}
          stroke="var(--c-action-primary)"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      ) : null}
      {closing && first && points.length >= 2 ? (
        <line
          x1={h.x}
          y1={h.y}
          x2={first.x * 1000}
          y2={(first.y * 1000) / aspect}
          stroke="var(--c-action-primary)"
          strokeWidth={0.8}
          strokeDasharray="2 3"
        />
      ) : null}
      {snapped ? (
        <rect
          x={h.x - 5}
          y={h.y - 5}
          width={10}
          height={10}
          fill="none"
          stroke="var(--c-accent-hivis)"
          strokeWidth={1.5}
        />
      ) : (
        <circle cx={h.x} cy={h.y} r={2.5} fill="var(--c-action-primary)" />
      )}
      {live ? <Tag x={h.x + 4} y={h.y + 4} text={live} colour="var(--c-action-primary)" /> : null}
    </g>
  );
}
