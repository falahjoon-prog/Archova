'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { addDays, type LocalDate } from '@archova/time';
import {
  ActivityTimeline,
  Alert,
  Button,
  Dialog,
  NovaFeedback,
  NovaSuggestion,
  PageHeader,
  SkeletonRows,
  StatusPill,
  TextField,
  Textarea,
  type StatusTone,
} from '@archova/ui';
import { ChevronLeft, ChevronRight, Lock, NovaIcon } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { formatInstant, formatLocalDate, todayIn } from '@/shared/lib/format';
import { mockId } from '@/shared/mocks/runtime';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { DiaryEditor } from '../components/DiaryEditor';
import { DiaryReadView } from '../components/DiaryReadView';
import { possibleDelay } from '../data/source';
import { useDiaryDay, useDiaryMutations, useDiaryRange } from '../hooks/useDiary';
import { dayStrip, diffContent, eotByDefault, labourTotals, submitProblems } from '../lib/entry';
import {
  DIARY_STATUS_LABELS,
  type DiaryContent,
  type DiaryEntry,
  type NovaDiarySummary,
} from '../lib/types';

const AUTOSAVE_MS = 1500;

const longDate = (d: LocalDate) =>
  new Intl.DateTimeFormat('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${d}T12:00:00Z`));

/** One day of the site diary (F1.7). Without a date it opens today in the project's time zone (DIA-AC1). */
export function DiaryDayScreen({ date }: { date?: string }) {
  const project = useCurrentProject();
  const today = todayIn(project.timezone);
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;
  usePublishAssistantScope({ projectId: project.projectId, record: { type: 'diary', id: day } });
  const entry = useDiaryDay(day, today);

  return (
    <div className="stack-lg">
      <DayHeader day={day} today={today} entry={entry.data} />
      {previewDataOnly ? <PreviewDataNotice tool="The site diary" /> : null}
      <div className="diary-layout">
        <DayStrip day={day} today={today} />
        <div className="stack-lg">
          {entry.isPending ? (
            <SkeletonRows label="Loading the diary…" />
          ) : entry.isError ? (
            <ErrorAlert error={entry.error} title="We couldn't open this day" />
          ) : (
            <DayBody key={`${day}:${entry.data.status}`} entry={entry.data} />
          )}
        </div>
      </div>
    </div>
  );
}

function statusChip(e: Pick<DiaryEntry, 'status'>): { tone: StatusTone; label: string } {
  return e.status === 'draft'
    ? { tone: 'info', label: DIARY_STATUS_LABELS.draft }
    : { tone: 'success', label: DIARY_STATUS_LABELS[e.status] };
}

function DayHeader({
  day,
  today,
  entry,
}: {
  day: LocalDate;
  today: LocalDate;
  entry: DiaryEntry | undefined;
}) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const router = useRouter();
  const href = (d: LocalDate) => webRoutes.diary(org.orgSlug, project.projectId, d);
  return (
    <PageHeader
      eyebrow="Site diary"
      title={longDate(day)}
      description={
        entry ? (
          <span className="row-actions">
            <StatusPill tone={statusChip(entry).tone}>{statusChip(entry).label}</StatusPill>
            {entry.status !== 'draft' ? (
              <span className="u-caption">
                <Lock size={14} aria-hidden="true" /> Locked
              </span>
            ) : null}
            {entry.late ? <StatusPill tone="warning">Late entry</StatusPill> : null}
            {entry.amendments.length ? (
              <a className="link" href="#diary-history">
                Amended ×{entry.amendments.length}
              </a>
            ) : null}
          </span>
        ) : undefined
      }
      actions={
        <div className="row-actions">
          <Link
            className="ac-button ac-button--secondary ac-button--sm"
            href={href(addDays(day, -1))}
          >
            <ChevronLeft size={16} aria-hidden="true" /> Previous day
          </Link>
          {day < today ? (
            <Link
              className="ac-button ac-button--secondary ac-button--sm"
              href={href(addDays(day, 1))}
            >
              Next day <ChevronRight size={16} aria-hidden="true" />
            </Link>
          ) : null}
          <TextField
            label="Go to day"
            type="date"
            max={today}
            value={day}
            onChange={(e) => e.target.value && router.push(href(e.target.value))}
          />
        </div>
      }
    />
  );
}

