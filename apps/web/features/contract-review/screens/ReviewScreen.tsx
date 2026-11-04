'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Alert,
  Card,
  DescriptionList,
  PageHeader,
  SkeletonRows,
  StatusPill,
  Tabs,
} from '@archova/ui';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { toErrorView } from '@/shared/lib/errors';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { DisclaimerBanner } from '../components/DisclaimerBanner';
import { FlagCard } from '../components/FlagCard';
import { SourceQuote } from '../components/SourceQuote';
import type { ContractReview } from '../data/api';
import { useContractReview, useContractReviewMutations } from '../hooks/useContractReview';
import { useCanReviewContracts } from '../lib/access';
import {
  CONTRACT_TYPE_LABEL,
  DAY_TYPE_LABEL,
  SUMMARY_LABEL,
  TIME_BAR_LABEL,
  currentDecisions,
} from '../lib/labels';

/** CR2: one review, with the disclaimer on top and tabs for the summary, the flags and the time bars. */
export function ReviewScreen({ reviewId }: { reviewId: string }) {
  const project = useCurrentProject();
  const allowed = useCanReviewContracts();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'contract-review', id: reviewId },
  });
  const q = useContractReview(project.projectId, reviewId);
  if (q.isPending) return <SkeletonRows label="Loading the review…" />;
  if (q.isError) return <ErrorAlert error={q.error} title="We couldn't open this review" />;
  return <Review r={q.data} canDecide={allowed} />;
}

type Filter = 'all' | 'undecided' | 'decided' | 'referred';

