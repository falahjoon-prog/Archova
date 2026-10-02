'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Alert, Button, NovaSuggestion, Select, TextField, Textarea } from '@archova/ui';
import { NovaIcon } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { MOCK_COMPANIES, MOCK_PEOPLE, companyName } from '@/shared/mocks/directory';
import { MOCK_LOCATIONS, locationPath } from '@/shared/mocks/locations';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { DefectStatusPill } from '../components/DefectChips';
import { useDefectNova } from '../hooks/useDefects';
import { defectInputErrors } from '../lib/lifecycle';
import {
  PRIORITY_LABELS,
  STAGE_LABELS,
  formatDefectNumber,
  type DefectInput,
  type DefectPriority,
  type DefectStage,
} from '../lib/types';

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
  dueDate: null,
  photoNames: [],
});

const SUBBIES = MOCK_COMPANIES.filter((c) => c.role === 'subcontractor');
const TRADES = [...new Set(SUBBIES.map((c) => c.trade))];

export interface DefectFormProps {
  busy: boolean;
  error: unknown;
  /** `another` keeps location, trade and company for the next one in a walk (DEF-US2). */
  onSave: (
    input: DefectInput,
    meta: { aiSuggested: boolean; another: boolean },
  ) => Promise<unknown>;
}

/**
 * Raise a defect on the web. Phones capture with a drawing pin (Mia); here the location tree is the reference and
 * the pin can be dropped from the drawing later. Nova suggests title, trade and company from the description, and
 * checks for duplicates at the same location; nothing applies until accepted.
 */
export function DefectForm({ busy, error, onSave }: DefectFormProps) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const nova = useDefectNova();
  const [v, setV] = useState<DefectInput>(emptyDefectInput);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [aiFields, setAiFields] = useState<Set<keyof DefectInput>>(new Set());
  const [fileKey, setFileKey] = useState(0);

  const set = <K extends keyof DefectInput>(key: K, value: DefectInput[K]) => {
    setV((prev) => ({ ...prev, [key]: value }));
    setAiFields((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  // Companies with the chosen trade first (DEF-AC1).
  const companies = [...SUBBIES].sort(
    (a, b) =>
      Number(b.trade === v.trade) - Number(a.trade === v.trade) || a.name.localeCompare(b.name),
  );
  const people = MOCK_PEOPLE.filter((p) => p.companyId === v.assigneeCompanyId);
  const suggestion = nova.suggest.data;

  const save = (another: boolean) => (e?: FormEvent) => {
    e?.preventDefault();
    const found = defectInputErrors(v);
    setErrors(found);
    if (Object.keys(found).length) return;
    void onSave(v, { aiSuggested: aiFields.size > 0, another }).then(() => {
      if (!another) return;
      setV((prev) => ({
        ...emptyDefectInput(),
        locationId: prev.locationId,
        trade: prev.trade,
        assigneeCompanyId: prev.assigneeCompanyId,
        stage: prev.stage,
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
          disabled={!v.description.trim() || nova.suggest.isPending}
          onClick={() => nova.suggest.mutate(v.description)}
        >
          <NovaIcon size={16} aria-hidden="true" />
          {nova.suggest.isPending ? 'Thinking…' : 'Suggest title and trade'}
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
                    setV((prev) => ({
                      ...prev,
                      title: prev.title || suggestion.title,
                      trade: suggestion.trade,
                      assigneeCompanyId: suggestion.companyId,
                      assigneeUserId: null,
                    }));
                    setAiFields(
                      new Set<keyof DefectInput>([
                        'trade',
                        'assigneeCompanyId',
                        ...(v.title ? [] : ['title' as const]),
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
                onClick={() => nova.suggest.reset()}
              >
                Dismiss
              </Button>
            </>
          }
        >
          {suggestion ? (
            <p className="u-m-0">
              {suggestion.title} · {suggestion.trade} · {companyName(suggestion.companyId)}. Check
              the company before you save.
            </p>
          ) : (
            <p className="u-m-0">
              Nova couldn&apos;t tell the trade from this description. Choose it below.
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
        <Select
          label="Location"
          value={v.locationId ?? ''}
          placeholder="Choose a location"
          error={errors.location}
          required
          options={MOCK_LOCATIONS.map((l) => ({ value: l.id, label: l.path }))}
          onChange={(e) => set('locationId', e.target.value || null)}
        />
        <Select
          label="Trade"
          value={v.trade}
          placeholder="Choose a trade"
          className={aiFields.has('trade') ? 'ac-input--ai' : undefined}
          options={TRADES.map((t) => ({ value: t, label: t }))}
          onChange={(e) => set('trade', e.target.value)}
        />
        <Select
          label="Responsible company"
          value={v.assigneeCompanyId ?? ''}
          placeholder="Choose a company"
          error={errors.assigneeCompanyId}
          className={aiFields.has('assigneeCompanyId') ? 'ac-input--ai' : undefined}
          required
          options={companies.map((c) => ({ value: c.id, label: `${c.name} · ${c.trade}` }))}
          onChange={(e) => {
            set('assigneeCompanyId', e.target.value || null);
            set('assigneeUserId', null);
          }}
        />
        <Select
          label="Person (optional)"
          value={v.assigneeUserId ?? ''}
          placeholder={people.length ? 'Anyone at the company' : 'No people listed'}
          disabled={!people.length}
          options={people.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(e) => set('assigneeUserId', e.target.value || null)}
        />
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
          options={(Object.keys(PRIORITY_LABELS) as DefectPriority[]).map((p) => ({
            value: p,
            label: PRIORITY_LABELS[p],
          }))}
          onChange={(e) => set('priority', e.target.value as DefectPriority)}
        />
      </div>
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
          onChange={(e) =>
            set(
              'photoNames',
              [...(e.target.files ?? [])].map((f) => f.name),
            )
          }
        />
      </div>

      <div className="row-actions">
        <Button
          type="button"
          variant="nova"
          size="sm"
          disabled={!v.title.trim() || !v.locationId || nova.duplicates.isPending}
          onClick={() =>
            nova.duplicates.mutate({ title: v.title, locationId: v.locationId, sheetId: null })
          }
        >
          <NovaIcon size={16} aria-hidden="true" />
          Check for duplicates
        </Button>
      </div>
      {nova.duplicates.data ? (
        nova.duplicates.data.length ? (
          <NovaSuggestion
            title={`Possible duplicates at ${locationPath(v.locationId) ?? 'this location'}`}
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
          <Alert tone="success" title="No open defects like this at that location" />
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
