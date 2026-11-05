'use client';

import {
  Alert,
  Button,
  DataTable,
  DescriptionList,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatusPill,
  type DataTableColumn,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useReadinessPack, useReadinessPdf } from '../hooks/useReporting';
import { ITEM_LABELS, type ReadinessPack } from '../lib/types';

type Item = ReadinessPack['credentials']['items'][number];

const STATE: Record<
  Item['state'],
  { tone: 'success' | 'warning' | 'danger' | 'neutral'; text: string }
> = {
  current: { tone: 'success', text: 'Current' },
  expiring: { tone: 'warning', text: 'Expiring soon' },
  expired: { tone: 'danger', text: 'Expired' },
  no_expiry: { tone: 'neutral', text: 'No expiry recorded' },
};

const EVIDENCE: Record<Item['evidence'], string> = {
  recorded: 'Recorded',
  sighted: 'Sighted',
  self_declared: 'Self-declared',
};

const NO_ACCESS = (what: string) =>
  `You don't have access to ${what}, so it is left out of the pack.`;

const dollars = (cents: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);

function Coverage({ covered, restricted }: { covered: number; restricted: number }) {
  return (
    <p className="u-muted">
      Covers {covered} {covered === 1 ? 'project' : 'projects'}
      {restricted > 0 ? `; ${restricted} left out because you can't open them` : ''}.
    </p>
  );
}

/** Hands a generated file to the browser as a download. */
function saveFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
}

