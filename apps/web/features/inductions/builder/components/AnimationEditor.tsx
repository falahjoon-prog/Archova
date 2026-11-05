'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Button, SceneFrame, Select, TextField, Textarea } from '@archova/ui';
import {
  DEFAULT_SCENE_MS,
  ICON_LABELS,
  MAX_ELEMENTS,
  MAX_SCENES,
  MAX_SCENE_MS,
  MIN_SCENE_MS,
  MOTION_LABELS,
  TEMPLATE_LABELS,
  TONE_LABELS,
  duplicateScene,
  lastMotionEnd,
  moveItem,
  newElement,
  newId,
  newScene,
  placeElement,
  type AnimationBlock,
  type AnimationElement,
  type AnimationScene,
  type ElementKind,
  type SceneTemplate,
} from '../lib/animation';

interface Props {
  block: AnimationBlock;
  onChange: (next: AnimationBlock) => void;
}

const KIND_LABELS: Record<ElementKind, string> = {
  text: 'Text',
  icon: 'Icon',
  arrow: 'Arrow',
  box: 'Labelled box',
};

const options = <K extends string>(labels: Record<K, string>) =>
  (Object.keys(labels) as K[]).map((value) => ({ value, label: labels[value] }));

const clampInt = (raw: string, lo: number, hi: number, fallback: number) => {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/**
 * The scene editor for an animation block: a list of scenes, a preview stage where elements are picked and dragged, a
 * timeline of when each element moves, and the settings of the picked element. Everything it makes is plain scene data;
 * nothing is rendered to a video.
 */
export function AnimationEditor({ block, onChange }: Props) {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newTemplate, setNewTemplate] = useState<SceneTemplate>('hazard_callout');
  const index = Math.min(sceneIndex, block.scenes.length - 1);
  const scene = block.scenes[index]!;
  const selected = scene.elements.find((e) => e.id === selectedId) ?? null;

  // The stage shows the scene finished while editing, or runs from the start when previewing.
  const [t, setT] = useState(scene.durationMs);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    setPlaying(false);
    setT(scene.durationMs);
  }, [scene.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      const dt = now - prev;
      prev = now;
      let done = false;
      setT((cur) => {
        const next = Math.min(scene.durationMs, cur + dt);
        done = next >= scene.durationMs;
        return next;
      });
      if (done) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, scene.durationMs]);

  const setScene = (next: AnimationScene) =>
    onChange({ ...block, scenes: block.scenes.map((s, i) => (i === index ? next : s)) });
  const setElement = (id: string, next: AnimationElement) =>
    setScene({ ...scene, elements: scene.elements.map((e) => (e.id === id ? next : e)) });

  // Dragging an element on the stage: pointer movement is turned into percentages of the stage.
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; px: number; py: number; x: number; y: number } | null>(null);
  const onStageDown = (e: PointerEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-element-id]');
    const id = target?.dataset.elementId;
    if (!id) {
      setSelectedId(null);
      return;
    }
    const el = scene.elements.find((x) => x.id === id);
    if (!el) return;
    setSelectedId(id);
    setPlaying(false);
    setT(scene.durationMs);
    drag.current = { id, px: e.clientX, py: e.clientY, x: el.x, y: el.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onStageMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const box = stage.current?.getBoundingClientRect();
    if (!d || !box || box.width === 0) return;
    const el = scene.elements.find((x) => x.id === d.id);
    if (!el) return;
    const dx = ((e.clientX - d.px) / box.width) * 100;
    const dy = ((e.clientY - d.py) / box.height) * 100;
    setElement(
      d.id,
      placeElement(el, {
        x: Math.round((d.x + dx) * 10) / 10,
        y: Math.round((d.y + dy) * 10) / 10,
      }),
    );
  };
  const endDrag = () => {
    drag.current = null;
  };

  const addScene = () => {
    if (block.scenes.length >= MAX_SCENES) return;
    onChange({ ...block, scenes: [...block.scenes, newScene(newTemplate)] });
    setSceneIndex(block.scenes.length);
    setSelectedId(null);
  };
  const removeScene = () => {
    if (block.scenes.length === 1) return;
    onChange({ ...block, scenes: block.scenes.filter((_, i) => i !== index) });
    setSceneIndex(Math.max(0, index - 1));
    setSelectedId(null);
  };
  const addElement = (kind: ElementKind) => {
    if (scene.elements.length >= MAX_ELEMENTS) return;
    const el = newElement(kind);
    setScene({ ...scene, elements: [...scene.elements, el] });
    setSelectedId(el.id);
    setT(scene.durationMs);
  };

  const play = () => {
    setT(0);
    setPlaying(true);
  };
  const tooShort = lastMotionEnd(scene) > scene.durationMs;

  return (
    <div className="anim-editor">
      <TextField
        label="Animation title"
        value={block.title ?? ''}
        maxLength={200}
        onChange={(e) => onChange({ ...block, title: e.target.value || null })}
      />

      <div className="anim-editor__scenes" role="tablist" aria-label="Scenes">
        {block.scenes.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={i === index}
            className="anim-editor__scene-tab ac-focusable"
            onClick={() => {
              setSceneIndex(i);
              setSelectedId(null);
            }}
          >
            {i + 1}. {s.title || 'Untitled'}
          </button>
        ))}
      </div>
      <div className="row-actions">
        <Select
          label="Template for a new scene"
          value={newTemplate}
          options={options(TEMPLATE_LABELS)}
          onChange={(e) => setNewTemplate(e.target.value as SceneTemplate)}
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={block.scenes.length >= MAX_SCENES}
          onClick={addScene}
        >
          Add scene
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={block.scenes.length >= MAX_SCENES}
          onClick={() => {
            const copy = duplicateScene(scene);
            onChange({
              ...block,
              scenes: [...block.scenes.slice(0, index + 1), copy, ...block.scenes.slice(index + 1)],
            });
            setSceneIndex(index + 1);
          }}
        >
          Duplicate scene
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={index === 0}
          onClick={() => {
            onChange({ ...block, scenes: moveItem(block.scenes, index, -1) });
            setSceneIndex(index - 1);
          }}
        >
          Move scene earlier
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={index === block.scenes.length - 1}
          onClick={() => {
            onChange({ ...block, scenes: moveItem(block.scenes, index, 1) });
            setSceneIndex(index + 1);
          }}
        >
          Move scene later
        </Button>
        <Button
          size="sm"
          variant="tertiary"
          disabled={block.scenes.length === 1}
          onClick={removeScene}
        >
          Remove scene
        </Button>
      </div>

      <div className="anim-editor__grid">
        <div className="anim-editor__stage-col">
          <div
            ref={stage}
            className="anim-editor__stage"
            onPointerDown={onStageDown}
            onPointerMove={onStageMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <SceneFrame scene={scene} t={t} selectedId={selectedId ?? undefined} />
          </div>
          <div className="anim-editor__transport">
            <Button size="sm" onClick={playing ? () => setPlaying(false) : play}>
              {playing ? 'Pause preview' : 'Preview scene'}
            </Button>
            <label className="anim-editor__scrub">
              <span className="u-visually-hidden">Time in the scene</span>
              <input
                type="range"
                min={0}
                max={scene.durationMs}
                step={100}
                value={t}
                onChange={(e) => {
                  setPlaying(false);
                  setT(Number(e.target.value));
                }}
              />
            </label>
            <span className="anim-editor__clock">
              {seconds(t)} / {seconds(scene.durationMs)}
            </span>
          </div>
          {tooShort ? (
            <p className="field-error" role="alert">
              This scene ends before its last animation does. Lengthen the scene or start the
              animations earlier.
            </p>
          ) : null}

          <div className="anim-editor__timeline" role="list" aria-label="Timeline">
            {scene.elements.map((e) => {
              const start = e.motion.preset === 'none' ? 0 : e.motion.startMs;
              const len = e.motion.preset === 'none' ? scene.durationMs : e.motion.durationMs;
              const label =
                `${KIND_LABELS[e.kind]}: ${e.text || (e.icon ? ICON_LABELS[e.icon] : '')}`.replace(
                  /: $/,
                  '',
                );
              return (
                <div key={e.id} role="listitem" className="anim-editor__lane">
                  <button
                    type="button"
                    className="anim-editor__lane-label ac-focusable"
                    aria-pressed={e.id === selectedId}
                    onClick={() => setSelectedId(e.id)}
                  >
                    {label}
                  </button>
                  <span className="anim-editor__lane-track" aria-hidden>
                    <span
                      className="anim-editor__lane-bar"
                      style={{
                        left: `${Math.min(100, (start / scene.durationMs) * 100)}%`,
                        width: `${Math.max(1, Math.min(100 - (start / scene.durationMs) * 100, (len / scene.durationMs) * 100))}%`,
                      }}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="anim-editor__side">
          <TextField
            label="Scene title"
            value={scene.title}
            maxLength={200}
            onChange={(e) => setScene({ ...scene, title: e.target.value })}
          />
          <Textarea
            label="Narration"
            hint="Shown as captions, and read aloud for workers who turn that on."
            rows={3}
            maxLength={1200}
            value={scene.narration ?? ''}
            onChange={(e) => setScene({ ...scene, narration: e.target.value || null })}
          />
          <TextField
            label="Scene length (seconds)"
            type="number"
            min={MIN_SCENE_MS / 1000}
            max={MAX_SCENE_MS / 1000}
            step={0.5}
            value={scene.durationMs / 1000}
            onChange={(e) =>
              setScene({
                ...scene,
                durationMs: clampInt(
                  String(Number(e.target.value) * 1000),
                  MIN_SCENE_MS,
                  MAX_SCENE_MS,
                  DEFAULT_SCENE_MS,
                ),
              })
            }
          />

          <div className="row-actions" role="group" aria-label="Add to scene">
            {(Object.keys(KIND_LABELS) as ElementKind[]).map((k) => (
              <Button
                key={k}
                size="sm"
                variant="secondary"
                disabled={scene.elements.length >= MAX_ELEMENTS}
                onClick={() => addElement(k)}
              >
                Add {KIND_LABELS[k].toLowerCase()}
              </Button>
            ))}
          </div>

          {selected ? (
            <ElementInspector
              key={selected.id}
              element={selected}
              onChange={(next) => setElement(selected.id, next)}
              onDuplicate={() => {
                const copy = placeElement(
                  { ...selected, id: newId('el'), motion: { ...selected.motion } },
                  { x: selected.x + 3, y: selected.y + 3 },
                );
                setScene({ ...scene, elements: [...scene.elements, copy] });
                setSelectedId(copy.id);
              }}
              onRemove={() => {
                setScene({
                  ...scene,
                  elements: scene.elements.filter((e) => e.id !== selected.id),
                });
                setSelectedId(null);
              }}
              onMove={(delta) => {
                const at = scene.elements.findIndex((e) => e.id === selected.id);
                setScene({ ...scene, elements: moveItem(scene.elements, at, delta) });
              }}
            />
          ) : (
            <p className="u-m-0">
              Pick an element on the stage or in the timeline to change it. Drag it on the stage to
              move it.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ElementInspector({
  element: e,
  onChange,
  onDuplicate,
  onRemove,
  onMove,
}: {
  element: AnimationElement;
  onChange: (next: AnimationElement) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const num = (label: string, key: 'x' | 'y' | 'w' | 'h') => (
    <TextField
      label={label}
      type="number"
      min={0}
      max={100}
      step={1}
      value={e[key]}
      onChange={(ev) => onChange(placeElement(e, { [key]: Number(ev.target.value) }))}
    />
  );
  return (
    <fieldset className="anim-editor__inspector">
      <legend className="panel-heading">{KIND_LABELS[e.kind]}</legend>
      {e.kind === 'text' || e.kind === 'box' ? (
        <TextField
          label="Text"
          value={e.text ?? ''}
          maxLength={200}
          onChange={(ev) => onChange({ ...e, text: ev.target.value })}
        />
      ) : null}
      {e.kind === 'icon' ? (
        <Select
          label="Icon"
          value={e.icon ?? 'hazard'}
          options={options(ICON_LABELS)}
          onChange={(ev) => onChange({ ...e, icon: ev.target.value as AnimationElement['icon'] })}
        />
      ) : null}
      {e.kind === 'arrow' ? (
        <TextField
          label="Direction (degrees, 0 points right)"
          type="number"
          min={-180}
          max={180}
          step={15}
          value={e.rotation ?? 0}
          onChange={(ev) => onChange({ ...e, rotation: clampInt(ev.target.value, -180, 180, 0) })}
        />
      ) : null}
      <Select
        label="Colour"
        value={e.tone}
        options={options(TONE_LABELS)}
        onChange={(ev) => onChange({ ...e, tone: ev.target.value as AnimationElement['tone'] })}
      />
      <div className="form-row">
        {num('Left (%)', 'x')}
        {num('Top (%)', 'y')}
      </div>
      <div className="form-row">
        {num('Width (%)', 'w')}
        {num('Height (%)', 'h')}
      </div>
      <Select
        label="Animation"
        value={e.motion.preset}
        options={options(MOTION_LABELS)}
        onChange={(ev) =>
          onChange({
            ...e,
            motion: {
              ...e.motion,
              preset: ev.target.value as AnimationElement['motion']['preset'],
            },
          })
        }
      />
      {e.motion.preset !== 'none' ? (
        <div className="form-row">
          <TextField
            label="Starts at (ms)"
            type="number"
            min={0}
            max={60000}
            step={100}
            value={e.motion.startMs}
            onChange={(ev) =>
              onChange({
                ...e,
                motion: { ...e.motion, startMs: clampInt(ev.target.value, 0, 60000, 0) },
              })
            }
          />
          <TextField
            label="Takes (ms)"
            type="number"
            min={100}
            max={10000}
            step={100}
            value={e.motion.durationMs}
            onChange={(ev) =>
              onChange({
                ...e,
                motion: { ...e.motion, durationMs: clampInt(ev.target.value, 100, 10000, 600) },
              })
            }
          />
        </div>
      ) : null}
      <div className="row-actions">
        <Button size="sm" variant="secondary" onClick={() => onMove(-1)}>
          Send backward
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onMove(1)}>
          Bring forward
        </Button>
        <Button size="sm" variant="secondary" onClick={onDuplicate}>
          Duplicate
        </Button>
        <Button size="sm" variant="tertiary" onClick={onRemove}>
          Remove element
        </Button>
      </div>
    </fieldset>
  );
}
