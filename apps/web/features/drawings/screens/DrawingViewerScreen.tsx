'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  MARKUP_VISIBILITIES,
  type MarkupShape,
  type MarkupVisibility,
  type Point,
} from '@archova/markup';
import { webRoutes } from '@archova/routes';
import {
  Button,
  Dialog,
  DrawingCanvas,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
  ToggleGroup,
  type CanvasPointerEvent,
  type DrawingCanvasHandle,
} from '@archova/ui';
import { ArrowLeft, Hand, MousePointer2, Square } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import type {
  ViewerExtension,
  ViewerSheetContext,
  ViewerToolBinding,
} from '@/shared/drawing-viewer/extension';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useActor } from '@/shared/providers/useActor';
import { drawingsSource } from '../data/source';
import { MarkupLayer, MarkupShapeSvg, PinLayer } from '../components/overlay';
import { RevisionBadge } from '../components/RevisionBadge';
import { SheetArtworkSvg } from '../components/SheetArtworkSvg';
import { SidePanel } from '../components/SidePanel';
import { SupersededBanner } from '../components/SupersededBanner';
import {
  useConfirmScale,
  useGeometry,
  useMarkupMutations,
  useMarkups,
  usePins,
  useSheet,
} from '../hooks/useDrawings';

type MarkupTool = 'rect' | 'cloud' | 'arrow' | 'text';
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
  const [extensionOverlay, setExtensionOverlay] = useState<ReactNode>(null);
  const [visibility, setVisibility] = useState<MarkupVisibility>('private');
  const [draftFrom, setDraftFrom] = useState<Point | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const [textAt, setTextAt] = useState<Point | null>(null);
  const [text, setText] = useState('');
  const canvasRef = useRef<DrawingCanvasHandle>(null);

  const artwork = useMemo(
    () => (revisionId ? drawingsSource.artwork(project.projectId, revisionId) : null),
    [project.projectId, revisionId],
  );
  const compareRevision = revisions.find((r) => r.id === params.compare && r.id !== revisionId);
  const compareArtwork = useMemo(
    () => (compareRevision ? drawingsSource.artwork(project.projectId, compareRevision.id) : null),
    [project.projectId, compareRevision],
  );

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
  const aspect = revision.widthMm / revision.heightMm;
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
    size: { widthMm: revision.widthMm, heightMm: revision.heightMm },
    geometry: geometry.data ?? null,
    confirmScale: async (scale) => {
      await confirmScale.mutateAsync(scale);
    },
    revisionHref: revHref,
  };

  const extension = extensions.find((e) => e.id === activeExtension) ?? null;

  const pickMode = (m: ViewerMode) => {
    setMode(m);
    setDraftFrom(null);
    setActiveExtension(null);
    setBinding(null);
    setExtensionOverlay(null);
  };

  const finishShape = (shape: MarkupShape) => {
    markupMutations.create.mutate({ shape, visibility });
    setDraftFrom(null);
  };

  const markupPointerDown = (e: CanvasPointerEvent) => {
    if (mode === 'text') {
      setTextAt(e.point);
      return;
    }
    if (mode !== 'rect' && mode !== 'cloud' && mode !== 'arrow') return;
    if (!draftFrom) setDraftFrom(e.point);
    else finishShape({ kind: mode, from: draftFrom, to: e.point });
  };

  const draftShape: MarkupShape | null =
    draftFrom && hover && (mode === 'rect' || mode === 'cloud' || mode === 'arrow')
      ? { kind: mode, from: draftFrom, to: hover }
      : null;

  const toolBinding: ViewerToolBinding | null = extension
    ? binding
    : mode === 'pan' || mode === 'select'
      ? null
      : {
          onPointerDown: markupPointerDown,
          onPointerMove: (e) => setHover(e.point),
          onKeyDown: (e) => {
            if (e.key === 'Escape') {
              setDraftFrom(null);
              return true;
            }
            return false;
          },
        };

  const comparing = Boolean(compareRevision && compareArtwork);
  const compareMode = params.compareMode === 'side' ? 'side' : 'overlay';
  const label = `${s.sheetNumber} ${s.title}, Rev ${revision.rev}`;

  const background = artwork ? (
    comparing && compareMode === 'overlay' && compareArtwork ? (
      <div className="drawing-compare-overlay">
        <svg
          viewBox={`0 0 ${artwork.widthMm} ${artwork.heightMm}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <rect width="100%" height="100%" fill="white" />
        </svg>
        <SheetArtworkSvg art={compareArtwork} tone="old" />
        <SheetArtworkSvg art={artwork} tone="new" />
      </div>
    ) : (
      <SheetArtworkSvg art={artwork} />
    )
  ) : null;

  const overlay = (
    <>
      {!comparing ? <MarkupLayer markups={markups.data ?? []} aspect={aspect} /> : null}
      {!comparing ? <PinLayer pins={pins.data ?? []} aspect={aspect} /> : null}
      {draftShape ? <MarkupShapeSvg shape={draftShape} aspect={aspect} preview /> : null}
      {extension ? extensionOverlay : null}
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
      <PreviewDataNotice tool="The drawing viewer" />
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
              {
                value: 'rect',
                label: <Square size={18} strokeWidth={1.5} aria-hidden="true" />,
                ariaLabel: 'Rectangle markup',
              },
              { value: 'cloud', label: 'Cloud' },
              { value: 'arrow', label: 'Arrow' },
              { value: 'text', label: 'Text' },
            ]}
          />
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
                  setDraftFrom(null);
                  setActiveExtension(ext.id);
                }
              }}
            >
              {ext.label}
            </Button>
          ))}
        </div>
      ) : null}

      {comparing && compareMode === 'side' && compareArtwork ? (
        <div className="drawing-viewer__side-by-side">
          <figure className="u-m-0">
            <figcaption className="u-caption">Rev {compareRevision?.rev}</figcaption>
            <DrawingCanvas
              label={`${s.sheetNumber} Rev ${compareRevision?.rev}`}
              aspect={aspect}
              background={<SheetArtworkSvg art={compareArtwork} />}
              mode="pan"
            />
          </figure>
          <figure className="u-m-0">
            <figcaption className="u-caption">Rev {revision.rev}</figcaption>
            <DrawingCanvas
              label={label}
              aspect={aspect}
              background={artwork ? <SheetArtworkSvg art={artwork} /> : null}
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
                setOverlay={setExtensionOverlay}
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
                if (textAt) finishShape({ kind: 'text', at: textAt, text: text.trim() });
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
