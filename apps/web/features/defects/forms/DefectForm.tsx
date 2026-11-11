'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Checkbox, NovaSuggestion, Select, TextField, Textarea } from '@archova/ui';
import { NovaIcon } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { LocationPicker } from '@/features/locations';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { MOCK_LOCATIONS, locationPath } from '@/shared/mocks/locations';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { DefectStatusPill } from '../components/DefectChips';
import { PinPlacer } from '../components/PinPlacer';
import { useDefectNova, useDefectsSource } from '../hooks/useDefects';
import { defectInputErrors } from '../lib/lifecycle';
import {
  PRIORITY_LABELS,
  STAGE_LABELS,
  formatDefectNumber,
  type DefectInput,
  type DefectPriority,
  type DefectStage,
} from '../lib/types';

const toggle = (list: string[], id: string, on: boolean) =>
  on ? [...new Set([...list, id])] : list.filter((x) => x !== id);

export const emptyDefectInput = (): DefectInput => ({
  title: '',
  description: '',
  priority: 'medium',
  trade: '',
  // Defaults from the project's current milestone; before PC that's pre-PC (DEF-US7).
  stage: 'pre_pc',
  locationId: null,
  drawing: null,
  assigneeCompanyId: null,
  assigneeUserId: null,
  assigneeUserIds: [],
  managerUserId: null,
  finalApproverUserId: null,
  distributionUserIds: [],
  approverDelegateUserId: null,
  approverDelegateFrom: null,
  approverDelegateUntil: null,
  requireCloseEvidence: false,
  dueDate: null,
  category: null,
  photos: [],
});

type AppliedFields = Pick<DefectInput, 'title' | 'description' | 'trade' | 'category' | 'priority'>;

const pickFields = (v: DefectInput): AppliedFields => ({
  title: v.title,
  description: v.description,
  trade: v.trade,
  category: v.category,
  priority: v.priority,
});

const sameFields = (a: AppliedFields, v: DefectInput) => {
  const b = pickFields(v);
  return (Object.keys(a) as Array<keyof AppliedFields>).every((k) => a[k] === b[k]);
};

export interface DefectFormProps {
  busy: boolean;
  error: unknown;
  /** `another` keeps location, trade and company for the next one in a walk (DEF-US2). */
  /** Starting values, e.g. a warranty claim opened from the warranty register. */
  initial?: Partial<DefectInput>;
  onSave: (
    input: DefectInput,
    meta: { aiSuggestionId: string | null; another: boolean },
  ) => Promise<unknown>;
}

/**
 * Raise a defect on the web. The server keeps a drawing pin, so live data asks for the drawing and a spot; preview
 * data uses the location tree. Nova suggests title, trade and priority (from the photo on live data) and checks for
 * duplicates beside the same spot; nothing applies until accepted, and the person picks the company.
 */
