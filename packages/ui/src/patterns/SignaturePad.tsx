'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { Checkbox } from '../primitives/Checkbox';

export interface SignaturePoint {
  /** Normalised 0..1 across the pad, so the server renders it at any size. */
  x: number;
  y: number;
}

export type SignatureValue =
  { method: 'drawn'; strokes: SignaturePoint[][] } | { method: 'typed'; name: string } | null;

export interface SignaturePadProps {
  /** The signer's full name, shown for the typed alternative. */
  name: string;
  /** Null until there is a usable signature: at least one stroke, or the typed name confirmed. */
  onChange: (value: SignatureValue) => void;
}

const PAD_ASPECT = 3;

/**
 * Finger or stylus signature captured as vector strokes (design 02 §7.10, design 08 B6), with Clear and an
 * accessible typed alternative: "I can't draw a signature" switches to the typed name plus a confirmation, recorded
 * as a typed signature. The server renders the stored image; this only collects points.
 */
export function SignaturePad({ name, onChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<SignaturePoint[][]>([]);
  const drawing = useRef(false);
  const [mode, setMode] = useState<'drawn' | 'typed'>('drawn');
  const [hasInk, setHasInk] = useState(false);
  const [typedConfirmed, setTypedConfirmed] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (mode === 'typed') {
      onChangeRef.current(
        typedConfirmed && name.trim() ? { method: 'typed', name: name.trim() } : null,
      );
    }
  }, [mode, typedConfirmed, name]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = Math.max(2, width / 300);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
    for (const stroke of strokes.current) {
      ctx.beginPath();
      stroke.forEach((p, i) =>
        i === 0 ? ctx.moveTo(p.x * width, p.y * height) : ctx.lineTo(p.x * width, p.y * height),
      );
      if (stroke.length === 1) ctx.lineTo(stroke[0]!.x * width + 0.5, stroke[0]!.y * height);
      ctx.stroke();
    }
  }, []);

  // Match the canvas resolution to its displayed size (and the screen's pixel density).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || mode !== 'drawn') return;
    const fit = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round((rect.width / PAD_ASPECT) * dpr));
      redraw();
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [mode, redraw]);

  const point = (e: PointerEvent<HTMLCanvasElement>): SignaturePoint => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    return {
      x: clamp((e.clientX - rect.left) / (rect.width || 1)),
      y: clamp((e.clientY - rect.top) / (rect.height || 1)),
    };
  };

  const emit = () =>
    onChangeRef.current(
      strokes.current.length
        ? { method: 'drawn', strokes: strokes.current.map((s) => [...s]) }
        : null,
    );

  if (mode === 'typed') {
    return (
      <div className="ac-signature">
        <p className="ac-signature__typed" aria-label={`Typed signature: ${name}`}>
          {name || 'Your name'}
        </p>
        <Checkbox
          label="I confirm this typed name is my signature."
          checked={typedConfirmed}
          onChange={(e) => setTypedConfirmed(e.target.checked)}
        />
        <button
          type="button"
          className="ac-signature__link ac-focusable"
          onClick={() => {
            setMode('drawn');
            setTypedConfirmed(false);
            emit();
          }}
        >
          Draw a signature instead
        </button>
      </div>
    );
  }

  return (
    <div className="ac-signature">
      <canvas
        ref={canvasRef}
        className="ac-signature__pad"
        role="img"
        aria-label={
          hasInk ? 'Signature drawn' : 'Signature box. Draw your signature with your finger.'
        }
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          drawing.current = true;
          strokes.current.push([point(e)]);
          redraw();
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          strokes.current[strokes.current.length - 1]!.push(point(e));
          redraw();
        }}
        onPointerUp={() => {
          if (!drawing.current) return;
          drawing.current = false;
          setHasInk(true);
          emit();
        }}
        onPointerCancel={() => {
          drawing.current = false;
        }}
      />
      <div className="ac-signature__actions">
        <button
          type="button"
          className="ac-signature__link ac-focusable"
          disabled={!hasInk}
          onClick={() => {
            strokes.current = [];
            setHasInk(false);
            redraw();
            emit();
          }}
        >
          Clear
        </button>
        <button
          type="button"
          className="ac-signature__link ac-focusable"
          onClick={() => {
            setMode('typed');
            onChangeRef.current(null);
          }}
        >
          I can&apos;t draw a signature
        </button>
      </div>
    </div>
  );
}
