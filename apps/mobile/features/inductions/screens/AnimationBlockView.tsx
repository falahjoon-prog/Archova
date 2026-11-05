// An animation block of an induction section: a scene-based motion lesson. A scene plays once, then the worker
// moves on; it reports itself viewed only after the last scene has played to its end.
import { useEffect, useRef, useState } from 'react';
import { Animated, Text, View } from 'react-native';
import { Button, useTheme } from '@archova/ui-native';
import type { AnimationScene } from '../animation';
import { motionPlan } from '../animation';

const GLYPH: Record<string, string> = {
  hazard: '⚠️',
  helmet: '⛑️',
  vest: '🦺',
  boots: '🥾',
  glasses: '🥽',
  gloves: '🧤',
  hearing: '🎧',
  fire: '🔥',
  exit: '🚪',
  first_aid: '🩹',
  stop: '🛑',
  forklift: '🚜',
  person: '🧍',
  tick: '✔️',
  cross: '✖️',
};

function SceneStage({ scene, replay }: { scene: AnimationScene; replay: number }) {
  const t = useTheme();
  const tone = (name: string) =>
    name === 'danger'
      ? t.color.statusDanger
      : name === 'warning'
        ? t.color.statusWarning
        : name === 'safe'
          ? t.color.statusSuccess
          : name === 'info'
            ? t.color.statusInfo
            : t.color.text;
  const [size, setSize] = useState(0);
  return (
    <View
      accessibilityLabel={scene.title}
      onLayout={(e) => setSize(e.nativeEvent.layout.width)}
      style={{
        aspectRatio: 16 / 9,
        width: '100%',
        overflow: 'hidden',
        backgroundColor: t.color.surface,
        borderWidth: 1,
        borderColor: t.color.borderControl,
        borderRadius: 8,
      }}
    >
      {scene.elements.map((el) => (
        <StageElement key={`${el.id}:${replay}`} el={el} colour={tone(el.tone)} stage={size} />
      ))}
    </View>
  );
}

function StageElement({
  el,
  colour,
  stage,
}: {
  el: AnimationScene['elements'][number];
  colour: string;
  stage: number;
}) {
  const plan = motionPlan(el.motion);
  const v = useRef(new Animated.Value(plan.from)).current;
  useEffect(() => {
    if (plan.animated)
      Animated.timing(v, {
        toValue: 1,
        delay: el.motion.startMs,
        duration: el.motion.durationMs,
        useNativeDriver: true,
      }).start();
  }, [v, plan.animated, el.motion.startMs, el.motion.durationMs]);
  const fontSize = Math.max(12, stage * (el.kind === 'text' ? 0.04 : 0.032));
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: `${el.x}%`,
        top: `${el.y}%`,
        width: `${el.w}%`,
        height: `${el.h}%`,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: v,
        transform: [
          { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [plan.fromY, 0] }) },
          { scale: v.interpolate({ inputRange: [0, 1], outputRange: [plan.fromScale, 1] }) },
        ],
        ...(el.kind === 'box' ? { borderWidth: 3, borderColor: colour, borderRadius: 8 } : {}),
      }}
    >
      {el.kind === 'icon' ? (
        <Text style={{ fontSize: Math.max(20, stage * 0.08) }}>{GLYPH[el.icon ?? ''] ?? '•'}</Text>
      ) : el.kind === 'arrow' ? (
        <Text
          style={{
            color: colour,
            fontSize: Math.max(24, stage * 0.08),
            transform: [{ rotate: `${el.rotation ?? 0}deg` }],
          }}
        >
          ➜
        </Text>
      ) : el.text ? (
        <Text style={{ color: colour, fontSize, fontWeight: '600', textAlign: 'center' }}>
          {el.text}
        </Text>
      ) : null}
    </Animated.View>
  );
}

export function AnimationBlockView({
  title,
  scenes,
  viewed,
  onViewed,
}: {
  title: string | null | undefined;
  scenes: AnimationScene[];
  viewed: boolean;
  onViewed: () => void;
}) {
  const t = useTheme();
  const [index, setIndex] = useState(0);
  const [replay, setReplay] = useState(0);
  const [played, setPlayed] = useState(false);
  const scene = scenes[index]!;
  const last = index === scenes.length - 1;

  useEffect(() => {
    setPlayed(false);
    const timer = setTimeout(() => {
      setPlayed(true);
      if (last) onViewed();
    }, scene.durationMs);
    return () => clearTimeout(timer);
  }, [index, replay, scene.durationMs, last, onViewed]);

  return (
    <View style={{ gap: t.space[2] }}>
      <SceneStage scene={scene} replay={replay} />
      {scene.narration ? <Text style={{ color: t.color.text }}>{scene.narration}</Text> : null}
      <Text style={{ color: t.color.textSecondary }}>
        {`${title ?? 'Animation'} · Scene ${index + 1} of ${scenes.length}: ${scene.title}`}
      </Text>
      <View style={{ flexDirection: 'row', gap: t.space[2] }}>
        <Button label="Play again" variant="secondary" onPress={() => setReplay((r) => r + 1)} />
        {!last ? (
          <Button
            label="Next scene"
            disabled={!played && !viewed}
            onPress={() => {
              setIndex(index + 1);
              setReplay((r) => r + 1);
            }}
          />
        ) : (
          <Text style={{ color: t.color.textSecondary, alignSelf: 'center' }}>
            {viewed || played ? 'Watched to the end' : 'Watch to the end to continue'}
          </Text>
        )}
      </View>
    </View>
  );
}
