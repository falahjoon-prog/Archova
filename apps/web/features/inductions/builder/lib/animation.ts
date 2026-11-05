// Authoring helpers for animation blocks: starter templates and the edits the editor makes. Pure, so they are tested
// without a browser. The scene shapes are the API's own (InductionAnimationBlock).

import type { components } from '@archova/contracts/openapi';

type S = components['schemas'];
export type AnimationBlock = S['InductionAnimationBlock'];
export type AnimationScene = S['InductionAnimationScene'];
export type AnimationElement = S['InductionAnimationElement'];
export type SceneTemplate = AnimationScene['template'];
export type ElementKind = AnimationElement['kind'];
export type MotionPreset = AnimationElement['motion']['preset'];

export const TEMPLATE_LABELS: Record<SceneTemplate, string> = {
  blank: 'Blank scene',
  hazard_callout: 'Hazard call-out',
  steps: 'Step by step',
  site_walkthrough: 'Site walk-through',
  ppe_checklist: 'PPE checklist',
  emergency_route: 'Emergency route',
};

export const MOTION_LABELS: Record<MotionPreset, string> = {
  none: 'Always shown',
  fade_in: 'Fade in',
  slide_up: 'Slide up',
  slide_left: 'Slide in from the right',
  pop: 'Pop',
  pulse: 'Pulse',
  draw_on: 'Draw on (arrows)',
};

export const ICON_LABELS: Record<NonNullable<AnimationElement['icon']>, string> = {
  hazard: 'Hazard',
  helmet: 'Hard hat',
  vest: 'Hi-vis vest',
  boots: 'Safety boots',
  glasses: 'Safety glasses',
  gloves: 'Gloves',
  hearing: 'Hearing protection',
  fire: 'Fire',
  exit: 'Exit',
  first_aid: 'First aid',
  stop: 'Stop',
  forklift: 'Plant and vehicles',
  person: 'Person',
  tick: 'Tick',
  cross: 'Cross',
};

export const TONE_LABELS: Record<AnimationElement['tone'], string> = {
  neutral: 'Plain',
  info: 'Information',
  warning: 'Warning',
  danger: 'Danger',
  safe: 'Safe',
};

export const MAX_SCENES = 20;
export const MAX_ELEMENTS = 30;
export const MIN_SCENE_MS = 2000;
export const MAX_SCENE_MS = 60000;
export const DEFAULT_SCENE_MS = 8000;

/** Ids only need to be unique inside the block; 12 random characters is plenty. */
export function newId(prefix: string): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

const motion = (preset: MotionPreset, startMs: number, durationMs = 600) => ({
  preset,
  startMs,
  durationMs,
});

type Draft = Omit<AnimationElement, 'id'>;
const el = (d: Partial<Draft> & Pick<Draft, 'kind' | 'x' | 'y' | 'w' | 'h'>): Draft => ({
  tone: 'neutral',
  motion: motion('fade_in', 0),
  ...d,
});

