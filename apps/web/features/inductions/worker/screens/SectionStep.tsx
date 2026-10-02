'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, StatusPill, WatchToEndVideo, formatClock } from '@archova/ui';
import { FileText, ZoomIn, ZoomOut } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { inductionSource } from '../data/source';
import { useProgressMutation } from '../hooks/useInduction';
import { stepNumber, totalSteps } from '../lib/flow';
import type { InductionSection, SectionProgress } from '../lib/types';
import { StickyButton, WorkerShell } from '../components/WorkerShell';
import type { StepProps } from './types';

type Of<T extends InductionSection['type']> = Extract<InductionSection, { type: T }>;

/**
 * B3: one section per screen, in order. Each type has its own rule for "done" (video watched to the end, every
 * slide seen, every SWMS opened, text and map read), and the server's answer is what unlocks Next (IND-AC4).
 */
export function SectionStep({ opened, go, online, index }: StepProps & { index: number }) {
  const { site, induction, progress, sessionId } = opened;
  const section = induction.sections[index]!;
  const state: SectionProgress = progress.sections[section.id] ?? { complete: false };
  const n = induction.sections.length;
  const next = () => go(index + 1 < n ? { kind: 'section', index: index + 1 } : { kind: 'quiz' });
  const back = () => go(index > 0 ? { kind: 'section', index: index - 1 } : { kind: 'details' });

  const watch = useProgressMutation((sid, a: { furthest: number }) =>
    inductionSource.reportWatch(sid, section.id, a.furthest),
  );
  const page = useProgressMutation((sid, a: { page: number }) =>
    inductionSource.viewPage(sid, section.id, a.page),
  );
  const open = useProgressMutation((sid, a: { documentId: string }) =>
    inductionSource.openDocument(sid, section.id, a.documentId),
  );
  const read = useProgressMutation((sid, _: null) =>
    inductionSource.completeSection(sid, section.id),
  );
  const saving = [watch, page, open, read].some((m) => m.isPending);
  const error = watch.error ?? page.error ?? open.error ?? read.error;

  let footer;
  if (section.type === 'video') {
    const left = section.durationS - (state.watchedS ?? 0);
    footer = (
      <StickyButton back={back} blocked={!state.complete} onClick={next}>
        {state.complete ? 'Next' : `Watch to the end to continue (${formatClock(left)} left)`}
      </StickyButton>
    );
  } else if (section.type === 'slides' || section.type === 'swms') {
    footer = (
      <StickyButton back={back} blocked={!state.complete} onClick={next}>
        {state.complete
          ? 'Next'
          : section.type === 'slides'
            ? 'See every page to continue'
            : 'Open each SWMS to continue'}
      </StickyButton>
    );
  } else {
    footer = (
      <StickyButton
        back={back}
        loading={read.isPending}
        onClick={() =>
          state.complete ? next() : read.mutate({ sessionId, args: null }, { onSuccess: next })
        }
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
      saveState={saving ? 'saving' : Object.keys(progress.sections).length ? 'saved' : null}
      online={online}
      footer={footer}
    >
      <div className="stack" key={section.id}>
        <p className="worker-eyebrow">
          Section {index + 1} of {n}
        </p>
        <h1 className="worker-title">{section.title}</h1>
        {section.type === 'video' ? (
          <WatchToEndVideo
            title={section.title}
            src={section.src}
            lowDataSrc={section.lowDataSrc}
            captionsSrc={section.captionsSrc}
            transcript={section.transcript}
            enforce={!state.complete}
            onProgress={(p) => {
              if (p.furthest > (state.watchedS ?? 0))
                watch.mutate({ sessionId, args: { furthest: p.furthest } });
            }}
          />
        ) : section.type === 'slides' ? (
          <Slides
            section={section}
            onView={(i) => {
              if (!state.pagesSeen?.includes(i)) page.mutate({ sessionId, args: { page: i } });
            }}
          />
        ) : section.type === 'text' ? (
          <TextBlocks section={section} />
        ) : section.type === 'swms' ? (
          <Swms
            section={section}
            opened={state.opened ?? []}
            onOpen={(documentId) => {
              if (!state.opened?.includes(documentId))
                open.mutate({ sessionId, args: { documentId } });
            }}
          />
        ) : (
          <SiteMap section={section} />
        )}
        <ErrorAlert error={error} title="That didn't save" />
      </div>
    </WorkerShell>
  );
}

/** One page at a time with large Back and Next; each page shown is reported once. */
function Slides({ section, onView }: { section: Of<'slides'>; onView: (page: number) => void }) {
  const [i, setI] = useState(0);
  const onViewRef = useRef(onView);
  onViewRef.current = onView;
  useEffect(() => onViewRef.current(i), [i]);
  const page = section.pages[i]!;
  const last = section.pages.length - 1;
  return (
    <div className="stack">
      <article className="worker-slide" aria-roledescription="slide" aria-live="polite">
        <h2 className="worker-subtitle">{page.heading}</h2>
        <p className="u-m-0">{page.body}</p>
      </article>
      <div className="worker-pager">
        <Button variant="secondary" disabled={i === 0} onClick={() => setI(i - 1)}>
          Previous page
        </Button>
        <span>
          Page {i + 1} of {section.pages.length}
        </span>
        <Button variant="secondary" disabled={i === last} onClick={() => setI(i + 1)}>
          Next page
        </Button>
      </div>
    </div>
  );
}

function TextBlocks({ section }: { section: Of<'text'> }) {
  // Consecutive list items become one list.
  const groups: Array<{ kind: 'h' | 'p'; text: string } | { kind: 'ul'; items: string[] }> = [];
  for (const b of section.blocks) {
    const prev = groups[groups.length - 1];
    if (b.kind === 'li') {
      if (prev?.kind === 'ul') prev.items.push(b.text);
      else groups.push({ kind: 'ul', items: [b.text] });
    } else groups.push({ kind: b.kind, text: b.text });
  }
  return (
    <div className="worker-text">
      {groups.map((g, i) =>
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

/** Each SWMS opens and is ticked once opened. Awareness only, never sign-on for the task (product 14). */
function Swms({
  section,
  opened,
  onOpen,
}: {
  section: Of<'swms'>;
  opened: string[];
  onOpen: (documentId: string) => void;
}) {
  const [showing, setShowing] = useState<Of<'swms'>['documents'][number] | null>(null);
  return (
    <div className="stack">
      <p className="u-m-0">Open each one and read it.</p>
      <ul className="plain-list stack">
        {section.documents.map((d) => {
          const done = opened.includes(d.id);
          return (
            <li key={d.id} className="worker-card worker-swms">
              <FileText size={20} aria-hidden="true" />
              <span className="worker-swms__title">{d.title}</span>
              {done ? <StatusPill tone="success">Opened</StatusPill> : null}
              <Button
                variant="secondary"
                onClick={() => {
                  setShowing(d);
                  onOpen(d.id);
                }}
              >
                Open
              </Button>
            </li>
          );
        })}
      </ul>
      <p className="u-caption u-m-0">
        You&apos;ll still sign on to the SWMS for your task on site.
      </p>
      <Dialog
        open={showing !== null}
        onClose={() => setShowing(null)}
        title={showing?.title ?? ''}
        footer={<Button onClick={() => setShowing(null)}>Close</Button>}
      >
        <ul>
          {showing?.summary.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}

function SiteMap({ section }: { section: Of<'site_map'> }) {
  const [zoom, setZoom] = useState(1);
  return (
    <div className="stack">
      <div className="worker-map" tabIndex={0} aria-label="Site map, scroll to move around">
        {/* eslint-disable-next-line @next/next/no-img-element -- a plain image keeps the worker page small */}
        <img src={section.imageSrc} alt={section.alt} style={{ width: `${zoom * 100}%` }} />
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
      <p className="u-m-0">{section.description}</p>
    </div>
  );
}
