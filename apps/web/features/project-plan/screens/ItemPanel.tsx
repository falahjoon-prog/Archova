'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, Checkbox, Select, StatusPill, TextField, Textarea } from '@archova/ui';
import { X } from '@archova/ui/icons';
import { useProjectMembers } from '@/features/projects';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useLinkOptions, usePlanMutations } from '../hooks/useProjectPlan';
import {
  ITEM_TYPES,
  LINK_LABELS,
  LISTABLE_LINKS,
  STATUS_LABELS,
  TYPE_LABELS,
  TYPE_LINK,
  createRoute,
  humanise,
  linkTone,
  openRoute,
  type ItemStatus,
  type ItemType,
  type LinkType,
  type PlanItem,
  type ProjectPlan,
} from '../lib/labels';

const STATUSES: ItemStatus[] = ['not_started', 'in_progress', 'complete'];

/** One item's details beside the plan: edit it, assign people, link or create the records that do the work. */
export function ItemPanel({
  item,
  plan,
  onClose,
}: {
  item: PlanItem;
  plan: ProjectPlan;
  onClose: () => void;
}) {
  const { orgSlug } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const m = usePlanMutations();
  const edit = plan.canManage;
  const isHold = item.types.includes('hold_point');
  const [title, setTitle] = useState(item.title);
  const [outcome, setOutcome] = useState(item.outcome);
  const [due, setDue] = useState(item.dueDate ?? '');
  const [holdNote, setHoldNote] = useState('');
  const save = (patch: Parameters<typeof m.updateItem.mutate>[0]['patch']) =>
    m.updateItem.mutate({ itemId: item.id, patch });
  const dirty = title !== item.title || outcome !== item.outcome || due !== (item.dueDate ?? '');

  return (
    <aside className="plan-panel" aria-label={`${item.number} ${item.title}`}>
      <header className="plan-panel__head">
        <h2 className="plan-panel__title">
          <span className="u-mono">{item.number}</span> {item.title}
        </h2>
        <Button variant="tertiary" size="sm" onClick={onClose} aria-label="Close details">
          <X size={16} aria-hidden="true" />
        </Button>
      </header>

      <div className="stack">
        {item.blockedBy.length ? (
          <p className="plan-panel__blocked" role="status">
            <StatusPill tone="danger">Blocked</StatusPill> Hold point {item.blockedBy[0]!.number}{' '}
            {item.blockedBy[0]!.title} must be cleared before this can be completed.
          </p>
        ) : null}

        {isHold ? (
          <div className="stack plan-panel__hold">
            <StatusPill tone={item.holdCleared ? 'success' : 'danger'}>
              {item.holdCleared ? 'Hold point cleared' : 'Hold point'}
            </StatusPill>
            {item.holdCleared ? (
              item.holdNote ? (
                <p className="u-caption u-m-0">{item.holdNote}</p>
              ) : null
            ) : plan.canClearHolds ? (
              <>
                <Textarea
                  label="Note (optional)"
                  value={holdNote}
                  onChange={(e) => setHoldNote(e.target.value)}
                  rows={2}
                  maxLength={2000}
                />
                <Button
                  disabled={item.blockedBy.length > 0 || m.clearHold.isPending}
                  onClick={() => m.clearHold.mutate({ itemId: item.id, note: holdNote })}
                >
                  Clear hold point
                </Button>
              </>
            ) : (
              <p className="u-caption u-m-0">Only a project admin can clear a hold point.</p>
            )}
          </div>
        ) : null}

        {edit ? (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              save({ title: title.trim(), outcome: outcome.trim(), dueDate: due || null });
            }}
          >
            <TextField
              label="Item"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={300}
              required
            />
            <TextField
              label="Outcome or requirement"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              maxLength={1000}
            />
            <TextField
              label="Due date"
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
            <Button type="submit" variant="secondary" disabled={!dirty || !title.trim()}>
              Save changes
            </Button>
          </form>
        ) : (
          <p className="u-m-0">{item.outcome || 'No outcome set.'}</p>
        )}

        {!isHold ? (
          <Select
            label="Status"
            value={item.status}
            disabled={!edit}
            options={STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
            onChange={(e) => save({ status: e.target.value as ItemStatus })}
          />
        ) : null}

        <fieldset className="stack plan-panel__types" disabled={!edit}>
          <legend className="u-caption">Type</legend>
          {ITEM_TYPES.map((t) => (
            <Checkbox
              key={t}
              label={TYPE_LABELS[t]}
              checked={item.types.includes(t)}
              onChange={(e) =>
                save({
                  types: e.target.checked ? [...item.types, t] : item.types.filter((x) => x !== t),
                })
              }
            />
          ))}
        </fieldset>

        <Parties item={item} edit={edit} save={save} />

        <Links item={item} edit={edit} orgSlug={orgSlug} projectId={projectId} save={save} />

        <Requests item={item} edit={edit} />

        {edit ? (
          <Button
            variant="danger"
            onClick={() => {
              m.deleteItem.mutate(item.id);
              onClose();
            }}
          >
            Remove item
          </Button>
        ) : null}
      </div>
    </aside>
  );
}