const TEMPLATES: Record<SceneTemplate, { title: string; narration: string; elements: Draft[] }> = {
  blank: { title: 'New scene', narration: '', elements: [] },
  hazard_callout: {
    title: 'Hazard',
    narration: 'Describe the hazard and what workers must do about it.',
    elements: [
      el({
        kind: 'icon',
        icon: 'hazard',
        tone: 'warning',
        x: 8,
        y: 22,
        w: 22,
        h: 40,
        motion: motion('pop', 0),
      }),
      el({
        kind: 'text',
        text: 'Overhead loads',
        tone: 'warning',
        x: 36,
        y: 20,
        w: 56,
        h: 14,
        motion: motion('slide_left', 600),
      }),
      el({
        kind: 'text',
        text: 'Never walk under a suspended load.',
        x: 36,
        y: 40,
        w: 56,
        h: 18,
        motion: motion('fade_in', 1600),
      }),
      el({
        kind: 'box',
        text: 'Keep clear of the lift zone',
        tone: 'danger',
        x: 14,
        y: 72,
        w: 72,
        h: 18,
        motion: motion('pulse', 3000),
      }),
    ],
  },
  steps: {
    title: 'Steps',
    narration: 'Walk through the steps in order.',
    elements: [
      el({
        kind: 'text',
        text: '1. Check the area is clear',
        x: 10,
        y: 14,
        w: 80,
        h: 14,
        motion: motion('slide_up', 0),
      }),
      el({
        kind: 'text',
        text: '2. Isolate the energy source',
        x: 10,
        y: 40,
        w: 80,
        h: 14,
        motion: motion('slide_up', 1500),
      }),
      el({
        kind: 'text',
        text: '3. Tag and lock out',
        x: 10,
        y: 66,
        w: 80,
        h: 14,
        motion: motion('slide_up', 3000),
      }),
    ],
  },
  site_walkthrough: {
    title: 'Getting around site',
    narration: 'Show the route from the gate to the amenities and the muster point.',
    elements: [
      el({
        kind: 'box',
        text: 'Gate',
        tone: 'info',
        x: 4,
        y: 38,
        w: 20,
        h: 24,
        motion: motion('pop', 0),
      }),
      el({ kind: 'arrow', x: 26, y: 44, w: 14, h: 12, motion: motion('draw_on', 800) }),
      el({
        kind: 'box',
        text: 'Amenities',
        tone: 'info',
        x: 40,
        y: 38,
        w: 20,
        h: 24,
        motion: motion('pop', 1600),
      }),
      el({ kind: 'arrow', x: 62, y: 44, w: 14, h: 12, motion: motion('draw_on', 2400) }),
      el({
        kind: 'box',
        text: 'Muster point',
        tone: 'safe',
        x: 76,
        y: 38,
        w: 20,
        h: 24,
        motion: motion('pop', 3200),
      }),
    ],
  },
  ppe_checklist: {
    title: 'PPE',
    narration: 'Everyone on site wears this at all times.',
    elements: [
      el({ kind: 'icon', icon: 'helmet', x: 6, y: 18, w: 14, h: 26, motion: motion('pop', 0) }),
      el({
        kind: 'text',
        text: 'Hard hat',
        x: 4,
        y: 48,
        w: 18,
        h: 10,
        motion: motion('fade_in', 300),
      }),
      el({ kind: 'icon', icon: 'vest', x: 29, y: 18, w: 14, h: 26, motion: motion('pop', 1000) }),
      el({
        kind: 'text',
        text: 'Hi-vis',
        x: 27,
        y: 48,
        w: 18,
        h: 10,
        motion: motion('fade_in', 1300),
      }),
      el({ kind: 'icon', icon: 'boots', x: 52, y: 18, w: 14, h: 26, motion: motion('pop', 2000) }),
      el({
        kind: 'text',
        text: 'Boots',
        x: 50,
        y: 48,
        w: 18,
        h: 10,
        motion: motion('fade_in', 2300),
      }),
      el({
        kind: 'icon',
        icon: 'glasses',
        x: 75,
        y: 18,
        w: 14,
        h: 26,
        motion: motion('pop', 3000),
      }),
      el({
        kind: 'text',
        text: 'Glasses',
        x: 73,
        y: 48,
        w: 18,
        h: 10,
        motion: motion('fade_in', 3300),
      }),
    ],
  },
  emergency_route: {
    title: 'In an emergency',
    narration: 'Stop work, leave by the nearest safe route and go to the muster point.',
    elements: [
      el({ kind: 'icon', icon: 'person', x: 6, y: 34, w: 14, h: 30, motion: motion('pop', 0) }),
      el({
        kind: 'arrow',
        tone: 'safe',
        x: 24,
        y: 42,
        w: 36,
        h: 14,
        motion: motion('draw_on', 800, 1500),
      }),
      el({
        kind: 'icon',
        icon: 'exit',
        tone: 'safe',
        x: 64,
        y: 30,
        w: 14,
        h: 30,
        motion: motion('pop', 2400),
      }),
      el({
        kind: 'text',
        text: 'Muster point',
        tone: 'safe',
        x: 62,
        y: 66,
        w: 30,
        h: 12,
        motion: motion('fade_in', 2900),
      }),
    ],
  },
};