function Review({ r, canDecide }: { r: ContractReview; canDecide: boolean }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const { decide } = useContractReviewMutations(project.projectId);
  const [tab, setTab] = useState('flags');
  const [filter, setFilter] = useState<Filter>('all');
  const [failed, setFailed] = useState<{ index: number; message: string } | null>(null);

  const current = currentDecisions(r);
  const decidedN = current.size;
  const rows = r.flags
    .map((flag, index) => ({ flag, index }))
    .filter(({ index }) => {
      const d = current.get(index);
      if (filter === 'undecided') return !d;
      if (filter === 'decided') return !!d;
      if (filter === 'referred') return d?.decision === 'refer_to_lawyer';
      return true;
    })
    // Undecided first, then by severity (the API already lists highest first).
    .sort(
      (a, b) => Number(current.has(a.index)) - Number(current.has(b.index)) || a.index - b.index,
    );

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="Nova contract review"
        title={r.fileName}
        description={`${CONTRACT_TYPE_LABEL[r.contractType]} · ${r.ourSide === 'we_pay' ? 'We pay' : 'We get paid'} · reviewed ${formatInstant(r.createdAt, project.timezone)}`}
        actions={
          <>
            <StatusPill tone="neutral">Commercial team only</StatusPill>
            <Link className="link" href={webRoutes.contractReviews(org.orgSlug, project.projectId)}>
              All reviews
            </Link>
          </>
        }
      />
      <DisclaimerBanner text={r.disclaimer} />
      {r.playbookMissing ? (
        <Alert tone="warning" title="No playbook for this contract type">
          Nova summarised the contract but looked for no departures, because your company has no
          playbook for it yet.
        </Alert>
      ) : null}
      {r.unreadPages.length ? (
        <Alert tone="warning" title="Some pages were not read">
          Pages {r.unreadPages.join(', ')} have no text Nova can read, so it may have missed clauses
          on them.
        </Alert>
      ) : null}
      {r.truncated ? (
        <Alert tone="warning" title="Part of the contract was left out">
          The contract is longer than Nova reads in one go, so some pages were cut.
        </Alert>
      ) : null}
      {r.multiState ? (
        <Alert tone="info" title="Check manually: covers more than one state">
          This contract covers work in more than one state, so any statutory checks are for a
          person.
        </Alert>
      ) : null}

      <p className="u-m-0" role="status" aria-live="polite">
        {decidedN} of {r.flags.length} flags decided
      </p>

      <Tabs
        label="Review"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { id: 'summary', label: 'Summary' },
          { id: 'flags', label: 'Flags', count: r.flags.length },
          { id: 'timebars', label: 'Time bars', count: r.timeBars.length },
        ]}
      >
        {tab === 'summary' ? <SummaryTab r={r} /> : null}
        {tab === 'timebars' ? <TimeBarsTab r={r} /> : null}
        {tab === 'flags' ? (
          <div className="stack">
            <div role="group" aria-label="Show flags" className="row-actions">
              {(
                [
                  ['all', 'All'],
                  ['undecided', 'Undecided'],
                  ['decided', 'Decided'],
                  ['referred', 'Referred to lawyer'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="cr-filter ac-focusable"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {!r.flags.length ? (
              <p className="u-m-0">
                {r.playbookMissing
                  ? 'No departures were looked for.'
                  : 'Nova found no departures from your playbook. It only checks the issues on its list.'}
              </p>
            ) : null}
            {r.flags.length && !rows.length ? (
              <p className="u-m-0">No flags match this filter.</p>
            ) : null}
            <ul className="plain-list" aria-label="Flags">
              {rows.map(({ flag, index }) => (
                <li key={index} className="cr-flag-item">
                  <FlagCard
                    flag={flag}
                    index={index}
                    history={r.decisions.filter((d) => d.flagIndex === index)}
                    canDecide={canDecide}
                    saving={decide.isPending && decide.variables?.flagIndex === index}
                    error={failed?.index === index ? failed.message : undefined}
                    onDecide={(decision, note) => {
                      setFailed(null);
                      decide.mutate(
                        { suggestionId: r.suggestionId, flagIndex: index, decision, note },
                        {
                          onError: (e) => setFailed({ index, message: toErrorView(e).message }),
                        },
                      );
                    }}
                  />
                </li>
              ))}
            </ul>
            <p className="u-caption u-m-0">
              Not on Nova&apos;s checklist: Nova only checks the issues on its list. Anything else,
              check with your lawyer.
            </p>
          </div>
        ) : null}
      </Tabs>
    </div>
  );
}

function SummaryTab({ r }: { r: ContractReview }) {
  return (
    <div className="stack">
      {r.summary.length ? (
        <DescriptionList
          items={r.summary.map((s) => ({
            label: SUMMARY_LABEL[s.key],
            value: (
              <>
                <span>{s.text}</span>
                <SourceQuote source={s.source} />
              </>
            ),
          }))}
        />
      ) : (
        <p className="u-m-0">Nova found none of the key terms in this contract.</p>
      )}
      {r.summaryNotFound.length ? (
        <Card title="Not found in this contract" headingLevel={3}>
          <ul className="plain-list">
            {r.summaryNotFound.map((k) => (
              <li key={k}>{SUMMARY_LABEL[k as keyof typeof SUMMARY_LABEL] ?? k}</li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function TimeBarsTab({ r }: { r: ContractReview }) {
  if (!r.timeBars.length)
    return <p className="u-m-0">Nova found no notice periods or time bars in this contract.</p>;
  return (
    <div className="stack">
      <p className="u-caption u-m-0">
        The contract&apos;s own words. Nova works out no dates: dates come from the rules engine.
      </p>
      <ul className="plain-list" aria-label="Time bars and notice periods">
        {r.timeBars.map((t, i) => (
          <li key={i} className="plain-list__item">
            <strong>{TIME_BAR_LABEL[t.event]}</strong>
            <span>
              {t.period}
              {t.days !== null
                ? ` (${t.days} ${DAY_TYPE_LABEL[t.dayType]})`
                : ` (${DAY_TYPE_LABEL[t.dayType]})`}
            </span>
            <SourceQuote source={t.source} />
          </li>
        ))}
      </ul>
    </div>
  );
}
