'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  AnimationPlayer,
  Button,
  Dialog,
  SkeletonRows,
  StatusPill,
  WatchToEndVideo,
  formatClock,
} from '@archova/ui';
import { FileText, ZoomIn, ZoomOut } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useInductionSource, useProgressMutation } from '../hooks/useInduction';
import { stepNumber, totalSteps } from '../lib/flow';
import type { SectionBlock } from '../lib/types';
import { StickyButton, WorkerShell } from '../components/WorkerShell';
import type { StepProps } from './types';

type Of<T extends SectionBlock['type']> = Extract<SectionBlock, { type: T }>;

/** Blocks that must be watched, paged through or opened before the section counts; the rest are read. */
const needsAction = (b: SectionBlock) =>
  b.type === 'video' || b.type === 'slides' || b.type === 'swms' || b.type === 'animation';

const BLOCKED_LABEL: Record<string, string> = {
  video: 'Watch to the end to continue',
  slides: 'See every page to continue',
  animation: 'Watch to the end to continue',
  swms: 'Open each SWMS to continue',
};

/**
 * B3: one section per screen, in order. A section is its blocks; each video is watched to the end, every slide
 * page seen and every SWMS opened, and then Next records the section on the server, which unlocks the following
 * steps (IND-AC4). A section already recorded stays open for reading again.
 */
export function SectionStep({ opened, go, online, index }: StepProps & { index: number }) {
  const { site, induction, progress, sessionId } = opened;
  const source = useInductionSource();
  const section = induction.sections[index]!;
  const state = progress.sections[section.id] ?? { complete: false };
  const n = induction.sectionCount;
  const next = () => go(index + 1 < n ? { kind: 'section', index: index + 1 } : { kind: 'quiz' });
  const back = () => go(index > 0 ? { kind: 'section', index: index - 1 } : { kind: 'details' });

  const [done, setDone] = useState<ReadonlySet<number>>(new Set());
  const [videoLeftS, setVideoLeftS] = useState<number | null>(null);
  const openedAt = useRef(Date.now());
  const read = useProgressMutation((sid, _: null) =>
    source.completeSection(sid, section.id, (Date.now() - openedAt.current) / 1000),
  );
  const pending = section.blocks.findIndex((b, i) => needsAction(b) && !done.has(i));
  const markDone = (i: number) => setDone((d) => (d.has(i) ? d : new Set(d).add(i)));

  let footer;
  if (state.complete) {
    footer = (
      <StickyButton back={back} onClick={next}>
        Next
      </StickyButton>
    );
  } else if (pending >= 0) {
    const type = section.blocks[pending]!.type;
    footer = (
      <StickyButton back={back} blocked onClick={next}>
        {type === 'video' && videoLeftS !== null
          ? `${BLOCKED_LABEL.video} (${formatClock(videoLeftS)} left)`
          : BLOCKED_LABEL[type]}
      </StickyButton>
    );
  } else {
    footer = (
      <StickyButton
        back={back}
        loading={read.isPending}
        onClick={() => read.mutate({ sessionId, args: null }, { onSuccess: next })}
      >
        Next
      </StickyButton>
    );
  }

  return (
    <WorkerShell
      site={site}
      step={{
        current: stepNumber({ kind: 'section', index }, induction),
        total: totalSteps(induction),
      }}
      saveState={
        read.isPending
          ? 'saving'
          : Object.values(progress.sections).some((s) => s.complete)
            ? 'saved'
            : null
      }
      online={online}
      footer={footer}
    >
      <div className="stack" key={section.id}>
        <p className="worker-eyebrow">
          Section {index + 1} of {n}
        </p>
        <h1 className="worker-title">{section.title}</h1>
        {section.blocks.map((block, i) => (
          <Block
            key={i}
            block={block}
            watched={state.complete || done.has(i)}
            onDone={() => markDone(i)}
            onVideoLeft={i === pending ? setVideoLeftS : undefined}
          />
        ))}
        <ErrorAlert error={read.error} title="That didn't save" />
      </div>
    </WorkerShell>
  );
}

