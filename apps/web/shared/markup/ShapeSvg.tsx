import { DEFAULT_STROKE_WIDTH, type MarkupShape, type Point } from '@archova/markup';

// Shapes drawn in an overlay SVG whose units are normalised × 1000 on x and × 1000/aspect on y (`toOverlay` in
// @archova/ui). Shared by the drawing viewer and the RFI photo annotator so a mark looks the same wherever it is
// drawn. A shape without a colour draws in the danger token, so it reads in both themes.

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
  weight = 1,
}: {
  shape: MarkupShape;
  aspect: number;
  preview?: boolean;
  /** Multiplies line width and text size; photos are drawn heavier than sheets because they are viewed smaller. */
  weight?: number;
}) {
  const stroke = shape.color ?? 'var(--c-status-danger)';
  const width = (shape.strokeWidth ?? DEFAULT_STROKE_WIDTH) * weight;
  const common = {
    stroke,
    strokeWidth: width,
    fill: 'none',
    opacity: preview ? 0.6 : 1,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  } as const;
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
      const head = 8 + width * 2;
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
          points={shape.points
            .map((p) => {
              const o = P(p, aspect);
              return `${o.x},${o.y}`;
            })
            .join(' ')}
          {...common}
        />
      );
    case 'text': {
      const at = P(shape.at, aspect);
      // Without a stored width the text keeps the size it always had on sheets.
      const size = (shape.strokeWidth ? 6 + shape.strokeWidth * 4 : 9) * weight;
      return (
        <text
          x={at.x}
          y={at.y}
          fontSize={size}
          fontWeight={shape.strokeWidth ? 600 : undefined}
          fill={stroke}
          opacity={preview ? 0.6 : 1}
          fontFamily="var(--font-family)"
          // A pale halo keeps a note readable on a dark photo and on a busy sheet.
          stroke="rgb(255 255 255 / 0.85)"
          strokeWidth={size / 6}
          paintOrder="stroke"
          strokeLinejoin="round"
        >
          {shape.text}
        </text>
      );
    }
    case 'pin':
      return null;
  }
}
