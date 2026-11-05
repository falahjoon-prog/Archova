'use client';

import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatusPill,
  Tabs,
  Textarea,
  type DataTableColumn,
  type StatusTone,
} from '@archova/ui';
import { IncidentsIcon } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useHazardMutations, useHazardPatterns, useHazardSignals } from '../hooks/useHazardSignals';
import {
  CONFIDENCE_LABELS,
  PHOTO_MAX_BYTES,
  PHOTO_TYPES,
  STATUS_LABELS,
  TREND_LABELS,
  type HazardPattern,
  type HazardScan,
  type HazardSignal,
  type SignalStatus,
} from '../lib/types';

const TABS = [
  { id: 'scan', label: 'Scan a photo' },
  { id: 'review', label: 'Review' },
  { id: 'patterns', label: 'Patterns' },
] as const;

const STATUS_TONE: Record<SignalStatus, StatusTone> = {
  open: 'warning',
  confirmed: 'danger',
  dismissed: 'neutral',
};

/**
 * Hazard signals Nova flags in site photos (F35). A signal is what the photo shows, for a safety manager to confirm
 * or dismiss; Nova never says a rule was broken and raises no incident. Confirmed signals make patterns.
 */
export function HazardSignalsScreen() {
  const project = useCurrentProject();
  const [params, setParams] = useUrlState(['tab'] as const);
  const tab = TABS.some((t) => t.id === params.tab) ? params.tab : 'scan';
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'safety_signals', id: 'register' },
  });
  return (
    <>
      <PageHeader
        eyebrow="Quality and safety"
        title="Safety signals"
        description="Nova looks at site photos for visible hazards, like missing protective equipment or an open edge. You decide what is real; repeated hazards show up as patterns before they become incidents."
      />
      {previewDataOnly ? <PreviewDataNotice tool="Safety signals" /> : null}
      <Tabs
        label="Safety signals"
        tabs={TABS}
        value={tab}
        onValueChange={(id) => setParams({ tab: id })}
      >
        {tab === 'scan' ? <ScanPanel /> : tab === 'review' ? <ReviewPanel /> : <PatternsPanel />}
      </Tabs>
    </>
  );
}

function ScanPanel() {
  const m = useHazardMutations();
  const [photo, setPhoto] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const result: HazardScan | undefined = m.scan.data;

  const choose = (file: File | null) => {
    setPhoto(file);
    if (file && !PHOTO_TYPES.includes(file.type)) setProblem('Use a PNG, JPEG or WebP photo.');
    else if (file && file.size > PHOTO_MAX_BYTES) setProblem('Use a photo under 3 MB.');
    else setProblem(null);
  };

  return (
    <div className="stack">
      <Card>
        <div className="stack">
          <div className="stack">
            <label className="ac-field__label" htmlFor="signal-photo">
              Site photo
            </label>
            <input
              id="signal-photo"
              className="file-input"
              type="file"
              accept={PHOTO_TYPES.join(',')}
              onChange={(e) => choose(e.target.files?.[0] ?? null)}
            />
            {problem ? <Alert tone="warning">{problem}</Alert> : null}
          </div>
          <Textarea
            label="What is this photo of? (optional)"
            value={note}
            maxLength={1000}
            rows={3}
            onChange={(e) => setNote(e.target.value)}
          />
          <div>
            <Button
              disabled={!photo || !!problem || m.scan.isPending}
              onClick={() => photo && m.scan.mutate({ photo, note })}
            >
              {m.scan.isPending ? 'Nova is looking…' : 'Look for hazards'}
            </Button>
          </div>
        </div>
      </Card>
      <ErrorAlert error={m.scan.error} title="Nova couldn't scan this photo" />
      {result ? (
        <ScanResult result={result} />
      ) : (
        <p className="ac-muted">
          Nova flags what it can see. Signals wait in the Review tab for a safety manager.
        </p>
      )}
    </div>
  );
}

