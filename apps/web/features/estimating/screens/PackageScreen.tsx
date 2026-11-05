'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  Switch,
  Tabs,
  TextField,
  Textarea,
} from '@archova/ui';
import { EstimatingIcon } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { listsFor, listCandidates, useBidderLists } from '@/features/bid-board';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { toErrorView } from '@/shared/lib/errors';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { formatInstant, todayIn } from '@/shared/lib/format';
import { mockId } from '@/shared/mocks/runtime';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { useBudget } from '@/features/budget';
import { usePackage, usePackageMutations, useQuotes, useQuotesSource } from '../hooks/useQuotes';
import { comparableQuotes, levelQuotes, lowestQuoteId, parseScopeCsv } from '../lib/levelling';
import {
  INVITE_STATUS_LABELS,
  PACKAGE_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
  formatPackageNumber,
  type PackageAction,
  type Quote,
  type TenderPackage,
} from '../lib/quote-types';
import { ComparisonTable } from '../quotes/ComparisonTable';
import { money } from '../quotes/money';
import { NegotiatePanel } from '../quotes/NegotiatePanel';
import { QuoteReview } from '../quotes/QuoteReview';
import { SourceDialog, type SourceTarget } from '../quotes/SourceDialog';

const TABS = ['comparison', 'quotes', 'scope'] as const;

/** One tender package (F1.3b): scope and invites, quotes read by Nova, and the levelled comparison. */
export function PackageScreen({ packageId }: { packageId: string }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'tender-package', id: packageId },
  });
  const pkg = usePackage(packageId);
  const quotes = useQuotes(packageId);
  const [params, setParams] = useUrlState(['tab', 'normalise'] as const);
  const tab = (TABS as readonly string[]).includes(params.tab) ? params.tab : 'comparison';
  const [source, setSource] = useState<SourceTarget | null>(null);

  if (pkg.isPending) return <SkeletonRows label="Loading package…" />;
  if (pkg.isError) return <ErrorAlert error={pkg.error} title="We couldn't open this package" />;
  const p = pkg.data;
  const all = quotes.data ?? [];
  const toReview = all.filter(
    (q) => q.status === 'ready_to_review' || q.status === 'reading',
  ).length;

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow={
          <Link className="link" href={webRoutes.tenderPackages(org.orgSlug, project.projectId)}>
            Tender packages
          </Link>
        }
        title={`${formatPackageNumber(p.number)} ${p.name}`}
        description={
          <span className="row-actions">
            <StatusPill tone={p.status === 'awarded' ? 'success' : 'info'}>
              {PACKAGE_STATUS_LABELS[p.status]}
            </StatusPill>
            <span>{p.trade}</span>
            <span>
              {p.dueAt ? `Due ${formatInstant(p.dueAt, project.timezone)}` : 'No due date'}
            </span>
          </span>
        }
      />
      {previewDataOnly ? <PreviewDataNotice tool="Estimating" /> : null}
      <PackageActions pkg={p} />
      <Tabs
        label="Package sections"
        value={tab}
        onValueChange={(id) => setParams({ tab: id === 'comparison' ? null : id })}
        tabs={[
          { id: 'comparison', label: 'Comparison' },
          { id: 'quotes', label: 'Quotes', count: toReview || undefined },
          { id: 'scope', label: 'Scope and invites', count: p.scope.length },
        ]}
      >
        {tab === 'comparison' ? (
          <Comparison
            pkg={p}
            quotes={all}
            normalise={Boolean(params.normalise)}
            setNormalise={(on) => setParams({ normalise: on ? '1' : null })}
            toReview={toReview}
            openQuotes={() => setParams({ tab: 'quotes' })}
            onSource={setSource}
          />
        ) : null}
        {tab === 'quotes' ? (
          <Quotes pkg={p} quotes={all} loading={quotes.isPending} onSource={setSource} />
        ) : null}
        {tab === 'scope' ? <Scope pkg={p} /> : null}
      </Tabs>
      <SourceDialog target={source} onClose={() => setSource(null)} />
    </div>
  );
}

