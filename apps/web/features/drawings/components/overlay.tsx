import type { Point } from '@archova/markup';
import { MarkupShapeSvg } from '@/shared/markup/ShapeSvg';
import type { DrawingMarkup, DrawingPin } from '../lib/types';

// Overlay layers drawn in the canvas SVG (units: normalised × 1000 on x, × 1000/aspect on y). Overlay colours are
// token variables so they read in both themes; pins use the hi-vis accent (design 02 §2.4).

export { MarkupShapeSvg };

const P = (p: Point, aspect: number) => ({ x: p.x * 1000, y: (p.y * 1000) / aspect });

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