function ScanResult({ result }: { result: HazardScan }) {
  return (
    <div className="stack" aria-live="polite">
      {result.photoUnclear ? (
        <Alert tone="warning" title="The photo is hard to judge">
          It may be too dark, blurred or far away, or not a site photo. Try another.
        </Alert>
      ) : null}
      {result.signals.length === 0 ? (
        <EmptyState
          icon={IncidentsIcon}
          title="Nothing flagged"
          description="Nova saw no hazard it could point to in this photo. That is not a safety check."
        />
      ) : (
        <ul className="stack" aria-label="Signals from this photo">
          {result.signals.map((s) => (
            <li key={s.id}>
              <Card>
                <strong>{s.categoryLabel}</strong> <Badge>{CONFIDENCE_LABELS[s.confidence]}</Badge>
                <p>{s.observation}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {result.unsupportedNumbers.length ? (
        <Alert tone="info">
          Check these numbers against the photo: {result.unsupportedNumbers.join(', ')}.
        </Alert>
      ) : null}
      <p className="ac-muted">{result.disclaimer}</p>
    </div>
  );
}

function Badge({ children }: { children: string }) {
  return <StatusPill tone="neutral">{children}</StatusPill>;
}

function ReviewPanel() {
  const project = useCurrentProject();
  const [status, setStatus] = useState<SignalStatus>('open');
  const list = useHazardSignals(status);
  const m = useHazardMutations();
  const [deciding, setDeciding] = useState<{
    signal: HazardSignal;
    decision: 'confirmed' | 'dismissed';
  } | null>(null);
  const [note, setNote] = useState('');

  const columns: DataTableColumn<HazardSignal>[] = [
    {
      id: 'category',
      header: 'Hazard',
      rowHeader: true,
      sortValue: (s) => s.categoryLabel,
      cell: (s) => s.categoryLabel,
    },
    { id: 'observation', header: 'What the photo shows', cell: (s) => s.observation },
    {
      id: 'confidence',
      header: 'Confidence',
      cell: (s) => CONFIDENCE_LABELS[s.confidence],
    },
    {
      id: 'when',
      header: 'Flagged',
      sortValue: (s) => s.createdAt,
      cell: (s) => formatInstant(s.createdAt, project.timezone),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (s) => <StatusPill tone={STATUS_TONE[s.status]}>{STATUS_LABELS[s.status]}</StatusPill>,
    },
    {
      id: 'decide',
      header: 'Decision',
      cell: (s) =>
        s.status === 'open' ? (
          <span className="row">
            <Button
              variant="secondary"
              onClick={() => setDeciding({ signal: s, decision: 'confirmed' })}
            >
              Confirm
            </Button>
            <Button
              variant="secondary"
              onClick={() => setDeciding({ signal: s, decision: 'dismissed' })}
            >
              Dismiss
            </Button>
          </span>
        ) : (
          (s.reviewNote ?? '—')
        ),
    },
  ];

  const close = () => {
    setDeciding(null);
    setNote('');
  };

  return (
    <div className="stack">
      <div className="row" role="group" aria-label="Show signals">
        {(['open', 'confirmed', 'dismissed'] as const).map((s) => (
          <Button
            key={s}
            variant={status === s ? 'primary' : 'secondary'}
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
          >
            {STATUS_LABELS[s]}
          </Button>
        ))}
      </div>
      <ErrorAlert error={list.error ?? m.review.error} title="We couldn't load or save signals" />
      {list.isPending ? (
        <SkeletonRows label="Loading signals…" />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState
          icon={IncidentsIcon}
          title={status === 'open' ? 'Nothing to review' : 'No signals here'}
          description="Signals appear here when Nova flags a hazard in a scanned photo."
        />
      ) : (
        <DataTable
          caption="Hazard signals"
          columns={columns}
          rows={list.data ?? []}
          getRowId={(s) => s.id}
        />
      )}
      <Dialog
        open={!!deciding}
        onClose={close}
        title={deciding?.decision === 'confirmed' ? 'Confirm this hazard?' : 'Dismiss this signal?'}
        description={
          deciding
            ? deciding.decision === 'confirmed'
              ? 'Confirmed signals count towards the project’s patterns. This raises no incident; report one from Incidents if it needs it.'
              : 'Use this when the photo is misleading or it was already dealt with.'
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              disabled={m.review.isPending}
              onClick={() =>
                deciding &&
                m.review.mutate(
                  {
                    id: deciding.signal.id,
                    decision: deciding.decision,
                    ...(note.trim() ? { note: note.trim() } : {}),
                  },
                  { onSuccess: close },
                )
              }
            >
              {deciding?.decision === 'confirmed' ? 'Confirm hazard' : 'Dismiss signal'}
            </Button>
          </>
        }
      >
        {deciding ? <p>{deciding.signal.observation}</p> : null}
        <Textarea
          label="Note (optional)"
          value={note}
          maxLength={1000}
          rows={3}
          onChange={(e) => setNote(e.target.value)}
        />
      </Dialog>
    </div>
  );
}

function PatternsPanel() {
  const [days, setDays] = useState(30);
  const patterns = useHazardPatterns(days);
  const columns: DataTableColumn<HazardPattern>[] = [
    {
      id: 'label',
      header: 'Hazard',
      rowHeader: true,
      sortValue: (p) => p.label,
      cell: (p) => p.label,
    },
    {
      id: 'pattern',
      header: 'Pattern',
      cell: (p) => (p.isPattern ? <StatusPill tone="danger">Repeated</StatusPill> : <span>—</span>),
    },
    {
      id: 'confirmed',
      header: 'Confirmed',
      sortValue: (p) => p.confirmed,
      cell: (p) => p.confirmed,
    },
    { id: 'photos', header: 'Photos', sortValue: (p) => p.photos, cell: (p) => p.photos },
    { id: 'open', header: 'To review', sortValue: (p) => p.open, cell: (p) => p.open },
    {
      id: 'dismissed',
      header: 'Dismissed',
      sortValue: (p) => p.dismissed,
      cell: (p) => p.dismissed,
    },
    { id: 'trend', header: 'Trend', cell: (p) => TREND_LABELS[p.trend] },
  ];
  return (
    <div className="stack">
      <div className="row" role="group" aria-label="Time window">
        {[7, 30, 90].map((d) => (
          <Button
            key={d}
            variant={days === d ? 'primary' : 'secondary'}
            aria-pressed={days === d}
            onClick={() => setDays(d)}
          >
            {d} days
          </Button>
        ))}
      </div>
      <p className="ac-muted">
        A hazard shows as repeated when managers confirmed it at least three times across at least
        two photos.
      </p>
      <ErrorAlert error={patterns.error} title="We couldn't load patterns" />
      {patterns.isPending ? (
        <SkeletonRows label="Loading patterns…" />
      ) : (patterns.data ?? []).length === 0 ? (
        <EmptyState
          icon={IncidentsIcon}
          title="No patterns yet"
          description="Scan photos and confirm the hazards that are real. Repeats appear here."
        />
      ) : (
        <DataTable
          caption="Hazard patterns"
          columns={columns}
          rows={patterns.data ?? []}
          getRowId={(p) => p.category}
        />
      )}
    </div>
  );
}
