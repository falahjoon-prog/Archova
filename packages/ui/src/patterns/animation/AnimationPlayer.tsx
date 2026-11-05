'use client';

import {
  ArrowRight,
  Captions,
  CaptionsOff,
  Check,
  DoorOpen,
  Flame,
  Footprints,
  Forklift,
  Glasses,
  Hand,
  HardHat,
  Headphones,
  HeartPulse,
  OctagonX,
  Pause,
  Play,
  RotateCcw,
  Shirt,
  SkipBack,
  SkipForward,
  TriangleAlert,
  User,
  Volume2,
  VolumeX,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { formatClock } from '../WatchToEndVideo';
import { motionAt, sceneStart, totalMs, type Motion } from './timeline';

export type Tone = 'neutral' | 'info' | 'warning' | 'danger' | 'safe';

export interface AnimationElement {
  id: string;
  kind: 'text' | 'icon' | 'arrow' | 'box';
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string | null | undefined;
  icon?: string | null | undefined;
  tone: Tone | string;
  rotation?: number | undefined;
  motion: Motion | { preset: string; startMs: number; durationMs: number };
}

export interface AnimationScene {
  id: string;
  title: string;
  narration?: string | null | undefined;
  durationMs: number;
  elements: AnimationElement[];
}

export const ANIMATION_ICONS: Record<string, LucideIcon> = {
  hazard: TriangleAlert,
  helmet: HardHat,
  vest: Shirt,
  boots: Footprints,
  glasses: Glasses,
  gloves: Hand,
  hearing: Headphones,
  fire: Flame,
  exit: DoorOpen,
  first_aid: HeartPulse,
  stop: OctagonX,
  forklift: Forklift,
  person: User,
  tick: Check,
  cross: X,
};

const TONE_VAR: Record<string, string> = {
  neutral: 'var(--c-text)',
  info: 'var(--c-status-info)',
  warning: 'var(--c-status-warning)',
  danger: 'var(--c-status-danger)',
  safe: 'var(--c-status-success)',
};

/** One scene drawn at time `t` (ms). Also used by the editor preview, so it takes no playback state. */
export function SceneFrame({
  scene,
  t,
  selectedId,
  onSelect,
}: {
  scene: AnimationScene;
  t: number;
  selectedId?: string | undefined;
  onSelect?: ((id: string) => void) | undefined;
}) {
  return (
    <div className="ac-anim__frame" role="img" aria-label={scene.title}>
      {scene.elements.map((el) => {
        const m = motionAt(el.motion as Motion, t);
        const colour = TONE_VAR[el.tone] ?? TONE_VAR.neutral;
        const style: CSSProperties = {
          left: `${el.x}%`,
          top: `${el.y}%`,
          width: `${el.w}%`,
          height: `${el.h}%`,
          opacity: m.opacity,
          color: colour,
          transform: `translate(${m.tx}%, ${m.ty}%) scale(${m.scale})`,
        };
        const Icon = el.icon ? ANIMATION_ICONS[el.icon] : undefined;
        return (
          <div
            key={el.id}
            className={`ac-anim__el ac-anim__el--${el.kind}`}
            data-element-id={el.id}
            data-selected={selectedId === el.id ? 'true' : undefined}
            style={style}
            onPointerDown={onSelect ? () => onSelect(el.id) : undefined}
          >
            {el.kind === 'text' ? <span>{el.text}</span> : null}
            {el.kind === 'icon' && Icon ? (
              <Icon size="100%" aria-hidden strokeWidth={1.75} />
            ) : null}
            {el.kind === 'box' ? (
              <div className="ac-anim__box">{el.text ? <span>{el.text}</span> : null}</div>
            ) : null}
            {el.kind === 'arrow' ? (
              <svg
                viewBox="0 0 100 40"
                preserveAspectRatio="none"
                aria-hidden
                style={{ transform: `rotate(${el.rotation ?? 0}deg)` }}
              >
                <path
                  d="M2 20 H88 M70 4 L92 20 L70 36"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pathLength={1}
                  strokeDasharray={1}
                  strokeDashoffset={1 - m.draw}
                />
              </svg>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export interface AnimationPlayerProps {
  title: string;
  scenes: AnimationScene[];
  /** True until played to the end once: the bar can go back but not ahead of what has been seen. */
  enforce: boolean;
  /** Called once when the last scene has played to its end. */
  onComplete: () => void;
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * A scene-based motion lesson. Plays scene by scene with Play/Pause, Back a scene, Restart and captions (the
 * narration). Skipping ahead is not offered until the end has been reached; with reduced motion each scene shows
 * in its finished state and the worker moves on with Next scene.
 */
export function AnimationPlayer({ title, scenes, enforce, onComplete }: AnimationPlayerProps) {
  const reduced = useRef(prefersReducedMotion()).current;
  const [index, setIndex] = useState(0);
  const [t, setT] = useState(reduced ? (scenes[0]?.durationMs ?? 0) : 0);
  const [playing, setPlaying] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [voice, setVoice] = useState(false);
  const [furthest, setFurthest] = useState(0);
  const finished = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const scene = scenes[index]!;
  const last = scenes.length - 1;
  const canVoice = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const complete = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onCompleteRef.current();
  }, []);

  const goTo = useCallback(
    (i: number) => {
      setIndex(i);
      setT(reduced ? (scenes[i]?.durationMs ?? 0) : 0);
      setFurthest((f) => Math.max(f, i));
      if (reduced && i === last) complete();
    },
    [reduced, scenes, last, complete],
  );

  useEffect(() => {
    if (!playing || reduced) return;
    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      const dt = now - prev;
      prev = now;
      setT((cur) => Math.min(scene.durationMs, cur + dt));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, reduced, scene.durationMs]);

  // The scene ended: go to the next one, or finish.
  useEffect(() => {
    if (reduced || t < scene.durationMs) return;
    if (index < last) goTo(index + 1);
    else {
      setPlaying(false);
      complete();
    }
  }, [t, scene.durationMs, index, last, reduced, goTo, complete]);

  // Optional read-aloud with the device's own voice; nothing is sent anywhere.
  useEffect(() => {
    if (!canVoice) return;
    window.speechSynthesis.cancel();
    if (voice && playing && scene.narration) {
      const u = new SpeechSynthesisUtterance(scene.narration);
      u.lang = 'en-AU';
      window.speechSynthesis.speak(u);
    }
    return () => window.speechSynthesis.cancel();
  }, [voice, playing, index, scene.narration, canVoice]);

  const done = finished.current || !enforce;
  const total = totalMs(scenes);
  const elapsed = sceneStart(scenes, index) + t;
  const canNext = index < last && (done || index < furthest);

  return (
    <figure className="ac-anim">
      <div className="ac-anim__stage">
        <SceneFrame scene={scene} t={t} />
        {captions && scene.narration ? (
          <figcaption className="ac-anim__caption" aria-live="polite">
            {scene.narration}
          </figcaption>
        ) : null}
      </div>
      <p className="ac-anim__title">
        {title} · Scene {index + 1} of {scenes.length}: {scene.title}
      </p>
      <div className="ac-video__controls">
        {reduced ? null : (
          <button
            type="button"
            className="ac-video__button ac-focusable"
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? <Pause size={20} aria-hidden /> : <Play size={20} aria-hidden />}
          </button>
        )}
        <button
          type="button"
          className="ac-video__button ac-focusable"
          aria-label="Previous scene"
          disabled={index === 0}
          onClick={() => goTo(index - 1)}
        >
          <SkipBack size={20} aria-hidden />
        </button>
        <button
          type="button"
          className="ac-video__button ac-focusable"
          aria-label="Play this scene again"
          onClick={() => goTo(index)}
        >
          <RotateCcw size={20} aria-hidden />
        </button>
        <button
          type="button"
          className="ac-video__button ac-focusable"
          aria-label={reduced ? 'Next scene' : 'Skip to next scene'}
          disabled={reduced ? index === last : !canNext}
          onClick={() => goTo(index + 1)}
        >
          {reduced ? <ArrowRight size={20} aria-hidden /> : <SkipForward size={20} aria-hidden />}
        </button>
        <span className="ac-video__time">
          {formatClock(elapsed / 1000)} / {formatClock(total / 1000)}
        </span>
        <button
          type="button"
          className="ac-video__button ac-focusable"
          aria-label="Captions"
          aria-pressed={captions}
          onClick={() => setCaptions((c) => !c)}
        >
          {captions ? <Captions size={20} aria-hidden /> : <CaptionsOff size={20} aria-hidden />}
        </button>
        {canVoice ? (
          <button
            type="button"
            className="ac-video__button ac-focusable"
            aria-label="Read aloud"
            aria-pressed={voice}
            onClick={() => setVoice((v) => !v)}
          >
            {voice ? <Volume2 size={20} aria-hidden /> : <VolumeX size={20} aria-hidden />}
          </button>
        ) : null}
      </div>
    </figure>
  );
}
