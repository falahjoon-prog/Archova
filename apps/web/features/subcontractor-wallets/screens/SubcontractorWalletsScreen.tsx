'use client';

import { InductionsIcon as ShieldCheck } from '@archova/ui/icons';
import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
  type StatusTone,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useFeatureFlag } from '@/shared/hooks/useFeatureFlag';
import { isApiError } from '@/shared/lib/errors';
import { formatLocalDate } from '@/shared/lib/format';
import { serverFieldErrors } from '@/shared/lib/forms';
import { EVIDENCE_LABELS, EXPIRY_LABELS, ITEM_TYPE_LABELS, type Expiry } from '@/features/wallet';
import {
  useAccessRequests,
  useGrantedWallets,
  useProjectChoices,
  useSharedDocuments,
  useSubcontractorWalletMutations,
} from '../hooks/useSubcontractorWallets';
import type { AccessRequest, GrantedWallet, SharedDocument, SnapshotReason } from '../data/api';

type ItemType = AccessRequest['itemTypes'][number];

/** Types a builder can ask for. A working-with-children check stays with the holder and is never shared. */
const REQUESTABLE: readonly ItemType[] = [
  'contractor_licence',
  'trade_licence',
  'workers_comp',
  'public_liability',
  'contract_works',
  'professional_indemnity',
  'personal_accident',
  'home_warranty',
  'subcontractor_statement',
  'plant_registration',
  'test_and_tag',
  'modern_slavery',
  'other',
];

const ALL_PROJECTS = '__all';
const EXPIRY_TONE: Record<Expiry, StatusTone> = {
  no_expiry: 'neutral',
  current: 'success',
  expiring: 'warning',
  expired: 'danger',
};
const REQUEST_TONE: Record<AccessRequest['status'], StatusTone> = {
  requested: 'info',
  accepted: 'success',
  cancelled: 'neutral',
};
const REQUEST_LABEL: Record<AccessRequest['status'], string> = {
  requested: 'Waiting for the subcontractor',
  accepted: 'Accepted',
  cancelled: 'Cancelled',
};
const REASONS: Array<{ value: SnapshotReason; label: string }> = [
  { value: 'site_entry', label: 'Site entry' },
  { value: 'claim_assessment', label: 'Claim assessment' },
  { value: 'other', label: 'Other' },
];

const scopeOf = (r: { allProjects: boolean; projectName: string | null }) =>
  r.allProjects ? 'All your projects' : (r.projectName ?? 'One project');

function RequestCard() {
  const projects = useProjectChoices();
  const m = useSubcontractorWalletMutations();
  const [scope, setScope] = useState('');
  const [types, setTypes] = useState<ItemType[]>([]);
  const [expiresOn, setExpiresOn] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const server = serverFieldErrors(m.request.error);
  const created = m.request.data;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setProblem(null);
    if (!scope) return setProblem('Choose a project, or all your projects.');
    if (types.length === 0) return setProblem('Choose at least one type of document.');
    m.request.mutate({
      itemTypes: types,
      allProjects: scope === ALL_PROJECTS,
      ...(scope === ALL_PROJECTS ? {} : { projectId: scope }),
      ...(expiresOn ? { expiresOn } : {}),
    });
  }

  return (
    <Card title="Ask a subcontractor for their documents">
      <form className="stack" onSubmit={onSubmit} noValidate>
        <p className="u-caption">
          You get a code to give the subcontractor. They look at what you are asking for and accept
          it, and nothing is shared until they do. Access ends on the date below (up to 12 months)
          and they can end it sooner.
        </p>
        <Select
          label="Project"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          placeholder="Choose a project"
          options={[
            ...(projects.data?.data ?? []).map((p) => ({ value: p.id, label: p.name })),
            { value: ALL_PROJECTS, label: 'All of our projects (a wider request)' },
          ]}
        />
        <fieldset className="stack">
          <legend className="u-label">Documents</legend>
          {REQUESTABLE.map((t) => (
            <Checkbox
              key={t}
              label={ITEM_TYPE_LABELS[t]}
              checked={types.includes(t)}
              onChange={(e) =>
                setTypes((cur) => (e.target.checked ? [...cur, t] : cur.filter((x) => x !== t)))
              }
            />
          ))}
        </fieldset>
        <TextField
          label="Access ends on (optional)"
          type="date"
          value={expiresOn}
          onChange={(e) => setExpiresOn(e.target.value)}
          error={server.expiresOn}
        />
        {problem ? <Alert tone="danger">{problem}</Alert> : null}
        {m.request.isError && !Object.keys(server).length ? (
          <ErrorAlert error={m.request.error} title="We couldn’t create the request" />
        ) : null}
        <div>
          <Button type="submit" disabled={m.request.isPending}>
            {m.request.isPending ? 'Creating…' : 'Create request'}
          </Button>
        </div>
      </form>
      {created ? (
        <Alert tone="success" title="Give this code to the subcontractor">
          <p>
            <code data-testid="share-code">{created.code}</code>
          </p>
          <p className="u-caption">
            It is shown once and works for 14 days. If it is lost, cancel the request and make a new
            one.
          </p>
        </Alert>
      ) : null}
    </Card>
  );
}

