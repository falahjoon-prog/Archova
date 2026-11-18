'use client';

import { useMemo, useState, type FormEvent } from 'react';
import type { ProjectMember } from '@archova/contracts';
import { Button, Dialog, FilterBar, Select, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useUpdateProjectMember } from '../hooks/useProjectMutations';

const matches = (m: ProjectMember, company: string, q: string) =>
  [m.name, m.email, m.phone, m.jobTitle, m.trade, company].some((v) =>
    (v ?? '').toLowerCase().includes(q),
  );

/** The project directory: search by name, email, phone, title, trade or company, and filter by company or trade. */
export function MemberList({
  members,
  companyNames,
  templateNames,
  edit,
}: {
  members: readonly ProjectMember[];
  /** id → name, when the caller can read companies; otherwise the column shows a dash. */
  companyNames: ReadonlyMap<string, string>;
  templateNames: ReadonlyMap<string, string>;
  /** Present when the caller can manage members: enables editing phone, title and trade. */
  edit?: { orgId: string; projectId: string };
}) {
  const [q, setQ] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [trade, setTrade] = useState('');
  const [editing, setEditing] = useState<ProjectMember | null>(null);

  const trades = useMemo(
    () => [...new Set(members.map((m) => m.trade).filter((t): t is string => !!t))].sort(),
    [members],
  );
  const companyIds = useMemo(() => [...new Set(members.map((m) => m.companyId))], [members]);
  const needle = q.trim().toLowerCase();
  const shown = members.filter(
    (m) =>
      (!companyId || m.companyId === companyId) &&
      (!trade || m.trade === trade) &&
      (!needle || matches(m, companyNames.get(m.companyId) ?? '', needle)),
  );

  if (members.length === 0)
    return <p className="u-muted">No one has been added to this project yet.</p>;
  return (
    <div className="stack">
      <FilterBar label="Filter members">
        <TextField
          label="Search"
          type="search"
          name="q"
          placeholder="Name, email, phone, title or trade"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          label="Company"
          name="company"
          placeholder="All companies"
          options={companyIds.map((id) => ({
            value: id,
            label: companyNames.get(id) ?? 'Company',
          }))}
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
        />
        <Select
          label="Trade"
          name="trade"
          placeholder="All trades"
          options={trades.map((t) => ({ value: t, label: t }))}
          value={trade}
          onChange={(e) => setTrade(e.target.value)}
        />
      </FilterBar>
      {shown.length === 0 ? (
        <p className="u-muted" role="status">
          No one matches those filters.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="u-visually-hidden">Project members</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Title</th>
                <th scope="col">Company</th>
                <th scope="col">Trade</th>
                <th scope="col">Phone</th>
                <th scope="col">Email</th>
                <th scope="col">Permissions</th>
                {edit ? (
                  <th scope="col">
                    <span className="u-visually-hidden">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.id}>
                  <th scope="row">
                    {m.name}
                    {m.isExternal ? <span className="tag">External</span> : null}
                  </th>
                  <td>{m.jobTitle ?? '—'}</td>
                  <td>{companyNames.get(m.companyId) ?? '—'}</td>
                  <td>{m.trade ?? '—'}</td>
                  <td>
                    {m.phone ? (
                      <a href={`tel:${m.phone.replace(/[^+\d]/g, '')}`}>{m.phone}</a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{m.email}</td>
                  <td>{templateNames.get(m.permissionTemplateId) ?? '—'}</td>
                  {edit ? (
                    <td>
                      <Button variant="tertiary" size="sm" onClick={() => setEditing(m)}>
                        Edit<span className="u-visually-hidden"> {m.name}</span>
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && editing ? (
        <EditMemberDialog {...edit} member={editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function EditMemberDialog({
  orgId,
  projectId,
  member,
  onClose,
}: {
  orgId: string;
  projectId: string;
  member: ProjectMember;
  onClose: () => void;
}) {
  const update = useUpdateProjectMember(orgId, projectId);
  const [phone, setPhone] = useState(member.phone ?? '');
  const [jobTitle, setJobTitle] = useState(member.jobTitle ?? '');
  const [trade, setTrade] = useState(member.trade ?? '');
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    update.mutate(
      {
        memberId: member.id,
        body: {
          phone: phone.trim() || null,
          jobTitle: jobTitle.trim() || null,
          trade: trade.trim() || null,
        },
      },
      { onSuccess: onClose },
    );
  }
  return (
    <Dialog open onClose={onClose} title={`Directory details for ${member.name}`}>
      <form className="stack" onSubmit={onSubmit} aria-label="Directory details">
        <ErrorAlert error={update.error} title="We couldn't save those details" />
        <TextField
          label="Job title"
          name="jobTitle"
          maxLength={100}
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
        />
        <TextField
          label="Trade"
          name="trade"
          maxLength={100}
          value={trade}
          onChange={(e) => setTrade(e.target.value)}
        />
        <TextField
          label="Phone"
          name="phone"
          type="tel"
          maxLength={50}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <div>
          <Button type="submit" loading={update.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