type Save = (
  patch: Parameters<ReturnType<typeof usePlanMutations>['updateItem']['mutate']>[0]['patch'],
) => void;

function Parties({ item, edit, save }: { item: PlanItem; edit: boolean; save: Save }) {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const members = useProjectMembers(orgId, projectId).data?.data ?? [];
  const toInput = (parties: PlanItem['parties']) =>
    parties.map((p) => ({
      kind: p.kind,
      ...(p.companyId ? { companyId: p.companyId } : {}),
      userIds: p.userIds,
      label: p.label,
      confirmed: p.confirmed,
    }));
  const set = (n: number, patch: Partial<PlanItem['parties'][number]>) =>
    save({ parties: toInput(item.parties.map((p, i) => (i === n ? { ...p, ...patch } : p))) });
  return (
    <section className="stack" aria-label="Responsible parties">
      <h3 className="plan-panel__h">Responsible</h3>
      {item.parties.length === 0 ? <p className="u-caption u-m-0">Nobody assigned.</p> : null}
      {item.parties.map((p, n) => (
        <div key={n} className="plan-party">
          <strong>{p.kind === 'internal' ? 'Internal' : '3rd party'}</strong>
          <TextField
            label="Name or company"
            defaultValue={p.label}
            disabled={!edit}
            onBlur={(e) => e.target.value !== p.label && set(n, { label: e.target.value })}
          />
          <Select
            label="Assignee"
            value=""
            placeholder={
              p.userIds.length ? `${p.userIds.length} assigned · add another` : 'Add assignee'
            }
            disabled={!edit}
            options={members
              .filter((mm) => !p.userIds.includes(mm.userId))
              .map((mm) => ({ value: mm.userId, label: mm.name }))}
            onChange={(e) => e.target.value && set(n, { userIds: [...p.userIds, e.target.value] })}
          />
          {p.userIds.length ? (
            <ul className="plan-party__people">
              {p.userIds.map((u) => (
                <li key={u}>
                  {members.find((mm) => mm.userId === u)?.name ?? 'Member'}
                  {edit ? (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => set(n, { userIds: p.userIds.filter((x) => x !== u) })}
                    >
                      Remove
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          <Checkbox
            label="This party has confirmed"
            checked={p.confirmed}
            disabled={!edit}
            onChange={(e) => set(n, { confirmed: e.target.checked })}
          />
          {edit ? (
            <button
              type="button"
              className="link-button"
              onClick={() => save({ parties: toInput(item.parties.filter((_, i) => i !== n)) })}
            >
              Remove party
            </button>
          ) : null}
        </div>
      ))}
      {edit ? (
        <div className="row-actions">
          {(['internal', 'third_party'] as const).map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant="secondary"
              onClick={() =>
                save({
                  parties: [
                    ...toInput(item.parties),
                    { kind, userIds: [], label: '', confirmed: false },
                  ],
                })
              }
            >
              Add {kind === 'internal' ? 'internal' : '3rd party'}
            </Button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Links({
  item,
  edit,
  orgSlug,
  projectId,
  save,
}: {
  item: PlanItem;
  edit: boolean;
  orgSlug: string;
  projectId: string;
  save: Save;
}) {
  const suggested = item.types.map((t) => TYPE_LINK[t as ItemType]).find(Boolean) ?? null;
  const [picking, setPicking] = useState<LinkType | null>(null);
  const kinds: LinkType[] = [
    ...new Set([suggested, ...LISTABLE_LINKS].filter((k): k is LinkType => Boolean(k))),
  ];
  const [kind, setKind] = useState<LinkType>(
    suggested && LISTABLE_LINKS.includes(suggested) ? suggested : 'inspection',
  );
  const options = useLinkOptions(item.id, picking, '');
  const create = createRoute(kind, orgSlug, projectId);
  const toInput = (links: PlanItem['links']) => links.map((l) => ({ type: l.type, id: l.id }));
  return (
    <section className="stack" aria-label="Linked records">
      <h3 className="plan-panel__h">Linked records</h3>
      {item.links.length === 0 ? <p className="u-caption u-m-0">Nothing linked yet.</p> : null}
      <ul className="plan-links">
        {item.links.map((l) => {
          const href = openRoute(l, orgSlug, projectId);
          return (
            <li key={`${l.type}:${l.id}`}>
              <span className="u-caption">{LINK_LABELS[l.type]}</span>
              {href ? (
                <Link className="link" href={href}>
                  {l.ref ? `${l.ref} · ` : ''}
                  {l.label}
                </Link>
              ) : (
                <span>{l.label}</span>
              )}
              <StatusPill tone={linkTone(l.status)}>
                {l.status ? humanise(l.status) : 'Status unavailable'}
              </StatusPill>
              {edit ? (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => save({ links: toInput(item.links.filter((x) => x !== l)) })}
                >
                  Unlink
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {edit ? (
        <>
          <Select
            label="Kind of record"
            value={kind}
            options={kinds.map((k) => ({ value: k, label: LINK_LABELS[k] }))}
            onChange={(e) => {
              setKind(e.target.value as LinkType);
              setPicking(null);
            }}
          />
          <div className="row-actions">
            {create ? (
              <Link
                className="ac-button ac-button--secondary ac-button--sm"
                href={create}
                target="_blank"
                rel="noreferrer"
              >
                Create new {LINK_LABELS[kind].toLowerCase()}
              </Link>
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPicking(picking === kind ? null : kind)}
            >
              Link {LINK_LABELS[kind].toLowerCase()}
            </Button>
          </div>
          {picking ? (
            <div
              className="stack"
              role="group"
              aria-label={`Choose a ${LINK_LABELS[picking].toLowerCase()} to link`}
            >
              {options.isPending ? <p className="u-caption u-m-0">Loading…</p> : null}
              {options.data?.restricted ? (
                <p className="u-caption u-m-0">You can't see these records.</p>
              ) : null}
              {options.data && !options.data.restricted && options.data.data.length === 0 ? (
                <p className="u-caption u-m-0">Nothing to link yet.</p>
              ) : null}
              <ul className="plan-links">
                {(options.data?.data ?? []).slice(0, 12).map((o) => (
                  <li key={o.id}>
                    <span>
                      {o.ref} · {o.title}
                      {o.score >= 0.5 ? ' (likely match)' : ''}
                    </span>
                    <StatusPill tone={linkTone(o.status)}>{humanise(o.status)}</StatusPill>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={item.links.some((l) => l.id === o.id)}
                      onClick={() => {
                        save({ links: [...toInput(item.links), { type: o.type, id: o.id }] });
                        setPicking(null);
                      }}
                    >
                      Link
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function Requests({ item, edit }: { item: PlanItem; edit: boolean }) {
  const m = usePlanMutations();
  const [message, setMessage] = useState('');
  return (
    <section className="stack" aria-label="Requests">
      <h3 className="plan-panel__h">Requests</h3>
      {item.requests.length === 0 ? <p className="u-caption u-m-0">Nothing requested.</p> : null}
      <ul className="plan-links">
        {item.requests.map((r) => (
          <li key={r.id}>
            <span>
              {r.kind === 'photo' ? 'Photos' : 'Attachments'} requested
              {r.message ? `: ${r.message}` : ''}
            </span>
            <StatusPill tone={r.status === 'open' ? 'warning' : 'success'}>
              {r.status === 'open' ? 'Open' : 'Received'}
            </StatusPill>
          </li>
        ))}
      </ul>
      {edit ? (
        <>
          <TextField
            label="Message to the assignee"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={2000}
          />
          <div className="row-actions">
            {(['attachment', 'photo'] as const).map((kind) => (
              <Button
                key={kind}
                size="sm"
                variant="secondary"
                disabled={m.request.isPending}
                onClick={() => {
                  m.request.mutate({
                    itemId: item.id,
                    kind,
                    ...(message.trim() ? { message: message.trim() } : {}),
                  });
                  setMessage('');
                }}
              >
                Request {kind === 'photo' ? 'photos' : 'attachments'}
              </Button>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
