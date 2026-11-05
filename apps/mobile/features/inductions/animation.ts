// Types and motion maths for induction animations on the phone. Mirrors the API schema (InductionAnimationBlock).
export interface AnimationScene {
  id: string;
  title: string;
  narration?: string | null | undefined;
  durationMs: number;
  elements: Array<{
    id: string;
    kind: 'text' | 'icon' | 'arrow' | 'box';
    x: number;
    y: number;
    w: number;
    h: number;
    text?: string | null | undefined;
    icon?: string | null | undefined;
    tone: string;
    rotation?: number | undefined;
    motion: { preset: string; startMs: number; durationMs: number };
  }>;
}

/** Where an element starts before its motion runs (opacity, offset in pixels, scale); the motion takes it to resting. */
export function motionPlan(m: { preset: string }): {
  animated: boolean;
  from: number;
  fromY: number;
  fromScale: number;
} {
  switch (m.preset) {
    case 'none':
      return { animated: false, from: 1, fromY: 0, fromScale: 1 };
    case 'slide_up':
    case 'slide_left':
      return { animated: true, from: 0, fromY: 24, fromScale: 1 };
    case 'pop':
      return { animated: true, from: 0, fromY: 0, fromScale: 0.6 };
    default:
      // fade_in, draw_on and pulse all appear by fading in on the phone.
      return { animated: true, from: 0, fromY: 0, fromScale: 1 };
  }
}

/** Seen-record key for an animation block, which has no file id. */
export const animationKey = (b: { scenes: Array<{ id: string }> }) =>
  `animation:${b.scenes.map((s) => s.id).join(',')}`;
