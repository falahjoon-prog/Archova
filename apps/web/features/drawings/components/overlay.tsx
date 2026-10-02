import type { MarkupShape, Point } from '@archova/markup';
import type { DrawingMarkup, DrawingPin } from '../lib/types';

// Overlay layers drawn in the canvas SVG (units: normalised × 1000 on x, × 1000/aspect on y). Overlay colours are
// token variables so they read in both themes; pins use the hi-vis accent (design 02 §2.4).

const P = (p: Point, aspect: number) => ({ x: p.x * 1000, y: (p.y * 1000) / aspect });

function cloudPath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const x1 = Math.min(a.x, b.x);
  const x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const y2 = Math.max(a.y, b.y);
  const r = 6;
  const parts: string[] = [`M ${x1} ${y1}`];
  const edge = (fx: number, fy: number, tx: number, ty: number) => {
    const len = Math.hypot(tx - fx, ty - fy);
    const n = Math.max(1, Math.round(len / (2 * r)));
    for (let i = 1; i <= n; i++) {
      const px = fx + ((tx - fx) * i) / n;
      const py = fy + ((ty - fy) * i) / n;
      parts.push(`A ${r} ${r} 0 0 1 ${px} ${py}`);
    }
  };
  edge(x1, y1, x2, y1);
  edge(x2, y1, x2, y2);
  edge(x2, y2, x1, y2);
  edge(x1, y2, x1, y1);
  return parts.join(' ');
}

export function MarkupShapeSvg({
  shape,
  aspect,
  preview,
}: {
  shape: MarkupShape;
  aspect: number;
  preview?: boolean;
}) {
  const stroke = 'var(--c-status-danger)';
  const common = { stroke, strokeWidth: 1.5, fill: 'none', opacity: preview ? 0.6 : 1 } as const;
  switch (shape.kind) {
    case 'rect':
    case 'ellipse': {
      const a = P(shape.from, aspect);
      const b = P(shape.to, aspect);
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(a.x - b.x);
      const h = Math.abs(a.y - b.y);
      return shape.kind === 'rect' ? (
        <rect x={x} y={y} width={w} height={h} {...common} />
      ) : (
        <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...common} />
      );
    }
    case 'cloud':
      return <path d={cloudPath(P(shape.from, aspect), P(shape.to, aspect))} {...common} />;
    case 'line':
    case 'arrow': {
      const a = P(shape.from, aspect);
      const b = P(shape.to, aspect);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const head = 8;
      const h1 = { x: b.x - head * Math.cos(angle - 0.4), y: b.y - head * Math.sin(angle - 0.4) };
      const h2 = { x: b.x - head * Math.cos(angle + 0.4), y: b.y - head * Math.sin(angle + 0.4) };
      return (
        <g {...common}>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
          {shape.kind === 'arrow' ? (
            <polyline points={`${h1.x},${h1.y} ${b.x},${b.y} ${h2.x},${h2.y}`} />
          ) : null}
        </g>
      );
    }
    case 'pen':
      return (
        <polyline
          points={shape.points.map((p) => `${P(p, aspect).x},${P(p, aspect).y}`).join(' ')}
          {...common}
        />
      );
    case 'text': {
      const at = P(shape.at, aspect);
      return (
        <text
          x={at.x}
          y={at.y}
          fontSize={9}
          fill={stroke}
          opacity={preview ? 0.6 : 1}
          fontFamily="var(--font-family)"
        >
          {shape.text}
        </text>
      );
    }
    case 'pin':
      return null;
  }
}

export function MarkupLayer({
  markups,
  aspect,
}: {
  markups: readonly DrawingMarkup[];
  aspect: number;
}) {
  return (
    <g data-layer="markups">
      {markups.map((m) => (
        <MarkupShapeSvg key={m.id} shape={m.shape} aspect={aspect} />
      ))}
    </g>
  );
}

export function PinLayer({
  pins,
  aspect,
  highlightId,
}: {
  pins: readonly DrawingPin[];
  aspect: number;
  highlightId?: string | null;
}) {
  return (
    <g data-layer="pins">
      {pins.map((pin) => {
        const at = P(pin, aspect);
        const fill = pin.entityType === 'rfi' ? 'var(--c-status-info)' : 'var(--c-accent-hivis)';
        return (
          <g key={pin.id} transform={`translate(${at.x} ${at.y})`}>
            <circle
              r={pin.id === highlightId ? 9 : 7}
              fill={fill}
              stroke="var(--c-text)"
              strokeWidth={1}
              strokeDasharray={pin.checkLocation ? '2 2' : undefined}
            />
            <text
              y={-11}
              fontSize={8}
              textAnchor="middle"
              fill="var(--c-text)"
              fontWeight={600}
              fontFamily="var(--font-family)"
            >
              {pin.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}