export function DefectForm({ busy, error, initial, onSave }: DefectFormProps) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const nova = useDefectNova();
  const { live } = useDefectsSource();
  const dir = useProjectDirectory();
  const [v, setV] = useState<DefectInput>(() => ({ ...emptyDefectInput(), ...initial }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [aiFields, setAiFields] = useState<Set<keyof DefectInput>>(new Set());
  const [fileKey, setFileKey] = useState(0);
  // The suggestion the person accepted, and the fields as Nova gave them, to tell "accepted" from "edited".
  const [applied, setApplied] = useState<{ id: string; fields: AppliedFields } | null>(null);

  const set = <K extends keyof DefectInput>(key: K, value: DefectInput[K]) => {
    setV((prev) => ({ ...prev, [key]: value }));
    setAiFields((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const subbies = dir.companies.filter((c) => c.isSubcontractor && dir.onProject(c.id));
  const trades = [...new Set([...subbies.flatMap((c) => c.trades), ...(v.trade ? [v.trade] : [])])];
  // Companies with the chosen trade first (DEF-AC1).
  const companies = [...subbies].sort(
    (a, b) =>
      Number(b.trades.includes(v.trade)) - Number(a.trades.includes(v.trade)) ||
      a.name.localeCompare(b.name),
  );
  const people = dir.people.filter((p) => p.companyId === v.assigneeCompanyId);
  const suggestion = nova.suggest.data;

  const save = (another: boolean) => (e?: FormEvent) => {
    e?.preventDefault();
    const found = defectInputErrors(v, live);
    setErrors(found);
    if (Object.keys(found).length) return;
    const suggestion = applied;
    void onSave(v, { aiSuggestionId: suggestion?.id ?? null, another }).then(() => {
      if (suggestion) {
        nova.decide.mutate({
          suggestionId: suggestion.id,
          decision: sameFields(suggestion.fields, v) ? 'accepted' : 'edited',
        });
      }
      setApplied(null);
      if (!another) return;
      setV((prev) => ({
        ...emptyDefectInput(),
        locationId: prev.locationId,
        drawing: prev.drawing,
        trade: prev.trade,
        assigneeCompanyId: prev.assigneeCompanyId,
        stage: prev.stage,
        warrantyItemId: prev.warrantyItemId ?? null,
        dueDate: prev.dueDate,
      }));
      setAiFields(new Set());
      setFileKey((k) => k + 1);
      nova.suggest.reset();
      nova.duplicates.reset();
    });
  };

  return (
    <form className="stack-lg rfi-form" onSubmit={save(false)} noValidate>
      <ErrorAlert error={error} title="We couldn't save this defect" />
      <Textarea
        label="What's wrong"
        rows={3}
        value={v.description}
        onChange={(e) => set('description', e.target.value)}
      />
      <div className="row-actions">
        <Button
          type="button"
          variant="nova"
          size="sm"
          disabled={
            live
              ? !v.photos.length || nova.suggest.isPending
              : !v.description.trim() || nova.suggest.isPending
          }
          onClick={() =>
            nova.suggest.mutate({
              description: v.description,
              photos: v.photos,
              drawing: v.drawing,
            })
          }
        >
          <NovaIcon size={16} aria-hidden="true" />
          {nova.suggest.isPending
            ? 'Thinking…'
            : live
              ? 'Suggest from photo'
              : 'Suggest title and trade'}
        </Button>
      </div>
      {nova.suggest.isSuccess ? (
        <NovaSuggestion
          title={suggestion ? 'Suggested details' : 'No suggestion'}
          actions={
            <>
              {suggestion ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    const next: DefectInput = {
                      ...v,
                      title: v.title || suggestion.title,
                      description: v.description || suggestion.description || '',
                      trade: suggestion.trade ?? v.trade,
                      category: suggestion.category ?? v.category,
                      priority: suggestion.priority ?? v.priority,
                      ...(suggestion.companyId
                        ? { assigneeCompanyId: suggestion.companyId, assigneeUserId: null }
                        : {}),
                    };
                    setV(next);
                    setApplied({ id: suggestion.id, fields: pickFields(next) });
                    setAiFields(
                      new Set<keyof DefectInput>([
                        ...(suggestion.trade ? (['trade'] as const) : []),
                        ...(suggestion.companyId ? (['assigneeCompanyId'] as const) : []),
                        ...(suggestion.priority ? (['priority'] as const) : []),
                        ...(v.title ? [] : (['title'] as const)),
                      ]),
                    );
                    nova.suggest.reset();
                  }}
                >
                  Use these
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="tertiary"
                onClick={() => {
                  if (suggestion)
                    nova.decide.mutate({ suggestionId: suggestion.id, decision: 'rejected' });
                  nova.suggest.reset();
                }}
              >
                Dismiss
              </Button>
            </>
          }
        >
          {suggestion ? (
            <p className="u-m-0">
              {[
                suggestion.title,
                suggestion.trade,
                suggestion.priority && `${PRIORITY_LABELS[suggestion.priority]} priority`,
                suggestion.companyId && dir.companyName(suggestion.companyId),
              ]
                .filter(Boolean)
                .join(' · ')}
              . Check the details and choose the company before you save.
              {suggestion.unsupportedNumbers.length
                ? ` Check these numbers against the drawing: ${suggestion.unsupportedNumbers.join(', ')}.`
                : ''}
            </p>
          ) : (
            <p className="u-m-0">
              Nova couldn&apos;t tell the trade from this {live ? 'photo' : 'description'}. Choose
              it below.
            </p>
          )}
        </NovaSuggestion>
      ) : null}

      <TextField
        label="Title"
        value={v.title}
        error={errors.title}
        aiFilled={aiFields.has('title')}
        required
        onChange={(e) => set('title', e.target.value)}
      />
      <div className="form-row">
        {live ? (
          <LocationPicker
            projectId={project.projectId}
            value={v.locationId}
            error={errors.location}
            suggestFrom={`${v.title} ${v.description}`}
            onChange={(id) => set('locationId', id)}
          />
        ) : (
          <Select
            label="Location"
            value={v.locationId ?? ''}
            placeholder="Choose a location"
            error={errors.location}
            required
            options={MOCK_LOCATIONS.map((l) => ({ value: l.id, label: l.path }))}
            onChange={(e) => set('locationId', e.target.value || null)}
          />
        )}
        <Select
          label="Trade"
          value={v.trade}
          placeholder="Choose a trade"
          className={aiFields.has('trade') ? 'ac-input--ai' : undefined}
          options={trades.map((t) => ({ value: t, label: t }))}
          onChange={(e) => set('trade', e.target.value)}
        />
        <Select
          label="Responsible company"
          value={v.assigneeCompanyId ?? ''}
          placeholder="Choose a company"
          error={errors.assigneeCompanyId}
          className={aiFields.has('assigneeCompanyId') ? 'ac-input--ai' : undefined}
          required
          options={companies.map((c) => ({
            value: c.id,
            label: `${c.name} · ${c.trades.join(', ')}`,
          }))}
          onChange={(e) => {
            set('assigneeCompanyId', e.target.value || null);
            set('assigneeUserId', null);
            set('assigneeUserIds', []);
            // A company with one trade fills it in; Nova's or the person's choice stays.
            const trades = dir.companies.find((c) => c.id === e.target.value)?.trades ?? [];
            if (!v.trade && trades.length === 1) set('trade', trades[0]!);
          }}
        />
        <Select
          label="Punch item manager"
          value={v.managerUserId ?? ''}
          placeholder="Choose a manager"
          options={dir.people.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(e) => set('managerUserId', e.target.value || null)}
        />
        <Select
          label="Final approver"
          value={v.finalApproverUserId ?? ''}
          placeholder="Anyone who can close"
          options={dir.people.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(e) => set('finalApproverUserId', e.target.value || null)}
        />
        <Select
          label="Stand-in while away (optional)"
          value={v.approverDelegateUserId ?? ''}
          placeholder="No stand-in"
          disabled={!v.finalApproverUserId}
          options={dir.people
            .filter((p) => p.id !== v.finalApproverUserId)
            .map((p) => ({ value: p.id, label: p.name }))}
          onChange={(e) => set('approverDelegateUserId', e.target.value || null)}
        />
        {v.approverDelegateUserId ? (
          <>
            <TextField
              label="Stand-in from"
              type="date"
              value={v.approverDelegateFrom ?? ''}
              onChange={(e) => set('approverDelegateFrom', e.target.value || null)}
            />
            <TextField
              label="Stand-in until"
              type="date"
              value={v.approverDelegateUntil ?? ''}
              onChange={(e) => set('approverDelegateUntil', e.target.value || null)}
            />
          </>
        ) : null}
        <TextField
          label="Due date"
          type="date"
          value={v.dueDate ?? ''}
          onChange={(e) => set('dueDate', e.target.value || null)}
        />
        <Select
          label="Stage"
          value={v.stage}
          options={(Object.keys(STAGE_LABELS) as DefectStage[]).map((s) => ({
            value: s,
            label: STAGE_LABELS[s],
          }))}
          onChange={(e) => set('stage', e.target.value as DefectStage)}
        />
        <Select
          label="Priority"
          value={v.priority}
          className={aiFields.has('priority') ? 'ac-input--ai' : undefined}
          options={(Object.keys(PRIORITY_LABELS) as DefectPriority[]).map((p) => ({
            value: p,
            label: PRIORITY_LABELS[p],
          }))}
          onChange={(e) => set('priority', e.target.value as DefectPriority)}
        />
      </div>
      <Checkbox
        label="Require a note or photo to close"
        checked={v.requireCloseEvidence}
        onChange={(e) => set('requireCloseEvidence', e.target.checked)}
      />
      <fieldset className="fieldset">
        <legend>Assignees</legend>
        {people.length ? (
          people.map((p) => (
            <Checkbox
              key={p.id}
              label={p.name}
              checked={v.assigneeUserIds.includes(p.id)}
              onChange={(e) => {
                const ids = toggle(v.assigneeUserIds, p.id, e.target.checked);
                set('assigneeUserIds', ids);
                set('assigneeUserId', ids[0] ?? null);
              }}
            />
          ))
        ) : (
          <p className="u-muted u-m-0">Choose a company to pick people at it.</p>
        )}
      </fieldset>
      <fieldset className="fieldset">
        <legend>Distribution members (told about changes, not assigned)</legend>
        {dir.people.map((p) => (
          <Checkbox
            key={p.id}
            label={p.name}
            checked={v.distributionUserIds.includes(p.id)}
            onChange={(e) =>
              set('distributionUserIds', toggle(v.distributionUserIds, p.id, e.target.checked))
            }
          />
        ))}
      </fieldset>
      {live ? (
        <PinPlacer value={v.drawing} onChange={(drawing) => set('drawing', drawing)} />
      ) : null}
      <div className="stack">
        <label className="ac-field__label" htmlFor="defect-photos">
          Photos
        </label>
        <input
          key={fileKey}
          id="defect-photos"
          className="file-input"
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => set('photos', [...(e.target.files ?? [])])}
        />
      </div>

      <div className="row-actions">
        <Button
          type="button"
          variant="nova"
          size="sm"
          disabled={!v.title.trim() || !(v.drawing || v.locationId) || nova.duplicates.isPending}
          onClick={() =>
            nova.duplicates.mutate({
              title: v.title,
              locationId: v.locationId,
              drawing: v.drawing,
            })
          }
        >
          <NovaIcon size={16} aria-hidden="true" />
          Check for duplicates
        </Button>
      </div>
      {nova.duplicates.data ? (
        nova.duplicates.data.length ? (
          <NovaSuggestion
            title={`Possible duplicates at ${(live ? null : locationPath(v.locationId)) ?? 'this spot'}`}
          >
            <ul className="plain-list">
              {nova.duplicates.data.map((d) => (
                <li key={d.id} className="row-actions">
                  <Link
                    className="link u-mono"
                    href={webRoutes.defect(org.orgSlug, project.projectId, d.id)}
                  >
                    {formatDefectNumber(d.number)}
                  </Link>
                  <span>{d.title}</span>
                  <DefectStatusPill status={d.status} />
                </li>
              ))}
            </ul>
          </NovaSuggestion>
        ) : (
          <Alert tone="success" title="No open defects like this at that spot" />
        )
      ) : null}

      <div className="row-actions">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save defect'}
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => save(true)()}>
          Save and add another
        </Button>
      </div>
    </form>
  );
}