export function newScene(template: SceneTemplate = 'blank'): AnimationScene {
  const t = TEMPLATES[template];
  return {
    id: newId('sc'),
    template,
    title: t.title,
    narration: t.narration || null,
    durationMs: DEFAULT_SCENE_MS,
    elements: t.elements.map((e) => ({ ...e, motion: { ...e.motion }, id: newId('el') })),
  };
}

export function newAnimationBlock(template: SceneTemplate = 'hazard_callout'): AnimationBlock {
  return { type: 'animation', title: null, scenes: [newScene(template)] };
}

/** A fresh element of a kind, centred, to be dragged and edited. */
export function newElement(kind: ElementKind): AnimationElement {
  const base = { id: newId('el'), tone: 'neutral' as const, motion: motion('fade_in', 0) };
  switch (kind) {
    case 'text':
      return { ...base, kind, text: 'New text', x: 25, y: 40, w: 50, h: 14 };
    case 'icon':
      return { ...base, kind, icon: 'hazard', tone: 'warning', x: 43, y: 32, w: 14, h: 30 };
    case 'arrow':
      return { ...base, kind, x: 35, y: 42, w: 30, h: 14, motion: motion('draw_on', 0, 1000) };
    case 'box':
      return { ...base, kind, text: 'Label', tone: 'info', x: 30, y: 35, w: 40, h: 28 };
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Keeps an element inside the stage after a drag or a typed number. */
export function placeElement(
  e: AnimationElement,
  patch: Partial<Pick<AnimationElement, 'x' | 'y' | 'w' | 'h'>>,
): AnimationElement {
  const w = clamp(patch.w ?? e.w, 1, 100);
  const h = clamp(patch.h ?? e.h, 1, 100);
  return {
    ...e,
    w,
    h,
    x: clamp(patch.x ?? e.x, 0, 100 - w),
    y: clamp(patch.y ?? e.y, 0, 100 - h),
  };
}

export function moveItem<T>(list: readonly T[], from: number, delta: -1 | 1): T[] {
  const to = from + delta;
  if (to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** A copy of a scene with new ids and a "copy" title, to start the next scene from. */
export function duplicateScene(s: AnimationScene): AnimationScene {
  return {
    ...s,
    id: newId('sc'),
    title: `${s.title} (copy)`.slice(0, 200),
    elements: s.elements.map((e) => ({ ...e, motion: { ...e.motion }, id: newId('el') })),
  };
}

/** When the last motion in a scene ends, so the editor can warn about a scene that cuts one short. */
export const lastMotionEnd = (s: AnimationScene) =>
  s.elements.reduce(
    (n, e) => Math.max(n, e.motion.preset === 'none' ? 0 : e.motion.startMs + e.motion.durationMs),
    0,
  );

/** Things that would make the server refuse the block, or leave a worker looking at a blank frame. */
export function animationProblems(b: AnimationBlock, where: string): string[] {
  const out: string[] = [];
  if (b.scenes.length === 0) out.push(`${where} needs at least one scene.`);
  b.scenes.forEach((s, i) => {
    const at = `${where}, scene ${i + 1}`;
    if (!s.title.trim()) out.push(`${at} needs a title.`);
    s.elements.forEach((e) => {
      if (e.kind === 'text' && !(e.text ?? '').trim()) out.push(`${at} has an empty text element.`);
    });
    if (lastMotionEnd(s) > s.durationMs)
      out.push(
        `${at} is shorter than its animations. Lengthen the scene or move the animations earlier.`,
      );
  });
  return out;
}
