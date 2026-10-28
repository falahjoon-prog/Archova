// A finger signature pad (IND-AC3). Strokes are kept as points and handed up as SVG path data.
import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '@archova/ui-native';
import { signaturePath, thinStroke, type SignaturePoint } from '../signature';

export function SignaturePad({ onChange }: { onChange: (path: string) => void }) {
  const t = useTheme();
  const [strokes, setStrokes] = useState<SignaturePoint[][]>([]);
  const current = useRef<SignaturePoint[]>([]);
  const all = useRef<SignaturePoint[][]>([]);

  const publish = (live: SignaturePoint[][]) => {
    setStrokes(live);
    onChange(signaturePath(live.map((s) => thinStroke(s))));
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // The pad sits in a scroll view; once signing starts the scroll must not take the touch back.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        current.current = [{ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }];
        publish([...all.current, current.current]);
      },
      onPanResponderMove: (e) => {
        current.current = [
          ...current.current,
          { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY },
        ];
        publish([...all.current, current.current]);
      },
      onPanResponderRelease: () => {
        all.current = [...all.current, current.current];
        current.current = [];
      },
    }),
  ).current;

  return (
    <View
      accessibilityLabel="Signature area. Sign with your finger."
      style={[styles.pad, { borderColor: t.color.borderControl, backgroundColor: t.color.surface }]}
      {...pan.panHandlers}
    >
      <Svg width="100%" height="100%" pointerEvents="none">
        <Path
          d={signaturePath(strokes.map((s) => thinStroke(s)))}
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
  pad: { height: 160, borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
});