/** Where the package is in its life: draft, out to tender, closed or cancelled. Awarding is on the Comparison tab. */
function PackageActions({ pkg }: { pkg: TenderPackage }) {
  const m = usePackageMutations(pkg.id);
  const ready = pkg.scope.length > 0 && pkg.invites.length > 0 && Boolean(pkg.dueAt);
  const go = (action: PackageAction) => m.transition.mutate(action);
  if (pkg.status === 'awarded' || pkg.status === 'cancelled') return null;
  return (
    <div className="stack">
      <div className="row-actions">
        {pkg.status === 'draft' ? (
          <Button disabled={!ready || m.transition.isPending} onClick={() => go('send')}>
            Send out to tender
          </Button>
        ) : null}
        {pkg.status === 'out_to_tender' ? (
          <Button variant="secondary" disabled={m.transition.isPending} onClick={() => go('close')}>
            Close tender
          </Button>
        ) : null}
        {pkg.status === 'closed' ? (
          <Button
            variant="secondary"
            disabled={m.transition.isPending}
            onClick={() => go('reopen')}
          >
            Reopen tender
          </Button>
        ) : null}
        <Button variant="secondary" disabled={m.transition.isPending} onClick={() => go('cancel')}>
          Cancel package
        </Button>
      </div>
      {pkg.status === 'draft' && !ready ? (
        <p className="u-caption u-m-0">
          Add scope lines and invite at least one subcontractor to send this out to tender.
        </p>
      ) : null}
      <ErrorAlert error={m.transition.error} title="We couldn't change the package" />
    </div>
  );
}

function Comparison({
  pkg,
  quotes,
  normalise,
  setNormalise,
  toReview,
  openQuotes,
  onSource,
}: {
  pkg: TenderPackage;
  quotes: Quote[];
  normalise: boolean;
  setNormalise: (on: boolean) => void;
  toReview: number;
  openQuotes: () => void;
  onSource: (t: SourceTarget) => void;
}) {
  const project = useCurrentProject();
  const { companyName } = useProjectDirectory();
  const org = useCurrentOrg();
  const m = usePackageMutations(pkg.id);
  const today = todayIn(project.timezone);
  const comparable = comparableQuotes(quotes);
  const { rows, totals } = levelQuotes(pkg, comparable, today);
  const lowestNormalised = lowestQuoteId(totals, true);
  const lowestShown = lowestQuoteId(totals, normalise);
  const [selecting, setSelecting] = useState<Quote | null>(null);
  const [reason, setReason] = useState('');
  const notLowest = selecting !== null && selecting.id !== lowestNormalised;
  const awarded = pkg.award ? quotes.find((q) => q.id === pkg.award!.quoteId) : null;

  return (
    <div className="stack">
      {awarded && pkg.award ? (
        <Alert tone="success" title={`Selected ${companyName(awarded.companyId)}`}>
          {pkg.award.by} selected this quote on {formatInstant(pkg.award.at, project.timezone)}.
          {pkg.award.reason ? ` Reason: ${pkg.award.reason}` : ''}
          <div className="row">
            {m.subcontract.data ? (
              <Link
                className="link"
                href={webRoutes.contract(
                  org.orgSlug,
                  project.projectId,
                  m.subcontract.data.contractId,
                )}
              >
                {m.subcontract.data.created
                  ? 'Draft subcontract created'
                  : 'Subcontract already created'}
                : open subcontract {m.subcontract.data.number}
              </Link>
            ) : (
              <Button
                variant="secondary"
                disabled={m.subcontract.isPending}
                onClick={() => m.subcontract.mutate()}
              >
                Create subcontract from this quote
              </Button>
            )}
          </div>
          <ErrorAlert error={m.subcontract.error} title="We couldn't create the subcontract" />
          <CommitmentRaiser
            raise={(budgetLineId) => m.commitment.mutate(budgetLineId)}
            pending={m.commitment.isPending}
            result={m.commitment.data ?? null}
            error={m.commitment.error}
          />
        </Alert>
      ) : null}
      {toReview ? (
        <p className="u-m-0">
          <button type="button" className="link-button" onClick={openQuotes}>
            {toReview} {toReview === 1 ? 'quote is' : 'quotes are'} waiting for review
          </button>{' '}
          and not in the comparison yet.
        </p>
      ) : null}
      {comparable.length === 0 ? (
        <EmptyState
          icon={EstimatingIcon}
          title="No confirmed quotes yet"
          description="Upload quotes on the Quotes tab. Once you confirm what Nova read, they line up here."
        />
      ) : (
        <>
          <Switch
            label="Normalise with allowances for gaps"
            checked={normalise}
            onCheckedChange={setNormalise}
          />
          <ComparisonTable
            quotes={comparable}
            rows={rows}
            totals={totals}
            normalise={normalise}
            lowestId={lowestShown}
            awardedId={pkg.award?.quoteId ?? null}
            canSelect={pkg.status !== 'awarded'}
            onSelect={(q) => {
              setReason('');
              setSelecting(q);
            }}
            onAllowance={(quoteId, scopeKey, cents) =>
              m.allowance.mutate({ quoteId, scopeKey, cents })
            }
            onSource={onSource}
          />
          <p className="u-caption u-m-0">Amounts are ex GST. GST is shown separately.</p>
          <NegotiatePanel packageId={pkg.id} quotes={comparable} />
        </>
      )}
      <ErrorAlert error={m.allowance.error} title="We couldn't save the allowance" />
      <Dialog
        open={selecting !== null}
        onClose={() => setSelecting(null)}
        title={selecting ? `Select ${companyName(selecting.companyId)}` : ''}
        description="This records the decision. Nothing is sent to the subcontractors from here."
        footer={
          <>
            <Button variant="secondary" onClick={() => setSelecting(null)}>
              Cancel
            </Button>
            <Button
              disabled={m.award.isPending || (notLowest && !reason.trim())}
              onClick={() =>
                selecting &&
                m.award.mutate(
                  { quoteId: selecting.id, reason },
                  { onSuccess: () => setSelecting(null) },
                )
              }
            >
              Select preferred quote
            </Button>
          </>
        }
      >
        <div className="stack">
          {selecting ? (
            <p className="u-m-0">
              Normalised total{' '}
              {money(totals.find((t) => t.quoteId === selecting.id)?.normalisedCents ?? 0)} ex GST.
            </p>
          ) : null}
          {notLowest ? (
            <Alert tone="warning" title="This isn't the lowest like-for-like quote">
              Say why, for the record.
            </Alert>
          ) : null}
          <Textarea
            label={notLowest ? 'Reason' : 'Reason (optional)'}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <ErrorAlert error={m.award.error} title="We couldn't record the selection" />
        </div>
      </Dialog>
    </div>
  );
}

