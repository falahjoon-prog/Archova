'use client';

import { useEffect, useRef, useState } from 'react';
import { fileDownloadUrl } from '@/shared/lib/uploads';

/** PDF user units are points: 72 to the inch. */
const MM_PER_POINT = 25.4 / 72;
/** Width the page is rasterised to: sharp at a few steps of zoom without a huge canvas on A0 sheets. */
const RENDER_WIDTH_PX = 4096;

export interface SheetSize {
  widthMm: number;
  heightMm: number;
}

/**
 * One page of a drawing PDF, rendered with pdf.js off the main thread (frontend 05 §3) into a canvas that fills the
 * sheet area. Reports the page's paper size so overlays and measurements use the real aspect. Black on white like
 * a printed sheet; compare mode tints the old revision orange and the new one blue (DOC-AC9).
 */
export function PdfSheet({
  orgId,
  fileId,
  pageIndex,
  tone = 'ink',
  onSize,
}: {
  orgId: string;
  fileId: string;
  pageIndex: number;
  tone?: 'ink' | 'old' | 'new';
  onSize?: (size: SheetSize) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onSizeRef = useRef(onSize);
  onSizeRef.current = onSize;
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    let cancelRender: (() => void) | undefined;
    setState('loading');
    (async () => {
      // The legacy build: the modern one calls Map.getOrInsertComputed, which many browsers don't have yet.
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString();
      const url = await fileDownloadUrl(orgId, fileId);
      const doc = await pdfjs.getDocument({ url }).promise;
      const page = await doc.getPage(pageIndex + 1);
      const base = page.getViewport({ scale: 1 });
      if (cancelled) return;
      onSizeRef.current?.({
        widthMm: base.width * MM_PER_POINT,
        heightMm: base.height * MM_PER_POINT,
      });
      const viewport = page.getViewport({ scale: RENDER_WIDTH_PX / base.width });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const task = page.render({ canvas, viewport, background: 'white' });
      cancelRender = () => task.cancel();
      await task.promise;
      if (!cancelled) setState('ready');
    })().catch((e: unknown) => {
      if (cancelled) return;
      // eslint-disable-next-line no-console -- there's no error reporting yet, and this is the only trace of the cause.
      console.error('Drawing sheet failed to render', e);
      setState('error');
    });
    return () => {
      cancelled = true;
      cancelRender?.();
    };
  }, [orgId, fileId, pageIndex]);

  return (
    <div className={`pdf-sheet pdf-sheet--${tone}`}>
      <canvas ref={canvasRef} aria-hidden="true" />
      {state === 'loading' ? (
        <p className="pdf-sheet__status" role="status">
          Loading the sheet…
        </p>
      ) : null}
      {state === 'error' ? (
        <p className="pdf-sheet__status" role="alert">
          This sheet couldn&apos;t be displayed. Try reloading.
        </p>
      ) : null}
    </div>
  );
}
