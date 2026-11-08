'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CAPTURE_PROVIDER_LABEL } from '@archova/domain';
import { webRoutes } from '@archova/routes';
import {
  Alert,
  Button,
  Card,
  Dialog,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
  Textarea,
  buttonClassName,
} from '@archova/ui';
import { CoordinationIcon } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate, todayIn } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import {
  STILL_MAX_BYTES,
  STILL_TYPES,
  type CaptureObservation,
  type RaisedIssue,
  type SiteCapture,
} from '../data/api';
import {
  useCaptureObservations,
  useRfiOptions,
  useSiteCaptureMutations,
  useSiteCaptures,
} from '../hooks/useSiteCaptures';

const CONFIDENCE: Record<CaptureObservation['confidence'], string> = {
  low: 'Low confidence',
  medium: 'Medium confidence',
  high: 'High confidence',
};

/**
 * 360 site captures: tours from Matterport, Kuula or Ricoh Tours embedded by their share link, each dated and linkable
 * to an RFI and a coordination issue. "Ask Nova about this view" reads a still the person uploads from the tour (never
 * the live embed) and keeps what it noticed as observations for a person to confirm or dismiss.
 */
export function SiteCaptureScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const captures = useSiteCaptures();
  const m = useSiteCaptureMutations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const list = captures.data ?? [];
  const selected = list.find((c) => c.id === selectedId) ?? list[0] ?? null;

  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'site_capture', id: selected?.id ?? 'register' },
  });

  const back = webRoutes.coordination(org.orgSlug, project.projectId);

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="Coordination"
        title="Site capture"
        description="Embed 360 tours of the site by pasting their share link. Date each capture, link it to an RFI or issue, and ask Nova about a view."
        actions={
          <>
            <Link className={buttonClassName('secondary')} href={back}>
              Back to issues
            </Link>
            <Button onClick={() => setAdding(true)}>Add a capture</Button>
          </>
        }
      />
      <ErrorAlert error={captures.error} title="We couldn't load the captures" />
      {captures.isPending ? (
        <SkeletonRows label="Loading captures…" />
      ) : list.length === 0 ? (
        <EmptyState
          icon={CoordinationIcon}
          title="No captures yet"
          description="Share a tour from Matterport, Kuula or Ricoh Tours, copy its link and add it here. Archova keeps the link, not the images, so the tour stays in your account there."
          action={<Button onClick={() => setAdding(true)}>Add a capture</Button>}
        />
      ) : (
        <div className="bim-layout">
          {selected ? <CapturePanel capture={selected} /> : null}
          <aside className="stack" aria-label="Captures">
            <h2 className="u-m-0">Captures</h2>
            <ul className="stack capture-list">
              {list.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="bim-clash"
                    aria-pressed={selected?.id === c.id}
                    onClick={() => setSelectedId(c.id)}
                  >
                    <strong>{c.title}</strong>
                    <span>
                      {formatLocalDate(c.capturedOn)} · {CAPTURE_PROVIDER_LABEL[c.provider]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      )}
      <NovaView selected={selected} />
      <AddCapture open={adding} onClose={() => setAdding(false)} />
      {m.remove.error ? <ErrorAlert error={m.remove.error} title="We couldn't remove it" /> : null}
    </div>
  );
}