function Block({
  block,
  watched,
  onDone,
  onVideoLeft,
}: {
  block: SectionBlock;
  watched: boolean;
  onDone: () => void;
  onVideoLeft?: ((seconds: number) => void) | undefined;
}) {
  switch (block.type) {
    case 'video':
      return <Video block={block} watched={watched} onDone={onDone} onLeft={onVideoLeft} />;
    case 'slides':
      return <Slides block={block} onAllSeen={onDone} />;
    case 'animation':
      return (
        <AnimationPlayer
          title={block.title ?? 'Induction animation'}
          scenes={block.scenes}
          enforce={!watched}
          onComplete={onDone}
        />
      );
    case 'text':
      return <TextBody body={block.body} />;
    case 'swms':
      return <Swms block={block} onOpen={onDone} />;
    case 'document':
      return <DocumentLink block={block} />;
    case 'image':
      return <Picture block={block} />;
  }
}

/** The address of a stored file is short-lived, so it is asked for when the block shows. */
function useFileUrl(fileId: string) {
  const source = useInductionSource();
  return useQuery({
    queryKey: ['induction', 'file', fileId],
    queryFn: () => source.fileUrl(fileId),
    staleTime: 4 * 60_000,
  });
}

function Video({
  block,
  watched,
  onDone,
  onLeft,
}: {
  block: Of<'video'>;
  watched: boolean;
  onDone: () => void;
  onLeft: ((seconds: number) => void) | undefined;
}) {
  const url = useFileUrl(block.fileId);
  if (url.isPending) return <SkeletonRows rows={2} label="Loading the video…" />;
  if (url.isError) return <ErrorAlert error={url.error} title="The video didn't load" />;
  return (
    <WatchToEndVideo
      title={block.title ?? 'Induction video'}
      src={url.data}
      enforce={!watched}
      onProgress={(p) => {
        onLeft?.(p.duration - p.furthest);
        if (p.furthest >= p.duration - 1) onDone();
      }}
    />
  );
}

/** One page at a time with large Back and Next; done once every page has been shown. */
function Slides({ block, onAllSeen }: { block: Of<'slides'>; onAllSeen: () => void }) {
  const [i, setI] = useState(0);
  const seen = useRef(new Set<number>());
  const onAllSeenRef = useRef(onAllSeen);
  onAllSeenRef.current = onAllSeen;
  useEffect(() => {
    seen.current.add(i);
    if (seen.current.size === block.slides.length) onAllSeenRef.current();
  }, [i, block.slides.length]);
  const slide = block.slides[i]!;
  const last = block.slides.length - 1;
  return (
    <div className="stack">
      <article className="worker-slide" aria-roledescription="slide" aria-live="polite">
        <h2 className="worker-subtitle">{slide.title}</h2>
        {slide.points.length === 1 ? (
          <p className="u-m-0">{slide.points[0]}</p>
        ) : (
          <ul className="u-m-0">
            {slide.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        )}
      </article>
      <div className="worker-pager">
        <Button variant="secondary" disabled={i === 0} onClick={() => setI(i - 1)}>
          Previous page
        </Button>
        <span>
          Page {i + 1} of {block.slides.length}
        </span>
        <Button variant="secondary" disabled={i === last} onClick={() => setI(i + 1)}>
          Next page
        </Button>
      </div>
    </div>
  );
}

/** `## heading`, `- point` and paragraphs: the little the builder's text blocks use. Consecutive points are one list. */
export function parseText(
  body: string,
): Array<{ kind: 'h' | 'p'; text: string } | { kind: 'ul'; items: string[] }> {
  const groups: ReturnType<typeof parseText> = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const prev = groups[groups.length - 1];
    if (line.startsWith('- ')) {
      if (prev?.kind === 'ul') prev.items.push(line.slice(2));
      else groups.push({ kind: 'ul', items: [line.slice(2)] });
    } else if (line.startsWith('## ')) groups.push({ kind: 'h', text: line.slice(3) });
    else groups.push({ kind: 'p', text: line });
  }
  return groups;
}

