'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import {
  ActivityTimeline,
  Alert,
  Button,
  Card,
  DescriptionList,
  Dialog,
  ItemHeader,
  PageHeader,
  SkeletonRows,
  StatusPill,
  Tabs,
  Textarea,
} from '@archova/ui';
import { BookmarkButton } from '@/features/bookmarks';
import { webRoutes } from '@archova/routes';
import { OnProgramme } from '@/features/schedule';
import { useAskNova, usePublishAssistantScope } from '@/features/assistant';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { formatInstant, formatLocalDate, todayIn } from '@/shared/lib/format';
import { useSheetPicker } from '@/features/drawings';
import { RelatedMeetings } from '@/features/meetings';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useActor } from '@/shared/providers/useActor';
import { RespondForm } from '../components/RespondForm';
import { RfiPhotos } from '../components/RfiPhotos';
import { ImpactChip, RfiDue, RfiStatusPill, ballInCourtLabel } from '../components/RfiChips';
import { RfiForm } from '../forms/RfiForm';
import { useRfi, useRfiMutations } from '../hooks/useRfis';
import { canTransition, primaryAction } from '../lib/lifecycle';
import { formatRfiNumber, type Rfi, type RfiInput } from '../lib/types';

type ReasonAction = 'reopen' | 'void';

/** One RFI (F1.4): item header with ball in court, Details / Responses / Activity, close, reopen and void. */
export function RfiDetailScreen({ rfiId }: { rfiId: string }) {
  const project = useCurrentProject();
  const rfi = useRfi(project.projectId, rfiId);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: {
      type: 'rfi',
      id: rfiId,
      ...(rfi.data ? { label: formatRfiNumber(rfi.data.number) } : {}),
    },
  });

  if (rfi.isPending) return <SkeletonRows label="Loading RFI…" />;
  if (rfi.isError) return <ErrorAlert error={rfi.error} title="We couldn't open this RFI" />;
  return rfi.data.status === 'draft' ? <DraftView rfi={rfi.data} /> : <RfiView rfi={rfi.data} />;
}

function toInput(r: Rfi): RfiInput {
  return {
    subject: r.subject,
    question: r.question,
    assigneeId: r.assigneeId,
    dueDate: r.dueDate,
    distributionCompanyIds: r.distributionCompanyIds,
    costImpact: r.costImpact,
    scheduleImpactDays: r.scheduleImpactDays,
    drawing: r.drawing,
    specSection: r.specSection,
    location: r.location,
    isPrivate: r.isPrivate,
  };
}

function DraftView({ rfi }: { rfi: Rfi }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const m = useRfiMutations(project.projectId);
  const busy = m.update.isPending || m.submit.isPending;
  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow={
          <Link className="link" href={webRoutes.rfis(org.orgSlug, project.projectId)}>
            RFIs
          </Link>
        }
        title={`Draft: ${rfi.subject}`}
        description="Drafts have no number until you submit (RFI-001 onwards, never reused)."
      />
      {previewDataOnly ? <PreviewDataNotice tool="RFIs" /> : null}
      <RfiForm
        key={rfi.id}
        initial={toInput(rfi)}
        busy={busy}
        error={m.update.error ?? m.submit.error}
        onSaveDraft={(input) => m.update.mutate({ id: rfi.id, input })}
        onSubmit={(input) =>
          m.update.mutate({ id: rfi.id, input }, { onSuccess: () => m.submit.mutate(rfi.id) })
        }
      />
      <RfiPhotos rfi={rfi} />
    </div>
  );
}