function CapturePanel({ capture }: { capture: SiteCapture }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const m = useSiteCaptureMutations();
  const rfis = useRfiOptions(true);
  const [confirmRemove, setConfirmRemove] = useState(false);
  return (
    <section aria-labelledby="capture-title" className="stack">
      <div className="stack--flush">
        <h2 id="capture-title" className="u-m-0">
          {capture.title}
        </h2>
        <p className="ac-muted u-m-0">
          {formatLocalDate(capture.capturedOn)}
          {capture.area ? ` · ${capture.area}` : ''} · {CAPTURE_PROVIDER_LABEL[capture.provider]}
        </p>
        {capture.note ? <p className="u-m-0">{capture.note}</p> : null}
      </div>
      <div className="capture-frame">
        <iframe
          key={capture.id}
          src={capture.url}
          title={`360 tour: ${capture.title}`}
          sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
          allow="fullscreen; xr-spatial-tracking; accelerometer; gyroscope"
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      </div>
      <p className="ac-muted u-m-0">
        If the tour does not load, it may not allow embedding.{' '}
        <a className="link" href={capture.url} target="_blank" rel="noopener noreferrer">
          Open it in {CAPTURE_PROVIDER_LABEL[capture.provider]}
        </a>
        .
      </p>
      <div className="u-row">
        <Select
          label="Linked RFI"
          value={capture.rfiId ?? ''}
          placeholder="None"
          options={(rfis.data ?? []).map((r) => ({ value: r.id, label: r.label }))}
          onChange={(e) =>
            m.link.mutate({
              id: capture.id,
              version: capture.version,
              rfiId: e.target.value || null,
            })
          }
        />
        {capture.issueId ? (
          <Link
            className={buttonClassName('secondary')}
            href={`${webRoutes.coordination(org.orgSlug, project.projectId)}?issue=${capture.issueId}`}
          >
            Open linked issue
          </Link>
        ) : null}
        <Button variant="secondary" onClick={() => setConfirmRemove(true)}>
          Remove capture
        </Button>
      </div>
      <ErrorAlert error={m.link.error} title="We couldn't save the link" />
      <Dialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title="Remove this capture?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmRemove(false)}>
              Keep it
            </Button>
            <Button
              disabled={m.remove.isPending}
              onClick={() =>
                m.remove.mutate(capture.id, { onSettled: () => setConfirmRemove(false) })
              }
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="u-m-0">
          Only the link is removed here. The tour stays in your{' '}
          {CAPTURE_PROVIDER_LABEL[capture.provider]} account.
        </p>
      </Dialog>
    </section>
  );
}

