'use client';

import { useState } from 'react';
import { Button, Checkbox, Dialog, EmptyState, SkeletonRows, TextField } from '@archova/ui';
import { Plus, EstimatingIcon } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import type { BidderList } from '../data/bidders-api';
import {
  useBidderListMutations,
  useBidderLists,
  useSubcontractorCompanies,
} from '../hooks/useBidderLists';

const EMPTY = { name: '', trade: '', companyIds: [] as string[] };

/** The company's reusable bidder lists: who the estimator usually invites for a trade. */
export function BidderLists() {
  const lists = useBidderLists();
  const companies = useSubcontractorCompanies();
  const m = useBidderListMutations();
  const [editing, setEditing] = useState<BidderList | 'new' | null>(null);
  const [form, setForm] = useState(EMPTY);
  const nameOf = (id: string) =>
    companies.data?.find((c) => c.id === id)?.name ?? 'Unknown company';
  const saving = m.create.isPending || m.update.isPending;

  const open = (l: BidderList | 'new') => {
    setForm(l === 'new' ? EMPTY : { name: l.name, trade: l.trade, companyIds: l.companyIds });
    m.create.reset();
    m.update.reset();
    setEditing(l);
  };
  const save = () => {
    const done = { onSuccess: () => setEditing(null) };
    if (editing === 'new') m.create.mutate(form, done);
    else if (editing) m.update.mutate({ list: editing, body: form }, done);
  };

  return (
    <section className="stack" aria-labelledby="bidder-lists">
      <div className="row-actions">
        <h2 id="bidder-lists" className="panel-heading">
          Bidder lists
        </h2>
        <Button variant="secondary" onClick={() => open('new')}>
          <Plus size={16} aria-hidden="true" /> New list
        </Button>
      </div>
      <p className="u-muted u-m-0">
        Save the subcontractors you usually invite for a trade, then tick a whole list when you send
        a package out.
      </p>
      <ErrorAlert error={lists.error ?? m.remove.error} title="We couldn't load bidder lists" />
      {lists.isPending ? (
        <SkeletonRows label="Loading bidder lists…" />
      ) : lists.data?.length ? (
        <ul className="plain-list">
          {lists.data.map((l) => (
            <li key={l.id} className="plain-list__item row-actions">
              <span>
                <strong>{l.name}</strong>
                <span className="u-muted">
                  {' '}
                  {l.trade ? `${l.trade} · ` : ''}
                  {l.companyIds.length} {l.companyIds.length === 1 ? 'company' : 'companies'}
                </span>
              </span>
              <span className="row-actions">
                <Button variant="secondary" onClick={() => open(l)}>
                  Edit
                </Button>
                <Button
                  variant="secondary"
                  disabled={m.remove.isPending}
                  onClick={() => m.remove.mutate(l)}
                >
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={EstimatingIcon}
          title="No bidder lists yet"
          description="Make one per trade, for example your usual tilers."
        />
      )}
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New bidder list' : 'Edit bidder list'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button disabled={!form.name.trim() || saving} onClick={save}>
              Save list
            </Button>
          </>
        }
      >
        <div className="stack">
          <TextField
            label="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <TextField
            label="Trade"
            value={form.trade}
            onChange={(e) => setForm({ ...form, trade: e.target.value })}
          />
          <fieldset className="stack">
            <legend>Subcontractors</legend>
            {companies.data?.length ? (
              companies.data.map((c) => (
                <Checkbox
                  key={c.id}
                  label={c.name}
                  checked={form.companyIds.includes(c.id)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      companyIds: e.target.checked
                        ? [...form.companyIds, c.id]
                        : form.companyIds.filter((id) => id !== c.id),
                    })
                  }
                />
              ))
            ) : (
              <p className="u-muted u-m-0">No subcontractor companies in your directory yet.</p>
            )}
            {form.companyIds
              .filter((id) => !companies.data?.some((c) => c.id === id))
              .map((id) => (
                <span key={id} className="u-muted">
                  {nameOf(id)}
                </span>
              ))}
          </fieldset>
          <ErrorAlert error={m.create.error ?? m.update.error} title="We couldn't save the list" />
        </div>
      </Dialog>
    </section>
  );
}
