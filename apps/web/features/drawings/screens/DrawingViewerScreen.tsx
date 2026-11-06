'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { MARKUP_VISIBILITIES, type MarkupVisibility, type Point } from '@archova/markup';
import { BookmarkButton } from '@/features/bookmarks';
import { webRoutes } from '@archova/routes';
import {
  Alert,
  Button,
  Dialog,
  DrawingCanvas,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
  ToggleGroup,
  type DrawingCanvasHandle,
} from '@archova/ui';
import { ArrowLeft, Hand, MousePointer2 } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import type {
  ViewerExtension,
  ViewerSheetContext,
  ViewerToolBinding,
} from '@/shared/drawing-viewer/extension';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { MarkupStyleControls } from '@/shared/markup/MarkupToolbar';
import {
  DEFAULT_MARKUP_STYLE,
  MARKUP_TOOLS,
  useMarkupDrawing,
  type MarkupStyle,
  type MarkupTool,
} from '@/shared/markup/useMarkupDrawing';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useActor } from '@/shared/providers/useActor';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { drawingsSource } from '../data/source';
import { MarkupLayer, MarkupShapeSvg, PinLayer } from '../components/overlay';
import { PdfSheet, type SheetSize } from '../components/PdfSheet';
import { RevisionBadge } from '../components/RevisionBadge';
import { SheetArtworkSvg } from '../components/SheetArtworkSvg';
import { SidePanel } from '../components/SidePanel';
import { SupersededBanner } from '../components/SupersededBanner';
import type { DrawingPin, DrawingRevision } from '../lib/types';
import {
  useConfirmScale,
  useGeometry,
  useMarkupMutations,
  useMarkups,
  useMovePin,
  usePins,
  useSheet,
} from '../hooks/useDrawings';

/** Until a PDF page reports its size, sheets are assumed A1 landscape, the usual AU drawing size. */
const A1: SheetSize = { widthMm: 841, heightMm: 594 };

type ViewerMode = 'pan' | 'select' | MarkupTool;

const VISIBILITY_LABELS: Record<MarkupVisibility, string> = {
  private: 'Only me',
  company: 'My company',
  project: 'Whole project',
};

/**
 * The sheet viewer (F1.3, frontend 07): revision badge and switcher, superseded banner, pins of linked records,
 * markups with visibility, compare, and the tools other features register (measure and count from estimating).
 */