function NovaView({ selected }: { selected: SiteCapture | null }) {
  const m = useSiteCaptureMutations();
  const open = useCaptureObservations();
  const [still, setStill] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [raised, setRaised] = useState<RaisedIssue | null>(null);
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const result = m.scan.data;

  // A new capture means a new view: start the note from where it is.
  useEffect(() => {
    setNote(selected?.area ? `${selected.title}, ${selected.area}` : (selected?.title ?? ''));
  }, [selected?.id, selected?.title, selected?.area]);

  const choose = (file: File | null) => {
    setStill(file);
    if (file && !STILL_TYPES.includes(file.type)) setProblem('Use a PNG, JPEG or WebP image.');
    else if (file && file.size > STILL_MAX_BYTES) setProblem('Use an image under 3 MB.');
    else setProblem(null);
  };

  const decide = (o: CaptureObservation, decision: 'confirmed' | 'dismissed', raise: boolean) =>
    m.decide.mutate(
      { id: o.id, decision },
      {
        onSuccess: () => {
          if (!raise) return;
          m.raise.mutate(
            {
              title: `${o.categoryLabel}${selected ? ` (${selected.title})` : ''}`.slice(0, 200),
              description: `${o.observation}\n\nNova noticed this in a still from a 360 capture and a person confirmed it.`,
              location: selected?.area ?? '',
            },
            {
              onSuccess: (issue) => {
                setRaised(issue);
                if (selected && !selected.issueId)
                  m.link.mutate({
                    id: selected.id,
                    version: selected.version,
                    rfiId: selected.rfiId,
                    issueId: issue.id,
                  });
              },
            },
          );
        },
      },
    );

  return (
    <section aria-labelledby="nova-view-title" className="stack">
      <h2 id="nova-view-title" className="u-m-0">
        Ask Nova about this view
      </h2>
      <Alert tone="info" title="Nova reads a still, not the live tour">
        Take a screenshot of the view in the tour and upload it here. Nova looks at that image for
        things like a visible defect, missing fire-stopping or incomplete work. It cannot see the
        rest of the tour, and a 360 view can look stretched near its edges.
      </Alert>
      <Card>
        <div className="stack">
          <div className="stack">
            <label className="ac-field__label" htmlFor="capture-still">
              Screenshot of the view
            </label>
            <input
              id="capture-still"
              className="file-input"
              type="file"
              accept={STILL_TYPES.join(',')}
              onChange={(e) => choose(e.target.files?.[0] ?? null)}
            />
            {problem ? <Alert tone="warning">{problem}</Alert> : null}
          </div>
          <Textarea
            label="Where is this and what are you checking? (optional)"
            value={note}
            maxLength={1000}
            rows={3}
            onChange={(e) => setNote(e.target.value)}
          />
          <div>
            <Button
              disabled={!still || !!problem || m.scan.isPending}
              onClick={() => still && m.scan.mutate({ still, note })}
            >
              {m.scan.isPending ? 'Nova is looking…' : 'Ask Nova'}
            </Button>
          </div>
        </div>
      </Card>
      <ErrorAlert error={m.scan.error} title="Nova couldn't read this view" />
      {result ? (
        <div className="stack" aria-live="polite">
          {result.stillUnclear ? (
            <Alert tone="warning" title="The view is hard to judge">
              It may be too dark, blurred, stretched or far away. Try a closer view.
            </Alert>
          ) : null}
          {result.observations.length === 0 && !result.stillUnclear ? (
            <p className="u-m-0">
              Nova did not point to anything in this view. That is not an inspection.
            </p>
          ) : null}
          {result.unsupportedNumbers.length ? (
            <Alert tone="info">
              Check these numbers against the view: {result.unsupportedNumbers.join(', ')}.
            </Alert>
          ) : null}
          <p className="ac-muted u-m-0">{result.disclaimer}</p>
        </div>
      ) : null}
      <ErrorAlert error={m.decide.error ?? m.raise.error} title="We couldn't save that" />
      {raised ? (
        <p className="u-m-0" role="status">
          Issue {raised.number} raised.{' '}
          <Link
            className="link"
            href={`${webRoutes.coordination(org.orgSlug, project.projectId)}?issue=${raised.id}`}
          >
            Open it
          </Link>
        </p>
      ) : null}
      <h3 className="u-m-0">Waiting for you</h3>
      {open.isPending ? (
        <SkeletonRows rows={2} label="Loading what Nova noticed…" />
      ) : (open.data ?? []).length === 0 ? (
        <p className="ac-muted u-m-0">
          Nothing is waiting. What Nova notices in a view appears here.
        </p>
      ) : (
        <ul className="stack capture-list" aria-label="What Nova noticed">
          {(open.data ?? []).map((o) => (
            <li key={o.id}>
              <Card>
                <div className="stack">
                  <div>
                    <strong>{o.categoryLabel}</strong>{' '}
                    <StatusPill tone="neutral">{CONFIDENCE[o.confidence]}</StatusPill>
                  </div>
                  <p className="u-m-0">{o.observation}</p>
                  <div className="u-row">
                    <Button
                      size="sm"
                      disabled={m.decide.isPending}
                      onClick={() => decide(o, 'confirmed', true)}
                    >
                      Confirm and raise an issue
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={m.decide.isPending}
                      onClick={() => decide(o, 'confirmed', false)}
                    >
                      Confirm
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={m.decide.isPending}
                      onClick={() => decide(o, 'dismissed', false)}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AddCapture({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useCurrentProject();
  const m = useSiteCaptureMutations();
  const rfis = useRfiOptions(open);
  const today = todayIn(project.timezone);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [capturedOn, setCapturedOn] = useState<string>(today);
  const [area, setArea] = useState('');
  const [note, setNote] = useState('');
  const [rfiId, setRfiId] = useState('');

  useEffect(() => {
    if (!open) return;
    m.add.reset();
    setTitle('');
    setUrl('');
    setCapturedOn(today);
    setArea('');
    setNote('');
    setRfiId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a 360 capture"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || !url.trim() || !capturedOn || m.add.isPending}
            onClick={() =>
              m.add.mutate(
                {
                  title: title.trim(),
                  url: url.trim(),
                  capturedOn,
                  ...(area.trim() ? { area: area.trim() } : {}),
                  ...(note.trim() ? { note: note.trim() } : {}),
                  ...(rfiId ? { rfiId } : {}),
                },
                { onSuccess: onClose },
              )
            }
          >
            {m.add.isPending ? 'Adding…' : 'Add capture'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField
          label="Title"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
        />
        <TextField
          label="Share link"
          type="url"
          value={url}
          hint="A link from Matterport, Kuula or Ricoh Tours, starting with https://"
          onChange={(e) => setUrl(e.target.value)}
        />
        <TextField
          label="Captured on"
          type="date"
          max={today}
          value={capturedOn}
          onChange={(e) => setCapturedOn(e.target.value)}
        />
        <TextField
          label="Where on site"
          value={area}
          maxLength={200}
          onChange={(e) => setArea(e.target.value)}
        />
        <Textarea
          label="Note"
          value={note}
          maxLength={2000}
          onChange={(e) => setNote(e.target.value)}
        />
        <Select
          label="Linked RFI"
          value={rfiId}
          placeholder="None"
          options={(rfis.data ?? []).map((r) => ({ value: r.id, label: r.label }))}
          onChange={(e) => setRfiId(e.target.value)}
        />
        <ErrorAlert error={m.add.error} title="We couldn't add the capture" />
      </div>
    </Dialog>
  );
}
