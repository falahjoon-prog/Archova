import Link from 'next/link';
import { Card, StatusPill } from '@archova/ui';
import { webRoutes } from '@archova/routes';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { PaymentClaim } from '../data/api';

/**
 * Claims with an overdue or nearly due SOPA step (schedule deadline, payment, adjudication window), most urgent first.
 * Rule-based from each claim's timeline; shows nothing when all is calm. Status is a word as well as a tone.
 */
export function AttentionPanel({
  claims,
  title,
}: {
  claims: PaymentClaim[];
  title: (contractId: string) => string;
}) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const hot = claims
    .filter((c) => c.attention !== null)
    .sort(
      (a, b) =>
        Number(b.attention!.status === 'overdue') - Number(a.attention!.status === 'overdue') ||
        a.attention!.dueOn.localeCompare(b.attention!.dueOn),
    );
  if (hot.length === 0) return null;
  return (
    <Card title="Needs attention">
      <ul className="stack u-m-0">
        {hot.map((c) => (
          <li key={c.id}>
            <Link
              className="link"
              href={webRoutes.paymentClaim(org.orgSlug, project.projectId, c.id)}
            >
              {title(c.contractId)}, claim {c.number}
            </Link>
            : {c.attention!.label}, {formatLocalDate(c.attention!.dueOn)}{' '}
            <StatusPill tone={c.attention!.status === 'overdue' ? 'danger' : 'warning'}>
              {c.attention!.status === 'overdue' ? 'Overdue' : 'Due soon'}
            </StatusPill>
          </li>
        ))}
      </ul>
    </Card>
  );
}
