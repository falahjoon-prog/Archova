// Draws a sheet's markups over the drawing. The shapes are recomputed from the viewport on every move.
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Ellipse, Line, Path, Text as SvgText } from 'react-native-svg';
import { useTheme } from '@archova/ui-native';
import { markupPrimitives, type DrawnMarkup } from '../markup';
import type { Pyramid, Viewport } from '../viewport';

export function MarkupLayer({
  pyramid,
  view,
  markups,
}: {
  pyramid: Pyramid;
  view: Viewport;
  markups: readonly DrawnMarkup[];
}) {
  const t = useTheme();
  const items = useMemo(
    () => markupPrimitives(pyramid, view, markups, t.color.statusDanger),
    [pyramid, view, markups, t.color.statusDanger],
  );
  if (items.length === 0) return null;
  return (
    <Svg
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      width={view.screenWidth}
      height={view.screenHeight}
    >
      {items.map((it) => {
        switch (it.kind) {
          case 'path':
            return (
              <Path key={it.id} d={it.d} stroke={it.color} strokeWidth={it.width} fill="none" />
            );
          case 'line':
            return (
              <Line
                key={it.id}
                x1={it.from.x}
                y1={it.from.y}
                x2={it.to.x}
                y2={it.to.y}
                stroke={it.color}
                strokeWidth={it.width}
              />
            );
          case 'ellipse':
            return (
              <Ellipse
                key={it.id}
                cx={it.cx}
                cy={it.cy}
                rx={it.rx}
                ry={it.ry}
                stroke={it.color}
                strokeWidth={it.width}
                fill="none"
              />
            );
          case 'text':
            return (
              <SvgText key={it.id} x={it.at.x} y={it.at.y} fill={it.color} fontSize={it.size}>
                {it.text}
              </SvgText>
            );
        }
      })}
    </Svg>
  );
}