/** One page a builder can hand to a client, financier or insurer, built from what the company has recorded. */
export function ReadinessScreen() {
  const pack = useReadinessPack();
  const pdf = useReadinessPdf();
  const data = pack.data;

  const columns: DataTableColumn<Item>[] = [
    {
      id: 'type',
      header: 'Type',
      rowHeader: true,
      sortValue: (r) => r.itemType,
      cell: (r) => ITEM_LABELS[r.itemType] ?? r.itemType,
    },
    {
      id: 'title',
      header: 'Document',
      cell: (r) => (r.insurer ? `${r.title} (${r.insurer})` : r.title),
    },
    {
      id: 'expires',
      header: 'Expires',
      sortValue: (r) => r.expiresOn ?? '',
      cell: (r) => r.expiresOn ?? '—',
    },
    {
      id: 'state',
      header: 'Status',
      cell: (r) => <StatusPill tone={STATE[r.state].tone}>{STATE[r.state].text}</StatusPill>,
    },
    { id: 'evidence', header: 'Evidence', cell: (r) => EVIDENCE[r.evidence] },
  ];

  async function onDownload() {
    saveFile(await pdf.mutateAsync());
  }

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="Company"
        title="Tender readiness"
        description="Your licences and insurance, subcontractor prequalification, safety record and retention-trust standing on one page, ready to give a client, financier or insurer."
        actions={
          <Button onClick={() => void onDownload()} loading={pdf.isPending} disabled={!data}>
            Download PDF
          </Button>
        }
      />
      <ErrorAlert error={pack.error ?? pdf.error} title="We couldn't build the pack" />
      {pack.isLoading ? <SkeletonRows label="Building the pack…" /> : null}
      {data ? (
        <>
          {data.attention.length > 0 ? (
            <Alert tone="warning" title="Needs attention">
              <ul>
                {data.attention.map((a) => (
                  <li key={a.text}>{a.text}</li>
                ))}
              </ul>
            </Alert>
          ) : (
            <Alert tone="success" title="Nothing stands out">
              Nothing needs attention in the records you can see.
            </Alert>
          )}
          <p className="u-muted">
            Documents are recorded or sighted by your company. None has been checked against a
            licensing or insurer register.
          </p>

          <section aria-labelledby="ready-creds" className="stack">
            <h2 id="ready-creds" className="panel-heading">
              Licences and insurance
            </h2>
            {data.credentials.restricted ? (
              <Alert tone="info" title="Not shown">
                {NO_ACCESS('the compliance wallet')}
              </Alert>
            ) : (
              <>
                <DescriptionList
                  items={[
                    { label: 'Current', value: data.credentials.current },
                    { label: 'Expiring within 30 days', value: data.credentials.expiring },
                    { label: 'Expired', value: data.credentials.expired },
                    { label: 'No expiry recorded', value: data.credentials.noExpiry },
                  ]}
                />
                <DataTable
                  caption="Licences and insurance"
                  columns={columns}
                  rows={data.credentials.items}
                  getRowId={(r) => `${r.itemType}|${r.title}|${r.expiresOn ?? ''}`}
                  empty={
                    <EmptyState
                      title="No licences or insurance recorded"
                      description="Add them to the compliance wallet and they appear here."
                    />
                  }
                />
              </>
            )}
          </section>

          <section aria-labelledby="ready-prequal" className="stack">
            <h2 id="ready-prequal" className="panel-heading">
              Subcontractor prequalification
            </h2>
            {data.prequal.restricted ? (
              <Alert tone="info" title="Not shown">
                {NO_ACCESS('prequalification')}
              </Alert>
            ) : (
              <>
                <DescriptionList
                  items={[
                    { label: 'Companies on record', value: data.prequal.companies },
                    { label: 'Qualified', value: data.prequal.qualified },
                    { label: 'Expiring within 30 days', value: data.prequal.expiring },
                    { label: 'Pending', value: data.prequal.pending },
                    { label: 'Expired', value: data.prequal.expired },
                    { label: 'Not approved', value: data.prequal.notQualified },
                  ]}
                />
                <p className="u-muted">
                  Prequalification is {data.prequal.requiredForTenders ? '' : 'not '}required before
                  a tender invite.
                </p>
              </>
            )}
          </section>

          <section aria-labelledby="ready-safety" className="stack">
            <h2 id="ready-safety" className="panel-heading">
              Safety record, last 12 months
            </h2>
            <DescriptionList
              items={[
                { label: 'Incidents', value: data.safety.incidents.total },
                { label: 'Notifiable', value: data.safety.incidents.notifiable },
                { label: 'High severity', value: data.safety.incidents.high },
                { label: 'Critical', value: data.safety.incidents.critical },
                { label: 'Not yet closed', value: data.safety.incidents.notClosed },
                { label: 'SWMS accepted and in date', value: data.safety.swms.accepted },
                { label: 'SWMS accepted but expired', value: data.safety.swms.expired },
                { label: 'SWMS awaiting a decision', value: data.safety.swms.awaitingReview },
                { label: 'SWMS rejected', value: data.safety.swms.rejected },
              ]}
            />
            <Coverage
              covered={data.safety.projectsCovered}
              restricted={data.safety.projectsRestricted}
            />
          </section>

          <section aria-labelledby="ready-trust" className="stack">
            <h2 id="ready-trust" className="panel-heading">
              Retention trust compliance
            </h2>
            <DescriptionList
              items={[
                { label: 'Subcontracts', value: data.trust.subcontracts },
                { label: 'In order', value: data.trust.ok },
                {
                  label: 'Short in trust',
                  value: `${data.trust.shortfall} (${dollars(data.trust.shortfallCents)})`,
                },
                { label: 'No trust account recorded', value: data.trust.notSetUp },
                { label: 'Not likely to need a trust', value: data.trust.notRequired },
              ]}
            />
            <p className="u-muted">
              Whether a trust is required depends on state rules Archova has not yet had reviewed.
              Treat &ldquo;likely&rdquo; as a prompt to check, not advice.
            </p>
            <Coverage
              covered={data.trust.projectsCovered}
              restricted={data.trust.projectsRestricted}
            />
          </section>

          {data.truncated ? (
            <Alert tone="info" title="Showing the first 200 projects">
              Close out finished projects to bring the rest into view.
            </Alert>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