function DayStrip({ day, today }: { day: LocalDate; today: LocalDate }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const from = addDays(today, -13);
  const range = useDiaryRange(from, today);
  const days = dayStrip(range.data ?? [], from, today);
  return (
    <nav aria-label="Recent days" className="diary-strip">
      <ul className="plain-list">
        {days.map((d) => (
          <li key={d.date}>
            <Link
              className="diary-strip__day"
              aria-current={d.date === day ? 'page' : undefined}
              href={webRoutes.diary(org.orgSlug, project.projectId, d.date)}
            >
              <span>{d.date === today ? 'Today' : formatLocalDate(d.date)}</span>
              {d.status === 'missing' ? (
                <StatusPill tone={d.date === today ? 'info' : 'danger'}>
                  {d.date === today ? 'Not started' : 'Missed'}
                </StatusPill>
              ) : (
                <StatusPill tone={statusChip(d as { status: DiaryEntry['status'] }).tone}>
                  {DIARY_STATUS_LABELS[d.status]}
                  {d.late ? ' · late' : ''}
                </StatusPill>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function DayBody({ entry }: { entry: DiaryEntry }) {
  const project = useCurrentProject();
  const { companyName } = useProjectDirectory();
  const m = useDiaryMutations(entry.date);
  const [mode, setMode] = useState<'edit' | 'view' | 'amend'>(
    entry.status === 'draft' ? 'edit' : 'view',
  );
  const [content, setContent] = useState<DiaryContent>(entry.content);
  const [dirty, setDirty] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [amendOpen, setAmendOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [summary, setSummary] = useState<NovaDiarySummary | null>(null);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const [delayDismissed, setDelayDismissed] = useState(false);

  // Draft autosave (frontend 02 §5): to the server, after a pause in typing, so a phone draft finishes on a laptop.
  const saveDraft = m.saveDraft.mutate;
  const latest = useRef(content);
  latest.current = content;
  useEffect(() => {
    if (mode !== 'edit' || !dirty) return;
    const t = setTimeout(() => {
      saveDraft(latest.current);
      setDirty(false);
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [content, dirty, mode, saveDraft]);

  const change = (next: DiaryContent) => {
    setContent(next);
    setDirty(true);
  };

  const problems = submitProblems(content, companyName);
  const totals = labourTotals(content);
  const changes = mode === 'amend' ? diffContent(entry.content, content, companyName) : [];
  const delayFlag = delayDismissed ? null : possibleDelay(content, entry.weather, companyName);

  const nova =
    mode === 'view' ? null : (
      <>
        <div>
          <Button
            type="button"
            variant="nova"
            size="sm"
            disabled={m.summary.isPending || m.saveDraft.isPending}
            onClick={async () => {
              // Nova writes from the day as saved, so a draft still being typed is saved first.
              if (mode === 'edit' && dirty) {
                try {
                  await m.saveDraft.mutateAsync(content);
                } catch {
                  return;
                }
                setDirty(false);
              }
              m.summary.mutate(
                { content, weather: entry.weather },
                {
                  onSuccess: (s) => {
                    setSummary(s);
                    setFeedback(null);
                  },
                },
              );
            }}
          >
            <NovaIcon size={16} aria-hidden="true" />
            {m.summary.isPending ? 'Writing…' : "Write today's summary"}
          </Button>
        </div>
        <ErrorAlert error={m.summary.error} title="Nova couldn't write a summary" />
        <ErrorAlert error={m.saveDraft.error} title="We couldn't save the draft first" />
        {summary ? (
          <NovaSuggestion
            title="Today's summary"
            citations={summary.citations}
            actions={
              <>
                {summary.text ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      change({
                        ...content,
                        notes: content.notes ? `${content.notes}\n\n${summary.text}` : summary.text,
                      });
                      setSummary(null);
                    }}
                  >
                    Add to notes
                  </Button>
                ) : null}
                <Button type="button" size="sm" variant="tertiary" onClick={() => setSummary(null)}>
                  Discard
                </Button>
                <NovaFeedback value={feedback} onChange={setFeedback} />
              </>
            }
          >
            <p className="u-m-0">
              {summary.text ||
                'There isn’t enough recorded yet to summarise. Add labour, delays or notes first.'}
            </p>
            {summary.unmentionedDelays ? (
              <p className="u-caption u-m-0">
                {summary.unmentionedDelays === 1
                  ? '1 delay or stand-down isn’t in this summary.'
                  : `${summary.unmentionedDelays} delays or stand-downs aren’t in this summary.`}{' '}
                Check them under Delays.
              </p>
            ) : null}
          </NovaSuggestion>
        ) : null}
      </>
    );

  return (
    <>
      {mode !== 'view' && delayFlag ? (
        <NovaSuggestion
          title="Possible delay"
          actions={
            <>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  change({
                    ...content,
                    delays: [
                      ...content.delays,
                      {
                        id: mockId('dly'),
                        type: 'weather',
                        hours: null,
                        description: '',
                        affectedCompanyIds: content.standDown.companyIds,
                        isEotCandidate: eotByDefault('weather'),
                      },
                    ],
                  });
                }}
              >
                Add a weather delay
              </Button>
              <Button
                type="button"
                size="sm"
                variant="tertiary"
                onClick={() => setDelayDismissed(true)}
              >
                Not a delay
              </Button>
            </>
          }
        >
          <p className="u-m-0">
            {delayFlag} Recording it now keeps an extension of time claim open.
          </p>
        </NovaSuggestion>
      ) : null}

      {mode === 'amend' ? (
        <Alert tone="warning" title="Amending a submitted day">
          Your changes are saved as an amendment with a reason. The original stays in the record.
        </Alert>
      ) : null}

      {mode === 'view' ? (
        <DiaryReadView content={entry.content} weather={entry.weather} photos={entry.photosToday} />
      ) : (
        <DiaryEditor
          value={content}
          onChange={mode === 'edit' ? change : setContent}
          weather={entry.weather}
          photosToday={entry.photosToday}
          nova={nova}
        />
      )}

      <div className="row-actions diary-actions">
        {mode === 'edit' ? (
          <>
            <Button onClick={() => setConfirmSubmit(true)}>Submit day</Button>
            <span className="u-caption" role="status">
              {m.saveDraft.isPending
                ? 'Saving draft…'
                : dirty
                  ? 'Unsaved changes'
                  : m.saveDraft.isSuccess
                    ? 'Draft saved'
                    : ''}
            </span>
          </>
        ) : null}
        {mode === 'view' ? (
          <>
            <Button
              onClick={() => {
                setContent(entry.content);
                setMode('amend');
              }}
            >
              Amend
            </Button>
            {entry.status === 'submitted' ? (
              <Button
                variant="secondary"
                disabled={m.signOff.isPending}
                onClick={() => m.signOff.mutate()}
              >
                Sign off day
              </Button>
            ) : null}
          </>
        ) : null}
        {mode === 'amend' ? (
          <>
            <Button
              disabled={changes.length === 0}
              onClick={() => {
                setReason('');
                setReasonError(null);
                setAmendOpen(true);
              }}
            >
              Save amendment
            </Button>
            <Button variant="secondary" onClick={() => setMode('view')}>
              Cancel
            </Button>
          </>
        ) : null}
      </div>
      <ErrorAlert error={m.saveDraft.error ?? m.signOff.error} title="That didn't save" />

      {entry.status !== 'draft' ? <History entry={entry} timeZone={project.timezone} /> : null}

      <Dialog
        open={confirmSubmit}
        onClose={() => setConfirmSubmit(false)}
        title={`Submit ${formatLocalDate(entry.date)}`}
        description="Submitting locks the day. Any later change is an amendment with a reason."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmSubmit(false)}>
              Keep editing
            </Button>
            <Button
              disabled={problems.length > 0 || m.submit.isPending}
              onClick={() => m.submit.mutate(content, { onSuccess: () => setConfirmSubmit(false) })}
            >
              {m.submit.isPending ? 'Submitting…' : 'Submit and lock'}
            </Button>
          </>
        }
      >
        <p className="u-m-0">
          {totals.headcount} people, {totals.hours} hours, {content.delays.length}{' '}
          {content.delays.length === 1 ? 'delay' : 'delays'}, {content.photoIds.length}{' '}
          {content.photoIds.length === 1 ? 'photo' : 'photos'}.
        </p>
        {problems.length ? (
          <Alert tone="danger" title="Fix these first">
            <ul className="u-m-0">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <ErrorAlert error={m.submit.error} title="We couldn't submit this day" />
      </Dialog>

      <Dialog
        open={amendOpen}
        onClose={() => setAmendOpen(false)}
        title="Save amendment"
        description="Say why the record is changing. This is kept with the amendment."
        footer={
          <>
            <Button variant="secondary" onClick={() => setAmendOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={m.amend.isPending}
              onClick={() => {
                if (!reason.trim()) {
                  setReasonError('Give a reason for the amendment.');
                  return;
                }
                m.amend.mutate(
                  { content, reason },
                  {
                    onSuccess: () => {
                      setAmendOpen(false);
                      setMode('view');
                    },
                  },
                );
              }}
            >
              Save amendment
            </Button>
          </>
        }
      >
        <ul className="plain-list" aria-label="Changes">
          {changes.map((c, i) => (
            <li key={i}>
              {c.field}: <s>{c.before}</s> → {c.after}
            </li>
          ))}
        </ul>
        <Textarea
          label="Reason"
          rows={3}
          value={reason}
          error={reasonError ?? undefined}
          onChange={(e) => setReason(e.target.value)}
        />
        <ErrorAlert error={m.amend.error} title="We couldn't save the amendment" />
      </Dialog>
    </>
  );
}

/** Submission, amendments (who, what, why, when) and sign-off, newest last (DIA-AC7, DIA-AC8). */
function History({ entry, timeZone }: { entry: DiaryEntry; timeZone: string }) {
  const { companyName } = useProjectDirectory();
  // API amendments carry company ids; name them from the directory.
  const named = (v: string) => v.replace(/\bcmp_[0-9A-Za-z]+/g, (id) => companyName(id));
  const entries = [
    ...(entry.submittedAt
      ? [
          {
            id: 'submitted',
            actor: entry.submittedBy ?? 'Someone',
            action: entry.late ? 'submitted the day late' : 'submitted the day',
            at: formatInstant(entry.submittedAt, timeZone),
            atIso: entry.submittedAt,
          },
        ]
      : []),
    ...entry.amendments.map((a) => ({
      id: a.id,
      actor: a.by,
      action: 'amended the day',
      detail: (
        <>
          <p className="u-m-0">Reason: {a.reason}</p>
          <ul className="u-m-0">
            {a.changes.map((c, i) => (
              <li key={i}>
                {c.field}: {named(c.before)} → {named(c.after)}
              </li>
            ))}
          </ul>
        </>
      ),
      at: formatInstant(a.at, timeZone),
      atIso: a.at,
    })),
    ...(entry.signedOffAt
      ? [
          {
            id: 'signed',
            actor: entry.signedOffBy ?? 'Someone',
            action: 'signed off the day',
            at: formatInstant(entry.signedOffAt, timeZone),
            atIso: entry.signedOffAt,
          },
        ]
      : []),
  ].sort((a, b) => a.atIso.localeCompare(b.atIso));
  return (
    <section id="diary-history" aria-labelledby="diary-history-h" className="stack">
      <h2 id="diary-history-h" className="panel-heading">
        History
      </h2>
      <ActivityTimeline entries={entries} label="Diary history" />
    </section>
  );
}