function RfiView({ rfi }: { rfi: Rfi }) {
  const dir = useProjectDirectory();
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const actor = useActor();
  const m = useRfiMutations(project.projectId);
  const today = todayIn(project.timezone);
  const [params, setParams] = useUrlState(['tab'] as const);
  const tab = [
    'details',
    'responses',
    'activity',
    ...(previewDataOnly ? [] : ['related']),
  ].includes(params.tab)
    ? params.tab
    : 'details';
  const respondRef = useRef<HTMLTextAreaElement>(null);
  const [closing, setClosing] = useState(false);
  const [official, setOfficial] = useState<string>('');
  const [reasonFor, setReasonFor] = useState<ReasonAction | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);

  const askNova = useAskNova();
  const primary = primaryAction(rfi.status);
  const bic = ballInCourtLabel(rfi, actor, dir);

  const startRespond = () => {
    setParams({ tab: 'responses' });
    // The panel renders on the next commit; focus once it's there.
    requestAnimationFrame(() => respondRef.current?.focus());
  };

  const openClose = () => {
    setOfficial(rfi.responses.at(-1)?.id ?? '');
    setClosing(true);
  };

  const openReason = (a: ReasonAction) => {
    setReason('');
    setReasonError(null);
    setReasonFor(a);
  };

  const confirmReason = () => {
    if (!reason.trim()) {
      setReasonError(
        reasonFor === 'void' ? 'Give a reason for voiding.' : 'Give a reason for reopening.',
      );
      return;
    }
    const mutation = reasonFor === 'void' ? m.void : m.reopen;
    mutation.mutate({ id: rfi.id, reason }, { onSuccess: () => setReasonFor(null) });
  };

  const primaryButton =
    primary === 'respond' ? (
      <Button onClick={startRespond}>Respond</Button>
    ) : primary === 'close' ? (
      <Button onClick={openClose}>Close RFI</Button>
    ) : primary === 'reopen' ? (
      <Button onClick={() => openReason('reopen')}>Reopen</Button>
    ) : null;

  return (
    <div className="stack-lg">
      <p className="u-m-0">
        <Link className="link" href={webRoutes.rfis(org.orgSlug, project.projectId)}>
          RFIs
        </Link>
      </p>
      <ItemHeader
        number={<span className="u-mono">{formatRfiNumber(rfi.number)}</span>}
        title={rfi.subject}
        status={<RfiStatusPill status={rfi.status} />}
        ballInCourt={bic}
        due={<RfiDue rfi={rfi} today={today} />}
        meta={
          <>
            <ImpactChip rfi={rfi} />
            {rfi.isPrivate ? <StatusPill tone="neutral">Private to builder</StatusPill> : null}
          </>
        }
        actions={
          <>
            {primaryButton}
            <BookmarkButton
              entityType="rfi"
              entityId={rfi.id}
              projectId={project.projectId}
              title={`${formatRfiNumber(rfi.number)} ${rfi.subject}`}
              subtitle={rfi.status}
            />
            {primary === 'close' ? (
              <Button variant="secondary" onClick={startRespond}>
                Add response
              </Button>
            ) : null}
            {canTransition(rfi.status, 'void') ? (
              <Button variant="tertiary" onClick={() => openReason('void')}>
                Void
              </Button>
            ) : null}
            <Button variant="tertiary" onClick={askNova}>
              Ask Nova about this
            </Button>
          </>
        }
      />
      {previewDataOnly ? <PreviewDataNotice tool="RFIs" /> : null}
      {rfi.status === 'answered' && rfi.costImpact === 'yes' ? (
        <Alert tone="warning" title="Potential variation">
          This RFI is flagged with a cost impact, so it&apos;s on the potential variations list.
          Check your contract&apos;s notice period for variations and delay claims.
        </Alert>
      ) : null}
      {rfi.status === 'void' ? (
        <Alert tone="info" title="This RFI is void">
          It stays in the register so the number is never reused.
        </Alert>
      ) : null}
      <Tabs
        label="RFI sections"
        value={tab}
        onValueChange={(id) => setParams({ tab: id === 'details' ? null : id })}
        tabs={[
          { id: 'details', label: 'Details' },
          { id: 'responses', label: 'Responses', count: rfi.responses.length },
          { id: 'activity', label: 'Activity' },
          ...(previewDataOnly ? [] : [{ id: 'related', label: 'Related' }]),
        ]}
      >
        {tab === 'details' ? <Details rfi={rfi} /> : null}
        {tab === 'responses' ? (
          <div className="stack">
            <Responses rfi={rfi} />
            {canTransition(rfi.status, 'respond') ? (
              <RespondForm ref={respondRef} rfiId={rfi.id} />
            ) : null}
          </div>
        ) : null}
        {tab === 'related' ? <RelatedMeetings type="rfi" id={rfi.id} /> : null}
        {tab === 'activity' ? (
          <ActivityTimeline
            entries={rfi.activity.map((a) => ({
              id: a.id,
              actor: a.actor,
              action: a.action,
              ...(a.before !== undefined && a.after !== undefined
                ? { change: { before: a.before, after: a.after } }
                : {}),
              detail: a.detail,
              at: formatInstant(a.at, project.timezone),
              atIso: a.at,
            }))}
          />
        ) : null}
      </Tabs>

      <Dialog
        open={closing}
        onClose={() => setClosing(false)}
        title={`Close ${formatRfiNumber(rfi.number)}`}
        description="Choose the response that governs. To change it later you'll need to reopen the RFI."
        footer={
          <>
            <Button variant="secondary" onClick={() => setClosing(false)}>
              Cancel
            </Button>
            <Button
              disabled={!official || m.close.isPending}
              onClick={() =>
                m.close.mutate(
                  { id: rfi.id, officialResponseId: official },
                  { onSuccess: () => setClosing(false) },
                )
              }
            >
              {m.close.isPending ? 'Closing…' : 'Close with official response'}
            </Button>
          </>
        }
      >
        <fieldset className="fieldset">
          <legend>Official response</legend>
          <div className="stack">
            {rfi.responses.map((r) => (
              <label key={r.id} className="choice-card">
                <input
                  type="radio"
                  name="official"
                  value={r.id}
                  checked={official === r.id}
                  onChange={() => setOfficial(r.id)}
                />
                <span>
                  <strong>{r.authorName}</strong>{' '}
                  <span className="u-caption">{formatInstant(r.createdAt, project.timezone)}</span>
                  <br />
                  {r.body}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <ErrorAlert error={m.close.error} title="We couldn't close this RFI" />
      </Dialog>

      <Dialog
        open={reasonFor !== null}
        onClose={() => setReasonFor(null)}
        title={
          reasonFor === 'void'
            ? `Void ${formatRfiNumber(rfi.number)}`
            : `Reopen ${formatRfiNumber(rfi.number)}`
        }
        description={
          reasonFor === 'void'
            ? 'A void RFI stays visible with your reason, and its number is not reused.'
            : 'The official response is cleared and the ball goes back to the assignee.'
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setReasonFor(null)}>
              Cancel
            </Button>
            <Button
              variant={reasonFor === 'void' ? 'danger' : 'primary'}
              disabled={m.void.isPending || m.reopen.isPending}
              onClick={confirmReason}
            >
              {reasonFor === 'void' ? 'Void RFI' : 'Reopen RFI'}
            </Button>
          </>
        }
      >
        <Textarea
          label="Reason"
          rows={3}
          value={reason}
          error={reasonError ?? undefined}
          onChange={(e) => setReason(e.target.value)}
        />
        <ErrorAlert error={m.void.error ?? m.reopen.error} title="That didn't work" />
      </Dialog>
    </div>
  );
}

function Details({ rfi }: { rfi: Rfi }) {
  const [{ photo }] = useUrlState(['photo'] as const);
  // A photo open for marking takes the whole tab, so the canvas isn't pushed below the fold.
  if (photo) return <RfiPhotos rfi={rfi} />;
  return <DetailsBody rfi={rfi} />;
}

function DetailsBody({ rfi }: { rfi: Rfi }) {
  const dir = useProjectDirectory();
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const sheets = useSheetPicker(project.projectId);
  // API records carry the pinned revision only; the register names its sheet when it's the current revision.
  const pinned = rfi.drawing;
  const match =
    pinned && !pinned.sheetId
      ? sheets.options.find((o) => o.revisionId === pinned.revisionId)
      : null;
  const drawing = pinned?.sheetId
    ? pinned
    : match
      ? { sheetId: match.sheetId, revisionId: match.revisionId, label: match.label }
      : null;
  return (
    <div className="detail-grid">
      <div className="stack-lg">
        <Card title="Question">
          <p className="body-lg u-m-0 u-prewrap">{rfi.question}</p>
        </Card>
        <RfiPhotos rfi={rfi} />
        <OnProgramme kind="rfi" itemId={rfi.id} />
      </div>
      <Card title="Details">
        <DescriptionList
          items={[
            {
              label: 'Assignee',
              value: rfi.assigneeId
                ? `${dir.personName(rfi.assigneeId)} · ${dir.companyName(rfi.assigneeCompanyId)}`
                : '—',
            },
            {
              label: 'Drawing',
              value: drawing ? (
                <Link
                  className="link"
                  href={webRoutes.drawing(
                    org.orgSlug,
                    project.projectId,
                    drawing.sheetId,
                    drawing.revisionId,
                  )}
                >
                  {drawing.label}
                </Link>
              ) : rfi.drawing ? (
                'Pinned on an earlier revision'
              ) : (
                '—'
              ),
            },
            { label: 'Spec section', value: rfi.specSection ?? '—' },
            { label: 'Location', value: rfi.location ?? '—' },
            {
              label: 'Cost impact',
              value:
                rfi.costImpact === 'yes'
                  ? 'Yes'
                  : rfi.costImpact === 'no'
                    ? 'No'
                    : 'To be confirmed',
            },
            {
              label: 'Delay',
              value: rfi.scheduleImpactDays ? `${rfi.scheduleImpactDays} days` : '—',
            },
            {
              label: 'Distribution',
              value: rfi.distributionCompanyIds.length
                ? rfi.distributionCompanyIds.map(dir.companyName).join(', ')
                : '—',
            },
            { label: 'Raised', value: formatInstant(rfi.createdAt, project.timezone) },
            ...(rfi.dueDate ? [{ label: 'Due date', value: formatLocalDate(rfi.dueDate) }] : []),
          ]}
        />
      </Card>
    </div>
  );
}

function Responses({ rfi }: { rfi: Rfi }) {
  const dir = useProjectDirectory();
  const project = useCurrentProject();
  if (rfi.responses.length === 0) return <p className="u-muted u-m-0">No responses yet.</p>;
  return (
    <ol className="plain-list" aria-label="Responses">
      {rfi.responses.map((r) => (
        <li key={r.id} className={r.isOfficial ? 'response response--official' : 'response'}>
          <div className="row-actions">
            <strong>{r.authorName}</strong>
            <span className="u-caption">
              {dir.companyName(r.authorCompanyId)} · {formatInstant(r.createdAt, project.timezone)}
            </span>
            {r.isOfficial ? <StatusPill tone="success">Official response</StatusPill> : null}
            {r.aiSuggestionId ? <StatusPill tone="ai">Started from a Nova draft</StatusPill> : null}
          </div>
          <p className="u-m-0 u-prewrap">{r.body}</p>
        </li>
      ))}
    </ol>
  );
}
