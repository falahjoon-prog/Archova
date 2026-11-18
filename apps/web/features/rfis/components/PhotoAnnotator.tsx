'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, DrawingCanvas, TextField, ToggleGroup } from '@archova/ui';
import { Hand } from '@archova/ui/icons';
import type { MarkupShape } from '@archova/markup';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { MarkupStyleControls } from '@/shared/markup/MarkupToolbar';
import { MarkupShapeSvg } from '@/shared/markup/ShapeSvg';
import {
  DEFAULT_MARKUP_STYLE,
  MARKUP_TOOLS,
  useMarkupDrawing,
  type MarkupStyle,
  type MarkupTool,
} from '@/shared/markup/useMarkupDrawing';
import type { RfiAnnotation, RfiPhoto } from '../lib/types';

/** Photos are drawn heavier than sheets: they are viewed smaller, and a thin red line vanishes on gravel. */
const PHOTO_WEIGHT = 2;

type Mode = 'pan' | MarkupTool;

/**
 * Marks up one RFI photo (RFI photo annotation): arrows, boxes, clouds, freehand and notes over the photo, in the
 * caller's own layer. Other people's layers show underneath and can't be changed from here. The photo itself is
 * never altered. Nothing is saved until the person presses Save, so a stray tap can't change the record.
 */