export function DrawingViewerScreen({
  sheetId,
  extensions = [],
}: {
  sheetId: string;
  extensions?: readonly ViewerExtension[];
}) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const actor = useActor();
  const router = useRouter();
  const [params, setParams] = useUrlState(['rev', 'compare', 'compareMode'] as const);
  const sheet = useSheet(project.projectId, sheetId);

  const revisions = sheet.data?.revisions ?? [];
  const current = revisions.find((r) => r.status === 'current');
  const revision = revisions.find((r) => r.id === params.rev) ?? current;
  const revisionId = revision?.id;

  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'drawing_revision', id: revisionId ?? sheetId },
  });

  const geometry = useGeometry(project.projectId, revisionId);
  const pins = usePins(project.projectId, revisionId);
  const markups = useMarkups(project.projectId, revisionId);
  const markupMutations = useMarkupMutations(project.projectId, revisionId ?? '');
  const confirmScale = useConfirmScale(project.projectId, revisionId ?? '');

  const [mode, setMode] = useState<ViewerMode>('select');
  const [activeExtension, setActiveExtension] = useState<string | null>(null);
  const [binding, setBinding] = useState<ViewerToolBinding | null>(null);
  const [overlayTarget, setOverlayTarget] = useState<SVGGElement | null>(null);
  const [visibility, setVisibility] = useState<MarkupVisibility>('private');
  const [style, setStyle] = useState<MarkupStyle>(DEFAULT_MARKUP_STYLE);
  const [textAt, setTextAt] = useState<Point | null>(null);
  const [movingPin, setMovingPin] = useState<DrawingPin | null>(null);
  const movePin = useMovePin(project.projectId, revisionId ?? '');
  const [text, setText] = useState('');
  const canvasRef = useRef<DrawingCanvasHandle>(null);
  const [pdfSizes, setPdfSizes] = useState<Record<string, SheetSize>>({});

  const artwork = useMemo(
    () => (revisionId ? drawingsSource.artwork(project.projectId, revisionId) : null),
    [project.projectId, revisionId],
  );
  const compareRevision = revisions.find((r) => r.id === params.compare && r.id !== revisionId);
  const compareArtwork = useMemo(
    () => (compareRevision ? drawingsSource.artwork(project.projectId, compareRevision.id) : null),
    [project.projectId, compareRevision],
  );

  const drawing = useMarkupDrawing({
    tool: mode === 'pan' || mode === 'select' ? null : mode,
    style,
    onShape: (shape) => markupMutations.create.mutate({ shape, visibility }),
    onText: (at) => setTextAt(at),
  });
  const draftShape = drawing.draftShape;

  if (sheet.isPending) return <SkeletonRows label="Opening drawing…" />;
  if (sheet.isError || !revision) {
    return (
      <div className="stack">
        <ErrorAlert error={sheet.error} title="We couldn't open this drawing" />
        <Link className="link" href={webRoutes.drawings(org.orgSlug, project.projectId)}>
          Back to drawings
        </Link>
      </div>
    );
  }

  const s = sheet.data.sheet;
  const size: SheetSize =
    revision.widthMm && revision.heightMm
      ? { widthMm: revision.widthMm, heightMm: revision.heightMm }
      : (pdfSizes[revision.id] ?? A1);
  const aspect = size.widthMm / size.heightMm;
  const tz = project.timezone;
  const revHref = (id: string) => webRoutes.drawing(org.orgSlug, project.projectId, s.id, id);

  const ctx: ViewerSheetContext = {
    orgId: org.orgId,
    projectId: project.projectId,
    sheetId: s.id,
    sheetNumber: s.sheetNumber,
    sheetTitle: s.title,
    revisionId: revision.id,
    rev: revision.rev,
    isCurrent: revision.status === 'current',
    currentRevisionId: revision.status === 'superseded' ? (current?.id ?? null) : null,
    currentRev: revision.status === 'superseded' ? (current?.rev ?? null) : null,
    size,
    geometry: geometry.data ?? null,
    confirmScale: async (scale) => {
      await confirmScale.mutateAsync(scale);
    },
    revisions: revisions.map((r) => ({ id: r.id, rev: r.rev, status: r.status })),
    revisionHref: revHref,
    compareHref: (other) => `${revHref(revision.id)}&compare=${encodeURIComponent(other)}`,
  };

  const extension = extensions.find((e) => e.id === activeExtension) ?? null;

  const pickMode = (m: ViewerMode) => {
    setMode(m);
    drawing.cancel();
    setActiveExtension(null);
    setBinding(null);
    setMovingPin(null);
  };

  const toolBinding: ViewerToolBinding | null = movingPin
    ? {
        onPointerDown: (e) => {
          const pin = movingPin;
          setMovingPin(null);
          movePin.mutate({ pin, at: { x: e.point.x, y: e.point.y } });
        },
        onKeyDown: (e) => {
          if (e.key === 'Escape') {
            setMovingPin(null);
            return true;
          }
          return false;
        },
      }
    : extension
      ? binding
      : mode === 'pan' || mode === 'select'
        ? null
        : drawing.binding;

  /** The preview's drawn artwork, or the revision's PDF page. */
  const sheetImage = (rev: DrawingRevision, tone: 'ink' | 'old' | 'new' = 'ink') => {
    const art =
      rev.id === revisionId ? artwork : rev.id === compareRevision?.id ? compareArtwork : null;
    if (art) return <SheetArtworkSvg art={art} tone={tone} />;
    if (!rev.fileId) return null;
    return (
      <PdfSheet
        orgId={org.orgId}
        fileId={rev.fileId}
        pageIndex={rev.pageIndex}
        tone={tone}
        onSize={(sz) => setPdfSizes((m) => (m[rev.id] ? m : { ...m, [rev.id]: sz }))}
      />
    );
  };

  const comparing = Boolean(compareRevision && (compareArtwork || compareRevision.fileId));
  const compareMode = params.compareMode === 'side' ? 'side' : 'overlay';
  const label = `${s.sheetNumber} ${s.title}, Rev ${revision.rev}`;

  const background =
    comparing && compareMode === 'overlay' && compareRevision ? (
      <div className="drawing-compare-overlay">
        <svg
          viewBox={`0 0 ${size.widthMm} ${size.heightMm}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <rect width="100%" height="100%" fill="white" />
        </svg>
        {sheetImage(compareRevision, 'old')}
        {sheetImage(revision, 'new')}
      </div>
    ) : (
      sheetImage(revision)
    );

  const overlay = (
    <>
      {!comparing ? <MarkupLayer markups={markups.data ?? []} aspect={aspect} /> : null}
      {!comparing ? <PinLayer pins={pins.data ?? []} aspect={aspect} /> : null}
      {draftShape ? <MarkupShapeSvg shape={draftShape} aspect={aspect} preview /> : null}
      {extension ? <g ref={setOverlayTarget} data-layer={extension.id} /> : null}
    </>
  );

  return (
    <div className="drawing-viewer">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link className="link" href={webRoutes.drawings(org.orgSlug, project.projectId)}>
          <ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" /> Drawings
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{s.sheetNumber}</span>
      </nav>
      <header className="drawing-viewer__header">
        <div>
          <p className="u-mono drawing-viewer__number">{s.sheetNumber}</p>
          <h1 className="drawing-viewer__title">{s.title}</h1>
          <div className="drawing-viewer__meta">
            <RevisionBadge rev={revision.rev} status={revision.status} />
            {comparing ? (
              <StatusPill tone="info">Comparing with Rev {compareRevision?.rev}</StatusPill>
            ) : null}
          </div>
        </div>
        <div className="drawing-viewer__controls">
          <BookmarkButton
            entityType="drawing_sheet"
            entityId={s.id}
            projectId={project.projectId}
            title={`${s.sheetNumber} ${s.title}`}
          />
          <Select
            label="Revision"
            value={revision.id}
            onChange={(e) => router.push(revHref(e.target.value))}
            options={revisions.map((r) => ({
              value: r.id,
              label: `Rev ${r.rev}${r.status === 'current' ? ' (current)' : ''}`,
            }))}
          />
          <Select
            label="Compare with"
            placeholder="No comparison"
            value={compareRevision?.id ?? ''}
            onChange={(e) => {
              pickMode('select');
              setParams({ compare: e.target.value || null });
            }}
            options={revisions
              .filter((r) => r.id !== revision.id)
              .map((r) => ({ value: r.id, label: `Rev ${r.rev}` }))}
          />
          {comparing ? (
            <ToggleGroup
              label="Compare view"
              value={compareMode}
              onValueChange={(v) => setParams({ compareMode: v === 'side' ? 'side' : null })}
              options={[
                { value: 'overlay', label: 'Overlay' },
                { value: 'side', label: 'Side by side' },
              ]}
            />
          ) : null}
        </div>
      </header>

      <SupersededBanner
        revision={revision}
        currentHref={current ? revHref(current.id) : '#'}
        formatDate={(iso) => formatInstant(iso, tz)}
      />
      {previewDataOnly ? <PreviewDataNotice tool="The drawing viewer" /> : null}
      {movingPin ? (
        <Alert tone="info" title={`Place ${movingPin.label}`}>
          Click the sheet where it belongs. Press Escape or{' '}
          <button type="button" className="link-button" onClick={() => setMovingPin(null)}>
            cancel
          </button>{' '}
          to leave it where it is.
        </Alert>
      ) : null}
      <ErrorAlert error={movePin.error} title="We couldn't move the pin" />
      <ErrorAlert
        error={markupMutations.create.error ?? geometry.error}
        title="Something went wrong on this sheet"
      />

      {!comparing ? (
        <div className="drawing-viewer__toolbar" role="toolbar" aria-label="Drawing tools">
          <ToggleGroup<ViewerMode | 'ext'>
            label="Navigate and mark up"
            value={extension ? 'ext' : mode}
            onValueChange={(v) => v !== 'ext' && pickMode(v)}
            options={[
              {
                value: 'select',
                label: <MousePointer2 size={18} strokeWidth={1.5} aria-hidden="true" />,
                ariaLabel: 'Select',
              },
              {
                value: 'pan',
                label: <Hand size={18} strokeWidth={1.5} aria-hidden="true" />,
                ariaLabel: 'Pan',
              },
              ...MARKUP_TOOLS.map((t) => ({ value: t.value as ViewerMode, label: t.label })),
            ]}
          />
          {mode !== 'pan' && mode !== 'select' ? (
            <MarkupStyleControls style={style} onChange={setStyle} />
          ) : null}
          <label className="drawing-viewer__visibility">
            <span className="u-caption">New markups visible to</span>
            <select
              className="ac-input ac-select"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as MarkupVisibility)}
            >
              {MARKUP_VISIBILITIES.filter((v) => v !== 'project').map((v) => (
                <option key={v} value={v}>
                  {VISIBILITY_LABELS[v]}
                </option>
              ))}
            </select>
          </label>
          {extensions.map((ext) => (
            <Button
              key={ext.id}
              variant={ext.id === activeExtension ? 'primary' : 'secondary'}
              aria-pressed={ext.id === activeExtension}
              onClick={() => {
                if (ext.id === activeExtension) {
                  pickMode('select');
                } else {
                  setMode('select');
                  drawing.cancel();
                  setActiveExtension(ext.id);
                }
              }}
            >
              {ext.label}
            </Button>
          ))}
        </div>
      ) : null}

      {comparing && compareMode === 'side' && compareRevision ? (
        <div className="drawing-viewer__side-by-side">
          <figure className="u-m-0">
            <figcaption className="u-caption">Rev {compareRevision?.rev}</figcaption>
            <DrawingCanvas
              label={`${s.sheetNumber} Rev ${compareRevision?.rev}`}
              aspect={aspect}
              background={sheetImage(compareRevision)}
              mode="pan"
            />
          </figure>
          <figure className="u-m-0">
            <figcaption className="u-caption">Rev {revision.rev}</figcaption>
            <DrawingCanvas
              label={label}
              aspect={aspect}
              background={sheetImage(revision)}
              mode="pan"
            />
          </figure>
        </div>
      ) : (
        <div className="drawing-viewer__body">
          <DrawingCanvas
            label={label}
            aspect={aspect}
            background={background}
            overlay={overlay}
            mode={mode === 'pan' || (!toolBinding && mode === 'select') ? 'pan' : 'tool'}
            cursor={toolBinding?.cursor}
            onPointerDown={toolBinding?.onPointerDown}
            onPointerMove={toolBinding?.onPointerMove}
            onPointerUp={toolBinding?.onPointerUp}
            onPointerLeave={toolBinding?.onPointerLeave}
            onKeyDown={toolBinding?.onKeyDown}
            handleRef={canvasRef}
          />
          <aside
            className="drawing-viewer__panel"
            aria-label={extension ? extension.label : 'Sheet details'}
          >
            {extension ? (
              <extension.Panel
                sheet={ctx}
                active
                activate={() => setActiveExtension(extension.id)}
                bindTool={setBinding}
                overlayTarget={overlayTarget}
              />
            ) : comparing ? (
              <p className="u-muted">
                Rev {compareRevision?.rev} is drawn in orange and Rev {revision.rev} in blue, so
                changes stand out.
              </p>
            ) : (
              <SidePanel
                projectId={project.projectId}
                orgSlug={org.orgSlug}
                revisionId={revision.id}
                pins={pins.data ?? []}
                markups={markups.data ?? []}
                actorId={actor.id}
                timezone={tz}
                movingPinId={movingPin?.id}
                onMovePin={revision.status === 'current' ? setMovingPin : undefined}
              />
            )}
          </aside>
        </div>
      )}

      <Dialog
        open={textAt !== null}
        onClose={() => {
          setTextAt(null);
          setText('');
        }}
        title="Add a text markup"
        footer={
          <>
            <Button variant="secondary" onClick={() => setTextAt(null)}>
              Cancel
            </Button>
            <Button
              disabled={!text.trim()}
              onClick={() => {
                if (textAt)
                  markupMutations.create.mutate({
                    shape: { kind: 'text', at: textAt, text: text.trim(), ...style },
                    visibility,
                  });
                setTextAt(null);
                setText('');
              }}
            >
              Add text
            </Button>
          </>
        }
      >
        <TextField label="Text" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        <p className="u-caption u-m-0">Visible to: {VISIBILITY_LABELS[visibility]}</p>
      </Dialog>
    </div>
  );
}
