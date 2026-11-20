'use client';

import { useState, type FormEvent } from 'react';
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatusPill,
  TextField,
} from '@archova/ui';
import { Building2 } from '@archova/ui/icons';
import { SignOutButton } from '@/features/auth';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import type { ContractorLinkStatus } from '../data/api';
import {
  useCompanySearch,
  useContractorProfile,
  useMyLinks,
  useRemoveMyLink,
  useRequestLink,
  useSaveContractorProfile,
} from '../hooks/useContractors';

export const statusLabel: Record<ContractorLinkStatus, string> = {
  requested: 'Waiting for the company',
  accepted: 'Added',
  rejected: 'Declined',
  ended: 'Ended',
  cancelled: 'Cancelled',
  blocked: 'Declined',
};
const statusTone = {
  requested: 'warning',
  accepted: 'success',
  rejected: 'danger',
  ended: 'neutral',
  cancelled: 'neutral',
  blocked: 'danger',
} as const;

/** The contractor's home (free tier): set up a profile, find companies, see who has added them. */
export function ContractorPortalScreen() {
  const profile = useContractorProfile();
  return (
    <div className="stack">
      <PageHeader
        title="Contractor portal"
        description="Find the companies you work for and ask to be added. Companies only see what you share with them."
      />
      {profile.isPending ? (
        <SkeletonRows rows={4} />
      ) : profile.isError ? (
        <ErrorAlert error={profile.error} title="We couldn't load your profile" />
      ) : profile.data === null ? (
        <ProfileForm />
      ) : (
        <>
          <FindCompany />
          <MyCompanies />
        </>
      )}
      <div className="u-center">
        <SignOutButton />
      </div>
    </div>
  );
}

function ProfileForm() {
  const save = useSaveContractorProfile();
  const [displayName, setDisplayName] = useState('');
  const [profession, setProfession] = useState('');
  const [phone, setPhone] = useState('');
  const [missing, setMissing] = useState<{ displayName?: string; profession?: string }>({});

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const errors = {
      ...(displayName.trim() ? {} : { displayName: 'Enter the name companies will see.' }),
      ...(profession.trim()
        ? {}
        : { profession: 'Enter what you do, like electrician or certifier.' }),
    };
    setMissing(errors);
    if (Object.keys(errors).length) return;
    save.mutate({
      displayName: displayName.trim(),
      profession: profession.trim(),
      phone: phone.trim() || null,
    });
  }

  return (
    <Card title="Set up your contractor profile">
      <form className="stack" onSubmit={onSubmit} noValidate aria-label="Contractor profile">
        <ErrorAlert error={save.error} title="We couldn't save your profile" />
        <TextField
          label="Business or trading name"
          name="displayName"
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          error={missing.displayName}
        />
        <TextField
          label="What you do"
          name="profession"
          hint="Any profession: a trade, designer, engineer or certifier."
          required
          value={profession}
          onChange={(e) => setProfession(e.target.value)}
          error={missing.profession}
        />
        <TextField
          label="Phone (optional)"
          type="tel"
          name="phone"
          autoComplete="tel"
          hint="Companies see it only after they add you."
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <Button type="submit" loading={save.isPending}>
          Save profile
        </Button>
      </form>
    </Card>
  );
}

function FindCompany() {
  const [q, setQ] = useState('');
  const search = useCompanySearch(q);
  const request = useRequestLink();
  const term = q.trim();
  return (
    <Card title="Find a company">
      <div className="stack">
        <TextField
          label="Company name"
          name="company"
          type="search"
          autoComplete="off"
          hint="Type at least 3 letters. Only companies that chose to be found appear."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ErrorAlert error={search.error ?? request.error} title="We couldn't complete that" />
        {term.length >= 3 && search.isPending ? <SkeletonRows rows={2} /> : null}
        {search.data && search.data.length === 0 ? (
          <p className="u-muted">
            No company found with that name. Check the spelling, or ask them to turn on contractor
            search in Archova.
          </p>
        ) : null}
        {search.data && search.data.length > 0 ? (
          <ul className="inbox-list">
            {search.data.map((c) => (
              <li key={c.id} className="inbox-list__item">
                <div className="inbox-list__main">
                  <p className="inbox-list__title">{c.name}</p>
                  {c.abnLast3 ? <p className="inbox-list__body">ABN ending {c.abnLast3}</p> : null}
                </div>
                <div className="inbox-list__side">
                  {c.linkStatus && c.linkStatus !== 'ended' && c.linkStatus !== 'cancelled' ? (
                    <StatusPill tone={statusTone[c.linkStatus]}>
                      {statusLabel[c.linkStatus]}
                    </StatusPill>
                  ) : (
                    <Button
                      size="sm"
                      loading={request.isPending && request.variables === c.id}
                      onClick={() => request.mutate(c.id)}
                      aria-label={`Add ${c.name}`}
                    >
                      Add
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}

function MyCompanies() {
  const [q, setQ] = useState('');
  const links = useMyLinks(q);
  const remove = useRemoveMyLink();
  const rows = links.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <Card title="Your companies">
      <div className="stack">
        <TextField
          label="Filter by company name"
          name="filter"
          type="search"
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ErrorAlert error={links.error ?? remove.error} title="We couldn't load your companies" />
        {links.isPending ? (
          <SkeletonRows rows={3} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={q.trim() ? 'No matching companies' : 'No companies yet'}
            description="Search for a company above and press Add. They choose whether to accept."
          />
        ) : (
          <ul className="inbox-list">
            {rows.map((l) => (
              <li key={l.id} className="inbox-list__item">
                <div className="inbox-list__main">
                  <p className="inbox-list__title">{l.companyName}</p>
                </div>
                <div className="inbox-list__side">
                  <StatusPill tone={statusTone[l.status]}>{statusLabel[l.status]}</StatusPill>
                  {l.status === 'requested' || l.status === 'accepted' ? (
                    <Button
                      variant="tertiary"
                      size="sm"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(l.id)}
                      aria-label={`${l.status === 'requested' ? 'Cancel request to' : 'Leave'} ${l.companyName}`}
                    >
                      {l.status === 'requested' ? 'Cancel' : 'Leave'}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {links.hasNextPage ? (
          <Button
            variant="secondary"
            loading={links.isFetchingNextPage}
            onClick={() => links.fetchNextPage()}
          >
            Show more
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
