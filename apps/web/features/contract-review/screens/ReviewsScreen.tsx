'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Card, EmptyState, PageHeader, SkeletonRows } from '@archova/ui';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { SeverityPill } from '../components/FlagCard';
import { StartReviewForm } from '../components/StartReviewForm';
import type { ContractReview } from '../data/api';
import { useContractReviews } from '../hooks/useContractReview';
import { CONTRACT_TYPE_LABEL, decidedCount } from '../lib/labels';
import { useCanReviewContracts } from '../lib/access';

/** CR1 and CR3: start a review from a contract PDF, and the project's earlier reviews. */
export function ReviewsScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const router = useRouter();
  const allowed = useCanReviewContracts();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'contract-reviews', id: 'register' },
  });
  const q = useContractReviews(project.projectId, allowed);

  return (
    <div className="stack-lg">
      <PageHeader
        title="Contract review"
        description="Nova reads a contract and flags where it departs from your company's playbook. You decide each flag."
        actions={
          <Link className="link" href={webRoutes.contracts(org.orgSlug, project.projectId)}>
            Back to contracts
          </Link>
        }
      />
      {!allowed ? (
        <Alert tone="info" title="Commercial team only">
          Contract review is for people with commercial access on this project. Ask a project admin
          if you need it.
        </Alert>
      ) : (
        <>
          <Card title="Review a contract">
            <StartReviewForm
              onDone={(id) =>
                router.push(webRoutes.contractReview(org.orgSlug, project.projectId, id))
              }
            />
          </Card>
          <Card title="Earlier reviews">
            <ErrorAlert error={q.error} title="We couldn't load the reviews" />
            {q.isPending ? <SkeletonRows label="Loading the reviews…" /> : null}
            {q.data && !q.data.length ? (
              <EmptyState
                title="No reviews yet"
                description="Upload a contract above to start the first one."
              />
            ) : null}
            {q.data?.length ? (
              <ul className="plain-list" aria-label="Reviews">
                {q.data.map((r) => (
                  <ReviewRow key={r.suggestionId} r={r} />
                ))}
              </ul>
            ) : null}
          </Card>
        </>
      )}
    </div>
  );
}

function ReviewRow({ r }: { r: ContractReview }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const counts = (['high', 'medium', 'low'] as const).map((s) => ({
    s,
    n: r.flags.filter((f) => f.severity === s).length,
  }));
  const decided = decidedCount(r);
  return (
    <li className="plain-list__item">
      <Link
        className="link"
        href={webRoutes.contractReview(org.orgSlug, project.projectId, r.suggestionId)}
      >
        {r.fileName}
      </Link>
      <span className="u-caption">
        {CONTRACT_TYPE_LABEL[r.contractType]} · {formatInstant(r.createdAt, project.timezone)} ·{' '}
        {decided} of {r.flags.length} flags decided
      </span>
      <span className="row-actions">
        {counts
          .filter((c) => c.n)
          .map((c) => (
            <span key={c.s} className="row-actions">
              <SeverityPill severity={c.s} />
              <span className="u-caption">{c.n}</span>
            </span>
          ))}
      </span>
    </li>
  );
}
