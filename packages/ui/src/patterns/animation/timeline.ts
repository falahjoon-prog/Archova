// Pure timing rules for induction animations (scene-based motion lessons). No DOM: the player and its tests share this.

export type MotionPreset =
  'none' | 'fade_in' | 'slide_up' | 'slide_left' | 'pop' | 'pulse' | 'draw_on';

export interface Motion {
  preset: MotionPreset;
  startMs: number;
  durationMs: number;
}

/** What to draw for one element at a moment: opacity, offset (percent of the element's own size), scale, and how much of a line is drawn. */
export interface MotionState {
  opacity: number;
  tx: number;
  ty: number;
  scale: number;
  draw: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Ease out: quick start, soft landing. */
const ease = (p: number) => 1 - (1 - p) * (1 - p);

export function motionAt(m: Motion, t: number): MotionState {
  if (m.preset === 'none') return { opacity: 1, tx: 0, ty: 0, scale: 1, draw: 1 };
  const p = ease(clamp01((t - m.startMs) / Math.max(1, m.durationMs)));
  switch (m.preset) {
    case 'fade_in':
      return { opacity: p, tx: 0, ty: 0, scale: 1, draw: 1 };
    case 'slide_up':
      return { opacity: p, tx: 0, ty: (1 - p) * 40, scale: 1, draw: 1 };
    case 'slide_left':
      return { opacity: p, tx: (1 - p) * 60, ty: 0, scale: 1, draw: 1 };
    case 'pop':
      return { opacity: p, tx: 0, ty: 0, scale: 0.6 + 0.4 * p, draw: 1 };
    case 'draw_on':
      return { opacity: p > 0 ? 1 : 0, tx: 0, ty: 0, scale: 1, draw: p };
    case 'pulse': {
      // Appears at its start, then breathes about once a second for as long as the scene runs.
      const on = t >= m.startMs;
      const wave = on ? Math.sin(((t - m.startMs) / 1000) * 2 * Math.PI) : 0;
      return { opacity: on ? 1 : 0, tx: 0, ty: 0, scale: 1 + 0.08 * wave, draw: 1 };
    }
  }
}

/** The scenes' total running time. */
export const totalMs = (scenes: ReadonlyArray<{ durationMs: number }>) =>
  scenes.reduce((n, s) => n + s.durationMs, 0);

/** Where a point in the whole lesson falls: the scene and the time inside it. Past the end it stays on the last scene's last moment. */
export function locate(
  scenes: ReadonlyArray<{ durationMs: number }>,
  at: number,
): { scene: number; t: number } {
  let left = Math.max(0, at);
  for (const [i, s] of scenes.entries()) {
    if (left < s.durationMs) return { scene: i, t: left };
    left -= s.durationMs;
  }
  const last = Math.max(0, scenes.length - 1);
  return { scene: last, t: scenes[last]?.durationMs ?? 0 };
}

/** Time elapsed in the whole lesson at the start of scene `index`. */
export const sceneStart = (scenes: ReadonlyArray<{ durationMs: number }>, index: number) =>
  totalMs(scenes.slice(0, index));