function Quotes({
  pkg,
  quotes,
  loading,
  onSource,
}: {
  pkg: TenderPackage;
  quotes: Quote[];
  loading: boolean;
  onSource: (t: SourceTarget) => void;
}) {
  const project = useCurrentProject();
  const { companies, companyName, onProject } = useProjectDirectory();
  const { live } = useQuotesSource();
  const m = usePackageMutations(pkg.id);
  const [companyId, setCompanyId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const current = quotes.filter((q) => q.status !== 'superseded');
  const earlier = quotes.filter((q) => q.status === 'superseded');
  const tradeFirst = companies
    .filter(
      (c) =>
        c.isSubcontractor &&
        onProject(c.id) &&
        // The API takes quotes only from invited companies; the preview adds the invite itself.
        (!live || pkg.invites.some((i) => i.companyId === c.id)),
    )
    .sort(
      (a, b) =>
        Number(b.trades.includes(pkg.trade)) - Number(a.trades.includes(pkg.trade)) ||
        a.name.localeCompare(b.name),
    );

  if (loading) return <SkeletonRows label="Loading quotes…" />;
  return (
    <div className="stack-lg">
      <section className="stack ac-card" aria-labelledby="upload-quote">
        <h2 id="upload-quote" className="panel-heading">
          Upload a quote
        </h2>
        <p className="u-m-0 u-caption">
          {live ? 'PDF.' : 'PDF or Excel.'} Nova reads the lines, exclusions and qualifications; you
          check them before they count. A new quote from the same company replaces its earlier one,
          and both are kept.
        </p>
        {live && tradeFirst.length === 0 ? (
          <Alert tone="info">
            Invite a subcontractor on the Scope and invites tab before uploading their quote.
          </Alert>
        ) : null}
        <div className="form-row">
          <Select
            label="Subcontractor"
            value={companyId}
            placeholder="Choose a company"
            options={tradeFirst.map((c) => ({
              value: c.id,
              label: `${c.name} · ${c.trades.join(', ')}`,
            }))}
            onChange={(e) => setCompanyId(e.target.value)}
          />
          <div className="stack">
            <label className="ac-field__label" htmlFor="quote-file">
              Quote file
            </label>
            <input
              key={fileKey}
              id="quote-file"
              className="file-input"
              type="file"
              accept={live ? '.pdf' : '.pdf,.xlsx,.xls,.csv'}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>
        <div>
          <Button
            disabled={!companyId || !file || m.upload.isPending || pkg.status !== 'out_to_tender'}
            onClick={() =>
              m.upload.mutate(
                { companyId, file: file! },
                {
                  onSuccess: () => {
                    setFile(null);
                    setFileKey((k) => k + 1);
                  },
                },
              )
            }
          >
            Upload quote
          </Button>
        </div>
        <ErrorAlert error={m.upload.error} title="We couldn't upload the quote" />
      </section>

      {current.length === 0 ? (
        <EmptyState
          icon={EstimatingIcon}
          title="No quotes yet"
          description="Uploaded quotes appear here."
        />
      ) : (
        current.map((q) => (
          <section key={q.id} className="stack" aria-labelledby={`q-${q.id}`}>
            <div className="row-actions">
              <h3 id={`q-${q.id}`} className="panel-subheading">
                {companyName(q.companyId)} v{q.version}
              </h3>
              <StatusPill
                tone={
                  q.status === 'confirmed' ? 'success' : q.status === 'reading' ? 'ai' : 'warning'
                }
              >
                {QUOTE_STATUS_LABELS[q.status]}
              </StatusPill>
              <span className="u-caption">
                {q.fileName} · received {formatInstant(q.receivedAt, project.timezone)}
                {q.confirmedBy ? ` · confirmed by ${q.confirmedBy}` : ''}
              </span>
            </div>
            {q.status === 'reading' ? (
              <p className="u-muted u-m-0" role="status">
                Nova is reading this quote. It will be ready to review shortly.
              </p>
            ) : (
              <QuoteReview
                quote={q}
                scope={pkg.scope}
                busy={m.confirm.isPending || m.decline.isPending}
                onCorrect={(lineId, amountCents) =>
                  m.correct.mutate({ quoteId: q.id, lineId, amountCents })
                }
                onConfirm={() => m.confirm.mutate(q.id)}
                onDecline={() => m.decline.mutate(q.id)}
                onSource={onSource}
              />
            )}
          </section>
        ))
      )}
      <ErrorAlert
        error={m.correct.error ?? m.confirm.error ?? m.decline.error}
        title="That didn't save"
      />
      {earlier.length ? (
        <details>
          <summary>Earlier versions ({earlier.length})</summary>
          <ul className="plain-list">
            {earlier.map((q) => (
              <li key={q.id}>
                {companyName(q.companyId)} v{q.version} · {q.fileName} · superseded
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function Scope({ pkg }: { pkg: TenderPackage }) {
  const { companies, companyName, onProject } = useProjectDirectory();
  const project = useCurrentProject();
  const m = usePackageMutations(pkg.id);
  const [line, setLine] = useState({ description: '', quantity: '', unit: 'm²' });
  const [csv, setCsv] = useState('');
  const [invite, setInvite] = useState<string[]>([]);
  const [overrideReason, setOverrideReason] = useState('');
  const notQualified = toErrorView(m.invite.error).code === 'tender.company_not_qualified';
  const bidderLists = useBidderLists({ enabled: !previewDataOnly });
  const locked = pkg.status === 'awarded';
  const invited = new Set(pkg.invites.map((i) => i.companyId));
  const candidates = companies
    .filter((c) => c.isSubcontractor && onProject(c.id) && !invited.has(c.id))
    .sort(
      (a, b) =>
        Number(b.trades.includes(pkg.trade)) - Number(a.trades.includes(pkg.trade)) ||
        a.name.localeCompare(b.name),
    );

  return (
    <div className="stack-lg">
      <section className="stack" aria-labelledby="scope-lines">
        <h2 id="scope-lines" className="panel-heading">
          Scope lines
        </h2>
        {pkg.scope.length ? (
          <div className="table-wrap">
            <table className="table">
              <caption className="u-visually-hidden">Scope lines</caption>
              <thead>
                <tr>
                  <th scope="col">Description</th>
                  <th scope="col" className="ac-table__num">
                    Quantity
                  </th>
                  <th scope="col">From</th>
                </tr>
              </thead>
              <tbody>
                {pkg.scope.map((s) => (
                  <tr key={s.key}>
                    <th scope="row">{s.description}</th>
                    <td className="ac-table__num">
                      {s.quantity ?? '—'} {s.unit}
                    </td>
                    <td>
                      {s.source === 'takeoff' ? 'Takeoff' : s.source === 'csv' ? 'CSV' : 'Typed'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="u-muted u-m-0">
            No scope yet. Type lines, paste a CSV, or send quantities from a drawing&apos;s Measure
            panel.
          </p>
        )}
        {!locked ? (
          <>
            <div className="form-row diary-line">
              <TextField
                label="Description"
                value={line.description}
                onChange={(e) => setLine({ ...line, description: e.target.value })}
              />
              <TextField
                label="Quantity"
                type="number"
                min={0}
                value={line.quantity}
                onChange={(e) => setLine({ ...line, quantity: e.target.value })}
              />
              <TextField
                label="Unit"
                value={line.unit}
                onChange={(e) => setLine({ ...line, unit: e.target.value })}
              />
              <div>
                <Button
                  variant="secondary"
                  disabled={!line.description.trim()}
                  onClick={() =>
                    m.addScope.mutate(
                      [
                        {
                          key: mockId('scp'),
                          description: line.description.trim(),
                          quantity: line.quantity === '' ? null : Number(line.quantity),
                          unit: line.unit || 'item',
                          source: 'typed',
                        },
                      ],
                      {
                        onSuccess: () =>
                          setLine({ description: '', quantity: '', unit: line.unit }),
                      },
                    )
                  }
                >
                  Add line
                </Button>
              </div>
            </div>
            <Textarea
              label="Paste CSV"
              hint="One line per row: description, quantity, unit."
              rows={3}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
            />
            <div>
              <Button
                variant="secondary"
                disabled={!csv.trim()}
                onClick={() =>
                  m.addScope.mutate(
                    parseScopeCsv(csv, () => mockId('scp')),
                    { onSuccess: () => setCsv('') },
                  )
                }
              >
                Import lines
              </Button>
            </div>
          </>
        ) : null}
        <ErrorAlert error={m.addScope.error} title="We couldn't add the lines" />
      </section>

      <section className="stack" aria-labelledby="invites">
        <h2 id="invites" className="panel-heading">
          Invited subcontractors
        </h2>
        {pkg.invites.length ? (
          <ul className="plain-list">
            {pkg.invites.map((i) => (
              <li key={i.companyId} className="row-actions">
                <span>
                  {companyName(i.companyId)}
                  {pkg.status === 'draft' ? (
                    <span className="u-caption u-block">
                      Gets a link by email when you send it.
                    </span>
                  ) : i.deliveredAt ? (
                    <span className="u-caption u-block">
                      Link emailed {formatInstant(i.deliveredAt, project.timezone)}
                    </span>
                  ) : (
                    <span className="u-caption u-block">
                      Not emailed yet. Check the company has an email address, then resend.
                    </span>
                  )}
                </span>
                {pkg.status === 'out_to_tender' &&
                ['invited', 'viewed', 'intends_to_quote'].includes(i.status) ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={m.resend.isPending && m.resend.variables === i.companyId}
                    aria-label={`Resend link to ${companyName(i.companyId)}`}
                    onClick={() => m.resend.mutate(i.companyId)}
                  >
                    Resend link
                  </Button>
                ) : null}
                <StatusPill
                  tone={
                    i.status === 'declined'
                      ? 'neutral'
                      : i.status === 'submitted'
                        ? 'success'
                        : 'info'
                  }
                >
                  {INVITE_STATUS_LABELS[i.status]}
                </StatusPill>
              </li>
            ))}
          </ul>
        ) : (
          <p className="u-muted u-m-0">No one invited yet.</p>
        )}
        {!locked && candidates.length === 0 && pkg.invites.length === 0 ? (
          <p className="u-caption u-m-0">
            No subcontractors are on this project yet. Add them to the project first, then invite
            them here.
          </p>
        ) : null}
        {!locked && candidates.length ? (
          <fieldset className="fieldset stack">
            <legend>
              Invite (each gets a link by email to see the scope and say if they will quote)
            </legend>
            {bidderLists.data?.length ? (
              <Select
                label="Tick a bidder list"
                value=""
                placeholder="Choose a list"
                hint="Ticks the list's subcontractors who are on this project and not yet invited."
                options={listsFor(bidderLists.data, pkg.trade).map((l) => ({
                  value: l.id,
                  label: l.trade ? `${l.name} · ${l.trade}` : l.name,
                }))}
                onChange={(e) => {
                  const list = bidderLists.data?.find((l) => l.id === e.target.value);
                  if (list)
                    setInvite([
                      ...new Set([
                        ...invite,
                        ...listCandidates(
                          list,
                          candidates.map((c) => c.id),
                        ),
                      ]),
                    ]);
                }}
              />
            ) : null}
            <div className="check-grid">
              {candidates.map((c) => (
                <Checkbox
                  key={c.id}
                  label={`${c.name} · ${c.trades.join(', ')}`}
                  checked={invite.includes(c.id)}
                  onChange={(e) =>
                    setInvite(
                      e.target.checked ? [...invite, c.id] : invite.filter((id) => id !== c.id),
                    )
                  }
                />
              ))}
            </div>
            {notQualified ? (
              <TextField
                label="Override reason (admins only)"
                value={overrideReason}
                maxLength={500}
                hint="These companies aren't prequalified. To invite them anyway, an admin can record why."
                onChange={(e) => setOverrideReason(e.target.value)}
              />
            ) : null}
            <div className="u-m-0">
              <Button
                disabled={!invite.length || m.invite.isPending}
                onClick={() =>
                  m.invite.mutate(
                    { companyIds: invite, overrideReason: overrideReason.trim() || undefined },
                    {
                      onSuccess: () => {
                        setInvite([]);
                        setOverrideReason('');
                      },
                    },
                  )
                }
              >
                Send {invite.length || ''} {invite.length === 1 ? 'invite' : 'invites'}
              </Button>
            </div>
          </fieldset>
        ) : null}
        <ErrorAlert error={m.invite.error} title="We couldn't send the invites" />
        <ErrorAlert error={m.resend.error} title="We couldn't resend that link" />
      </section>
    </div>
  );
}

/** Picks the budget line the awarded price counts against, then raises the draft commitment. */
function CommitmentRaiser({
  raise,
  pending,
  result,
  error,
}: {
  raise: (budgetLineId: string) => void;
  pending: boolean;
  result: { number: number; created: boolean } | null;
  error: unknown;
}) {
  const project = useCurrentProject();
  const budget = useBudget(project.projectId);
  const lines = (budget.data?.lines ?? []).filter((l) => !l.isMargin);
  const [lineId, setLineId] = useState('');
  if (result)
    return (
      <p className="u-m-0">
        {result.created ? 'Draft commitment created' : 'Commitment already created'}: commitment{' '}
        {result.number}. Submit it for approval from the project's commitments.
      </p>
    );
  if (budget.isPending || lines.length === 0)
    return (
      <p className="u-caption u-m-0">
        {budget.isPending
          ? 'Checking the budget…'
          : 'Add a budget line to raise a commitment from this award.'}
      </p>
    );
  return (
    <div className="stack">
      <Select
        label="Budget line for the commitment"
        value={lineId}
        options={[
          { value: '', label: 'Choose a budget line' },
          ...lines.map((l) => ({
            value: l.id,
            label: `${l.code} ${l.description || l.codeDescription}`,
          })),
        ]}
        onChange={(e) => setLineId(e.target.value)}
      />
      <div className="row">
        <Button variant="secondary" disabled={!lineId || pending} onClick={() => raise(lineId)}>
          Create budget commitment
        </Button>
      </div>
      <ErrorAlert error={error} title="We couldn't create the commitment" />
    </div>
  );
}
