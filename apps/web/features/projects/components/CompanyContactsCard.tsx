'use client';

import { useState, type FormEvent } from 'react';
import type { CompanyContact } from '@archova/contracts';
import { Button, Dialog, FilterBar, Select, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { Loading } from '@/shared/layout/Loading';
import { useDeleteCompanyContact, useSaveCompanyContact } from '../hooks/useProjectMutations';
import { useCompanyContacts } from '../hooks/useProjectMutations';

/**
 * People at companies who have no login (a supplier's office line, an accounts contact). They belong to the org, so
 * one entry serves every project; nobody is re-entered per project.
 */
export function CompanyContactsCard({
  orgId,
  companies,
  canManage,
}: {
  orgId: string;
  companies: ReadonlyMap<string, string>;
  canManage: boolean;
}) {
  const contacts = useCompanyContacts(orgId);
  const del = useDeleteCompanyContact(orgId);
  const [q, setQ] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [editing, setEditing] = useState<CompanyContact | 'new' | null>(null);

  if (contacts.isPending) return <Loading label="Loading company contacts…" />;
  if (contacts.isError)
    return <ErrorAlert error={contacts.error} title="We couldn't load company contacts" />;

  const needle = q.trim().toLowerCase();
  const shown = contacts.data.data.filter(
    (c) =>
      (!companyId || c.companyId === companyId) &&
      (!needle ||
        [c.name, c.email, c.phone, c.jobTitle, companies.get(c.companyId)].some((v) =>
          (v ?? '').toLowerCase().includes(needle),
        )),
  );
  return (
    <div className="stack">
      {canManage ? (
        <div>
          <Button variant="secondary" onClick={() => setEditing('new')}>
            Add contact
          </Button>
        </div>
      ) : null}
      <ErrorAlert error={del.error} title="We couldn't delete that contact" />
      <FilterBar label="Filter company contacts">
        <TextField
          label="Search"
          type="search"
          name="contactQ"
          placeholder="Name, email, phone or title"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          label="Company"
          name="contactCompany"
          placeholder="All companies"
          options={[...companies].map(([value, label]) => ({ value, label }))}
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
        />
      </FilterBar>
      {shown.length === 0 ? (
        <p className="u-muted" role="status">
          {contacts.data.data.length === 0
            ? 'No company contacts yet. Add the office numbers and emails you call most.'
            : 'No contacts match those filters.'}
        </p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="u-visually-hidden">Company contacts</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Title</th>
                <th scope="col">Company</th>
                <th scope="col">Phone</th>
                <th scope="col">Email</th>
                {canManage ? (
                  <th scope="col">
                    <span className="u-visually-hidden">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id}>
                  <th scope="row">{c.name}</th>
                  <td>{c.jobTitle ?? '—'}</td>
                  <td>{companies.get(c.companyId) ?? '—'}</td>
                  <td>
                    {c.phone ? (
                      <a href={`tel:${c.phone.replace(/[^+\d]/g, '')}`}>{c.phone}</a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : '—'}</td>
                  {canManage ? (
                    <td>
                      <Button variant="tertiary" size="sm" onClick={() => setEditing(c)}>
                        Edit<span className="u-visually-hidden"> {c.name}</span>
                      </Button>
                      <Button
                        variant="tertiary"
                        size="sm"
                        loading={del.isPending && del.variables === c.id}
                        onClick={() => del.mutate(c.id)}
                      >
                        Delete<span className="u-visually-hidden"> {c.name}</span>
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing ? (
        <ContactDialog
          orgId={orgId}
          companies={companies}
          contact={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function ContactDialog({
  orgId,
  companies,
  contact,
  onClose,
}: {
  orgId: string;
  companies: ReadonlyMap<string, string>;
  contact: CompanyContact | null;
  onClose: () => void;
}) {
  const save = useSaveCompanyContact(orgId);
  const [companyId, setCompanyId] = useState(contact?.companyId ?? '');
  const [name, setName] = useState(contact?.name ?? '');
  const [email, setEmail] = useState(contact?.email ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [jobTitle, setJobTitle] = useState(contact?.jobTitle ?? '');
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) return setError('Enter the person’s name.');
    if (!contact && !companyId) return setError('Choose the company they work for.');
    setError(null);
    const fields = {
      name: name.trim(),
      email: email.trim() || null,
      phone: phone.trim() || null,
      jobTitle: jobTitle.trim() || null,
    };
    save.mutate(
      contact
        ? { id: contact.id, body: fields }
        : {
            body: {
              companyId,
              name: fields.name,
              ...(fields.email ? { email: fields.email } : {}),
              ...(fields.phone ? { phone: fields.phone } : {}),
              ...(fields.jobTitle ? { jobTitle: fields.jobTitle } : {}),
            },
          },
      { onSuccess: onClose },
    );
  }
  return (
    <Dialog open onClose={onClose} title={contact ? 'Edit contact' : 'Add contact'}>
      <form className="stack" onSubmit={onSubmit} noValidate aria-label="Company contact">
        <ErrorAlert error={save.error} title="We couldn't save that contact" />
        {error ? <p role="alert">{error}</p> : null}
        {contact ? null : (
          <Select
            label="Company"
            name="companyId"
            placeholder="Choose a company"
            options={[...companies].map(([value, label]) => ({ value, label }))}
            required
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
          />
        )}
        <TextField
          label="Name"
          name="name"
          required
          maxLength={200}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          label="Job title"
          name="jobTitle"
          maxLength={100}
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
        />
        <TextField
          label="Phone"
          name="phone"
          type="tel"
          maxLength={50}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <TextField
          label="Email"
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div>
          <Button type="submit" loading={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