function RequestsCard() {
  const requests = useAccessRequests();
  const m = useSubcontractorWalletMutations();
  return (
    <Card title="Your requests">
      <div className="stack">
        {requests.isPending ? <SkeletonRows rows={2} label="Loading requests…" /> : null}
        {requests.isError ? (
          <ErrorAlert error={requests.error} title="We couldn’t load your requests" />
        ) : null}
        {requests.data && requests.data.length === 0 ? (
          <p className="u-muted">No requests yet.</p>
        ) : null}
        {requests.data?.length ? (
          <ul className="wallet__list">
            {requests.data.map((r) => (
              <li key={r.id} className="wallet__row">
                <div className="wallet__head">
                  <strong>{scopeOf(r)}</strong>
                  <StatusPill tone={REQUEST_TONE[r.status]}>{REQUEST_LABEL[r.status]}</StatusPill>
                </div>
                <span className="u-caption">
                  {r.itemTypes.map((t) => ITEM_TYPE_LABELS[t]).join(', ')} · Access to{' '}
                  {formatLocalDate(r.grantExpiresOn)}
                </span>
                {r.status === 'requested' ? (
                  <div className="wallet__actions">
                    <Button
                      variant="secondary"
                      disabled={m.cancel.isPending}
                      onClick={() => m.cancel.mutate(r)}
                    >
                      Cancel<span className="u-visually-hidden"> request for {scopeOf(r)}</span>
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {m.cancel.isError ? (
          <ErrorAlert error={m.cancel.error} title="We couldn’t cancel the request" />
        ) : null}
      </div>
    </Card>
  );
}

function SharedDocumentRow({
  grantId,
  projectId,
  doc,
}: {
  grantId: string;
  projectId: string;
  doc: SharedDocument;
}) {
  const m = useSubcontractorWalletMutations();
  const [reason, setReason] = useState<SnapshotReason>('site_entry');
  const [kept, setKept] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const details = [doc.numberLast4 ? `Number ends in ${doc.numberLast4}` : null, doc.insurer]
    .filter(Boolean)
    .join(' · ');

  function openFile(position: number) {
    setFileError(null);
    m.openFile.mutate(
      { grantId, projectId, documentId: doc.id, position },
      {
        onSuccess: (url) => window.open(url, '_blank', 'noopener'),
        onError: () => setFileError('We couldn’t open that file.'),
      },
    );
  }

  return (
    <li className="wallet__row">
      <div className="wallet__head">
        <strong>{doc.title}</strong>
        <span className="wallet__pills">
          <StatusPill tone={EXPIRY_TONE[doc.expiry]}>{EXPIRY_LABELS[doc.expiry]}</StatusPill>
        </span>
      </div>
      <span className="u-caption">
        {ITEM_TYPE_LABELS[doc.itemType]}
        {details ? ` · ${details}` : ''}
      </span>
      <span className="u-caption">
        {doc.expiresOn ? `Expires ${formatLocalDate(doc.expiresOn)}` : 'No expiry date'} ·{' '}
        {EVIDENCE_LABELS[doc.evidence]}
      </span>
      <div className="wallet__actions">
        {Array.from({ length: doc.fileCount }, (_, i) => (
          <Button
            key={i}
            variant="secondary"
            disabled={m.openFile.isPending}
            onClick={() => openFile(i + 1)}
          >
            Open file {doc.fileCount > 1 ? i + 1 : ''}
            <span className="u-visually-hidden"> of {doc.title}</span>
          </Button>
        ))}
      </div>
      {fileError ? <span className="u-caption">{fileError}</span> : null}
      <div className="wallet__actions">
        <Select
          label="Reason for keeping a record"
          value={reason}
          onChange={(e) => setReason(e.target.value as SnapshotReason)}
          options={REASONS}
        />
        <Button
          variant="secondary"
          disabled={m.snapshot.isPending}
          onClick={() =>
            m.snapshot.mutate(
              { grantId, projectId, documentId: doc.id, reason },
              { onSuccess: () => setKept(true) },
            )
          }
        >
          Keep a record<span className="u-visually-hidden"> of {doc.title}</span>
        </Button>
        {kept ? <span className="u-caption">Record kept.</span> : null}
      </div>
      {m.snapshot.isError ? (
        <ErrorAlert error={m.snapshot.error} title="We couldn’t keep a record" />
      ) : null}
    </li>
  );
}

function WalletDocuments({ wallet }: { wallet: GrantedWallet }) {
  const projects = useProjectChoices();
  const [picked, setPicked] = useState('');
  const projectId = wallet.projectId ?? picked;
  const docs = useSharedDocuments(wallet.grantId, projectId);
  return (
    <div className="stack">
      {wallet.allProjects ? (
        <Select
          label="Which project is this for?"
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          placeholder="Choose a project"
          options={(projects.data?.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
        />
      ) : null}
      <p className="u-caption">
        Looking is recorded in {wallet.subbieName}’s access log. You see the last four characters of
        a number, never the full number.
      </p>
      {projectId && docs.isPending ? <SkeletonRows rows={2} label="Loading documents…" /> : null}
      {docs.isError ? (
        isApiError(docs.error, 404) ? (
          <p className="u-muted">This access has ended or doesn’t cover that project.</p>
        ) : (
          <ErrorAlert error={docs.error} title="We couldn’t load their documents" />
        )
      ) : null}
      {docs.data && docs.data.length === 0 ? (
        <p className="u-muted">They haven’t added any of these documents yet.</p>
      ) : null}
      {docs.data?.length ? (
        <ul className="wallet__list">
          {docs.data.map((d) => (
            <SharedDocumentRow key={d.id} grantId={wallet.grantId} projectId={projectId} doc={d} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function WalletsCard() {
  const wallets = useGrantedWallets();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card title="Shared with you">
      <div className="stack">
        {wallets.isPending ? <SkeletonRows rows={2} label="Loading wallets…" /> : null}
        {wallets.isError ? (
          isApiError(wallets.error, 403) ? (
            <p className="u-muted">You don’t have access to subcontractor wallets.</p>
          ) : (
            <ErrorAlert error={wallets.error} title="We couldn’t load the shared wallets" />
          )
        ) : null}
        {wallets.data && wallets.data.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="Nothing shared with you yet"
            description="Once a subcontractor accepts a request, their documents appear here until the access ends."
          />
        ) : null}
        {wallets.data?.length ? (
          <ul className="wallet__list">
            {wallets.data.map((w) => (
              <li key={w.grantId} className="wallet__row">
                <div className="wallet__head">
                  <strong>{w.subbieName}</strong>
                  <StatusPill tone="info">{scopeOf(w)}</StatusPill>
                </div>
                <span className="u-caption">
                  {w.itemTypes.map((t) => ITEM_TYPE_LABELS[t]).join(', ')} · Access to{' '}
                  {formatLocalDate(w.expiresOn)}
                </span>
                <div className="wallet__actions">
                  <Button
                    variant="secondary"
                    onClick={() => setOpen(open === w.grantId ? null : w.grantId)}
                  >
                    {open === w.grantId ? 'Hide documents' : 'View documents'}
                    <span className="u-visually-hidden"> from {w.subbieName}</span>
                  </Button>
                </div>
                {open === w.grantId ? <WalletDocuments wallet={w} /> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}

export function SubcontractorWalletsScreen() {
  const enabled = useFeatureFlag('subcontractor_wallet');
  if (!enabled) {
    return (
      <>
        <PageHeader title="Subcontractor wallets" />
        <EmptyState
          icon={ShieldCheck}
          title="Subcontractor wallets aren’t switched on for this company"
          description="Ask Archova support to turn them on."
        />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Subcontractor wallets"
        description="Ask a subcontractor for their insurance and licence documents for a project. They stay in the subcontractor’s wallet; you read them while their access lasts. “Sighted” means someone looked at the original, never that Archova has checked it."
      />
      <WalletsCard />
      <RequestCard />
      <RequestsCard />
    </>
  );
}
