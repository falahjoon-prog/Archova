// A finger signature pad that hands up its strokes as 0..1 points, so the saved image is the same on any screen.
import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '@archova/ui-native';
import type { UnitPoint } from '../png';

export function StrokePad({ onChange }: { onChange: (strokes: UnitPoint[][]) => void }) {
  const t = useTheme();
  const size = useRef({ w: 1, h: 1 });
  const [strokes, setStrokes] = useState<UnitPoint[][]>([]);
  const all = useRef<UnitPoint[][]>([]);
  const current = useRef<UnitPoint[]>([]);

  const publish = (live: UnitPoint[][]) => {
    setStrokes(live);
    onChange(live);
  };
  const at = (x: number, y: number): UnitPoint => ({
    x: Math.min(1, Math.max(0, x / size.current.w)),
    y: Math.min(1, Math.max(0, y / size.current.h)),
  });

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // The pad sits in a scroll view; once signing starts the scroll must not take the touch back.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        current.current = [at(e.nativeEvent.locationX, e.nativeEvent.locationY)];
        publish([...all.current, current.current]);
      },
      onPanResponderMove: (e) => {
        current.current = [
          ...current.current,
          at(e.nativeEvent.locationX, e.nativeEvent.locationY),
        ];
        publish([...all.current, current.current]);
      },
      onPanResponderRelease: () => {
        all.current = [...all.current, current.current];
        current.current = [];
      },
    }),
  ).current;

  const d = strokes
    .filter((s) => s.length > 0)
    .map((s) =>
      s
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x * size.current.w} ${p.y * size.current.h}`)
        .join(' '),
    )
    .join(' ');

  return (
    <View
      accessibilityLabel="Signature area. Sign with your finger."
      onLayout={(e: LayoutChangeEvent) => {
        size.current = {
          w: Math.max(1, e.nativeEvent.layout.width),
          h: Math.max(1, e.nativeEvent.layout.height),
        };
      }}
      style={[styles.pad, { borderColor: t.color.borderControl, backgroundColor: t.color.surface }]}
      {...pan.panHandlers}
    >
      <Svg width="100%" height="100%" pointerEvents="none">
        <Path
          d={d}
          stroke={t.color.text}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { height: 180, borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
});