export function PhotoAnnotator({
  photo,
  layers,
  viewerId,
  readOnly,
  saving,
  error,
  onSave,
  onClose,
}: {
  photo: RfiPhoto;
  /** Every layer on this photo, the viewer's included. */
  layers: readonly RfiAnnotation[];
  viewerId: string;
  /** Closed or void RFIs keep their marks but take no more. */
  readOnly: boolean;
  saving: boolean;
  error: unknown;
  onSave: (shapes: MarkupShape[]) => void;
  onClose: () => void;
}) {
  const mine = layers.find((l) => l.authorId === viewerId);
  const others = layers.filter((l) => l.authorId !== viewerId);
  const saved = useMemo(() => mine?.shapes ?? [], [mine]);
  const [shapes, setShapes] = useState<MarkupShape[]>(() => [...saved]);
  const [mode, setMode] = useState<Mode>('pan');
  const [style, setStyle] = useState<MarkupStyle>({
    ...DEFAULT_MARKUP_STYLE,
    strokeWidth: 2,
  });
  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState('');
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);

  const root = useRef<HTMLElement>(null);
  // Opening a photo lands on it, wherever the person was scrolled to.
  useEffect(() => {
    root.current?.scrollIntoView?.({ block: 'start' });
  }, []);

  // The canvas needs the photo's proportions before it can lay the sheet out.
  useEffect(() => {
    setSize(null);
    setFailed(false);
    const img = new Image();
    img.onload = () => setSize({ w: img.naturalWidth || 4, h: img.naturalHeight || 3 });
    img.onerror = () => setFailed(true);
    img.src = photo.url;
  }, [photo.url]);

  const drawing = useMarkupDrawing({
    tool: mode === 'pan' || readOnly ? null : mode,
    style,
    onShape: (shape) => setShapes((list) => [...list, shape]),
    onText: (at) => setTextAt(at),
  });

  const dirty = useMemo(() => JSON.stringify(shapes) !== JSON.stringify(saved), [shapes, saved]);
  const aspect = size ? size.w / size.h : 4 / 3;

  const addText = () => {
    if (textAt && text.trim())
      setShapes((list) => [...list, { kind: 'text', at: textAt, text: text.trim(), ...style }]);
    setTextAt(null);
    setText('');
  };

  const overlay = (
    <>
      {others.map((l) => (
        <g key={l.id} data-layer={`marks-${l.authorId}`} opacity={0.75}>
          {l.shapes.map((s, i) => (
            <MarkupShapeSvg key={i} shape={s} aspect={aspect} weight={PHOTO_WEIGHT} />
          ))}
        </g>
      ))}
      <g data-layer="my-marks">
        {shapes.map((s, i) => (
          <MarkupShapeSvg key={i} shape={s} aspect={aspect} weight={PHOTO_WEIGHT} />
        ))}
      </g>
      {drawing.draftShape ? (
        <MarkupShapeSvg shape={drawing.draftShape} aspect={aspect} weight={PHOTO_WEIGHT} preview />
      ) : null}
    </>
  );

  return (
    <section ref={root} className="photo-annotator stack" aria-label={`Mark up ${photo.name}`}>
      <div className="photo-annotator__bar">
        <Button variant="tertiary" onClick={onClose}>
          Back to photos
        </Button>
        <p className="u-m-0 u-caption photo-annotator__name">{photo.name}</p>
      </div>

      {readOnly ? (
        <Alert tone="info" title="This RFI is closed">
          Marks stay on the record, but no more can be added.
        </Alert>
      ) : (
        <div className="drawing-viewer__toolbar" role="toolbar" aria-label="Photo markup tools">
          <ToggleGroup<Mode>
            label="Markup tool"
            value={mode}
            onValueChange={(m) => {
              drawing.cancel();
              setMode(m);
            }}
            options={[
              {
                value: 'pan',
                label: <Hand size={18} strokeWidth={1.5} aria-hidden="true" />,
                ariaLabel: 'Move the photo',
              },
              ...MARKUP_TOOLS.map((t) => ({ value: t.value as Mode, label: t.label })),
            ]}
          />
          {mode !== 'pan' ? <MarkupStyleControls style={style} onChange={setStyle} /> : null}
          <Button
            variant="secondary"
            disabled={shapes.length === 0}
            onClick={() => setShapes((list) => list.slice(0, -1))}
          >
            Undo
          </Button>
          <Button variant="tertiary" disabled={shapes.length === 0} onClick={() => setShapes([])}>
            Clear my marks
          </Button>
        </div>
      )}

      {failed ? (
        <Alert tone="danger" title="We couldn't load this photo">
          The link may have expired. Go back and open the photo again.
        </Alert>
      ) : size ? (
        <DrawingCanvas
          label={`${photo.name}, photo`}
          aspect={aspect}
          background={
            // eslint-disable-next-line @next/next/no-img-element -- a signed storage URL, drawn at the canvas size
            <img src={photo.url} alt="" draggable={false} className="photo-annotator__img" />
          }
          overlay={overlay}
          mode={mode === 'pan' || readOnly ? 'pan' : 'tool'}
          onPointerDown={drawing.binding.onPointerDown}
          onPointerMove={drawing.binding.onPointerMove}
          onPointerUp={drawing.binding.onPointerUp}
          onKeyDown={drawing.binding.onKeyDown}
        />
      ) : (
        <p className="u-muted" role="status">
          Loading photo…
        </p>
      )}

      {textAt ? (
        <form
          className="photo-annotator__text"
          onSubmit={(e) => {
            e.preventDefault();
            addText();
          }}
        >
          <TextField
            label="Note on the photo"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <Button type="submit" disabled={!text.trim()}>
            Add note
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setTextAt(null);
              setText('');
            }}
          >
            Cancel
          </Button>
        </form>
      ) : null}

      <ul className="photo-annotator__legend u-caption" aria-label="Who has marked this photo">
        {others.map((l) => (
          <li key={l.id}>
            {l.authorName}: {l.shapes.length} {l.shapes.length === 1 ? 'mark' : 'marks'}
          </li>
        ))}
        <li>
          You: {shapes.length} {shapes.length === 1 ? 'mark' : 'marks'}
          {dirty ? ' (not saved)' : ''}
        </li>
      </ul>
      <ErrorAlert error={error} title="We couldn't save your marks" />
      {readOnly ? null : (
        <div className="photo-annotator__actions">
          <Button disabled={!dirty || saving} onClick={() => onSave(shapes)}>
            {saving ? 'Saving…' : 'Save marks'}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {dirty ? 'Discard changes' : 'Done'}
          </Button>
        </div>
      )}
    </section>
  );
}