function TextBody({ body }: { body: string }) {
  return (
    <div className="worker-text">
      {parseText(body).map((g, i) =>
        g.kind === 'ul' ? (
          <ul key={i}>
            {g.items.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        ) : g.kind === 'h' ? (
          <h2 key={i} className="worker-subtitle">
            {g.text}
          </h2>
        ) : (
          <p key={i}>{g.text}</p>
        ),
      )}
    </div>
  );
}

/**
 * A SWMS opens and is ticked once opened. Awareness only, never sign-on for the task (product 14). The server
 * gives the title only, so without a summary the worker is pointed to the site office for the document.
 */
function Swms({ block, onOpen }: { block: Of<'swms'>; onOpen: () => void }) {
  const [showing, setShowing] = useState(false);
  const [opened, setOpened] = useState(false);
  return (
    <div className="stack">
      <div className="worker-card worker-swms">
        <FileText size={20} aria-hidden="true" />
        <span className="worker-swms__title">{block.title}</span>
        {opened ? <StatusPill tone="success">Opened</StatusPill> : null}
        <Button
          variant="secondary"
          onClick={() => {
            setShowing(true);
            setOpened(true);
            onOpen();
          }}
        >
          Open
        </Button>
      </div>
      <p className="u-caption u-m-0">
        You&apos;ll still sign on to the SWMS for your task on site.
      </p>
      <Dialog
        open={showing}
        onClose={() => setShowing(false)}
        title={block.title}
        footer={<Button onClick={() => setShowing(false)}>Close</Button>}
      >
        {block.summary ? (
          <ul>
            {block.summary.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        ) : (
          <p className="u-m-0">
            Ask at the site office for the full SWMS before you start this work.
          </p>
        )}
      </Dialog>
    </div>
  );
}

function DocumentLink({ block }: { block: Of<'document'> }) {
  const url = useFileUrl(block.fileId);
  if (url.isError) return <ErrorAlert error={url.error} title="The document didn't load" />;
  return (
    <div className="worker-card worker-swms">
      <FileText size={20} aria-hidden="true" />
      <span className="worker-swms__title">{block.title ?? 'Document'}</span>
      {url.data ? (
        <a className="link" href={url.data} target="_blank" rel="noopener noreferrer">
          Open
        </a>
      ) : (
        <span className="u-caption">Loading…</span>
      )}
    </div>
  );
}

function Picture({ block }: { block: Of<'image'> }) {
  const url = useFileUrl(block.fileId);
  const [zoom, setZoom] = useState(1);
  if (url.isPending) return <SkeletonRows rows={2} label="Loading the picture…" />;
  if (url.isError) return <ErrorAlert error={url.error} title="The picture didn't load" />;
  return (
    <div className="stack">
      <div className="worker-map" tabIndex={0} aria-label="Picture, scroll to move around">
        {/* eslint-disable-next-line @next/next/no-img-element -- a plain image keeps the worker page small */}
        <img
          src={url.data}
          alt={block.alt ?? block.title ?? 'Picture from the induction'}
          style={{ width: `${zoom * 100}%` }}
        />
      </div>
      <div className="worker-pager">
        <Button
          variant="secondary"
          iconOnly
          aria-label="Zoom out"
          disabled={zoom <= 1}
          onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
        >
          <ZoomOut size={20} aria-hidden="true" />
        </Button>
        <span>{Math.round(zoom * 100)}%</span>
        <Button
          variant="secondary"
          iconOnly
          aria-label="Zoom in"
          disabled={zoom >= 3}
          onClick={() => setZoom((z) => Math.min(3, z + 0.5))}
        >
          <ZoomIn size={20} aria-hidden="true" />
        </Button>
      </div>
      {block.title ? <p className="u-m-0">{block.title}</p> : null}
    </div>
  );
}
