'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Checkbox, NovaSuggestion, Select, TextField, Textarea } from '@archova/ui';
import { NovaIcon } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { useMarkupPicker, useSheetPicker } from '@/features/drawings';
import { SpecSectionField } from '@/features/specifications';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { businessDaysBetween, dueInBusinessDays, todayIn } from '@/shared/lib/format';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { RfiStatusPill } from '../components/RfiChips';
import { useRfiNova } from '../hooks/useRfis';
import { submitErrors } from '../lib/lifecycle';
import { referenceCitations } from '../lib/references';
import {
  formatRfiNumber,
  type CostImpact,
  type NovaWording,
  type NovaRfiDraft,
  type RfiInput,
} from '../lib/types';

const GAP_LABELS: Record<string, string> = {
  location: 'where it is',
  drawing_reference: 'which drawing',
  proposed_solution: 'what you propose',
  impact: 'the cost or time impact',
};

/** RFI-AC3: the project setting defaults to 5 business days. */
export const DEFAULT_DUE_BUSINESS_DAYS = 5;

export function emptyRfiInput(today: string): RfiInput {
  return {
    subject: '',
    question: '',
    assigneeId: null,
    dueDate: dueInBusinessDays(today, DEFAULT_DUE_BUSINESS_DAYS),
    distributionCompanyIds: [],
    costImpact: 'tbc',
    scheduleImpactDays: null,
    drawing: null,
    specSection: null,
    location: null,
    isPrivate: false,
  };
}

export interface RfiFormProps {
  initial: RfiInput;
  busy: boolean;
  error: unknown;
  onSaveDraft: (input: RfiInput) => void;
  onSubmit: (input: RfiInput) => void;
}

/**
 * New RFI and draft editing (F1.4 step 1–2). Submit needs subject, question, assignee and due date (RFI-AC2);
 * a draft only needs a subject. Nova can improve the question and look for similar RFIs; neither changes the form
 * until the user accepts (P6), and Nova never submits.
 */
export function RfiForm({ initial, busy, error, onSaveDraft, onSubmit }: RfiFormProps) {
  const dir = useProjectDirectory();
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const today = todayIn(project.timezone);
  const sheets = useSheetPicker(project.projectId);
  const nova = useRfiNova(project.projectId);
  const [v, setV] = useState<RfiInput>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [improved, setImproved] = useState<NovaWording | null>(null);
  const [questionFromNova, setQuestionFromNova] = useState(false);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [markupSheet, setMarkupSheet] = useState('');
  const [markupId, setMarkupId] = useState('');
  const markupRevision = sheets.options.find((o) => o.sheetId === markupSheet)?.revisionId;
  const markups = useMarkupPicker(project.projectId, markupRevision);
  const [draft, setDraft] = useState<NovaRfiDraft | null>(null);

  const set = <K extends keyof RfiInput>(key: K, value: RfiInput[K]) =>
    setV((prev) => ({ ...prev, [key]: value }));

  const dueDays = v.dueDate ? businessDaysBetween(today, v.dueDate) : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = submitErrors(v);
    setErrors(found);
    if (Object.keys(found).length === 0) onSubmit(v);
  };

  const saveDraft = () => {
    if (!v.subject.trim()) {
      setErrors({ subject: 'Add a subject to save a draft.' });
      return;
    }
    setErrors({});
    onSaveDraft(v);
  };

  const similar = nova.similar.data;

  return (
    <form className="stack-lg rfi-form" onSubmit={submit} noValidate>
      {Object.keys(errors).length > 1 ? (
        <Alert tone="danger" title="Fill in the required fields">
          Subject, question, who should answer and the due date are needed to submit.
        </Alert>
      ) : null}
      <ErrorAlert error={error} title="We couldn't save this RFI" />

      <section className="stack" aria-labelledby="rfi-question">
        <h2 id="rfi-question" className="panel-heading">
          Question
        </h2>
        <Textarea
          label="What did you find on site?"
          rows={3}
          value={note}
          hint="A few words are enough. Nova drafts the subject and question from them; you edit and send."
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="form-row">
          <div className="stack">
            <label className="ac-field__label" htmlFor="rfi-photo">
              Site photo (optional)
            </label>
            <input
              id="rfi-photo"
              className="file-input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            />
          </div>
          <Select
            label="Drawing markup (optional)"
            value={markupSheet}
            placeholder={sheets.isPending ? 'Loading drawings…' : 'No markup'}
            options={sheets.options.map((s) => ({
              value: s.sheetId,
              label: `${s.label} · ${s.title}`,
            }))}
            onChange={(e) => {
              setMarkupSheet(e.target.value);
              setMarkupId('');
            }}
          />
          {markupSheet ? (
            <Select
              label="Markup"
              value={markupId}
              placeholder={
                markups.isPending
                  ? 'Loading markups…'
                  : markups.options.length
                    ? 'Choose a markup'
                    : 'No markups on this sheet'
              }
              options={markups.options.map((m) => ({ value: m.markupId, label: m.label }))}
              onChange={(e) => setMarkupId(e.target.value)}
            />
          ) : null}
        </div>
        <div>
          <Button
            type="button"
            variant="nova"
            size="sm"
            disabled={(!note.trim() && !photo && !markupId) || nova.draftRfi.isPending}
            onClick={() =>
              nova.draftRfi.mutate(
                {
                  note,
                  photo,
                  markup:
                    markupId && markupRevision ? { revisionId: markupRevision, markupId } : null,
                },
                { onSuccess: setDraft },
              )
            }
          >
            <NovaIcon size={16} aria-hidden="true" />
            {nova.draftRfi.isPending ? 'Drafting…' : 'Draft with Nova'}
          </Button>
        </div>
        <ErrorAlert error={nova.draftRfi.error} title="Nova couldn't draft an RFI" />
        {draft ? (
          <NovaSuggestion
            title="Drafted RFI"
            citations={referenceCitations(draft.references, org.orgSlug, project.projectId)}
            actions={
              <>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setV((prev) => ({
                      ...prev,
                      subject: draft.subject,
                      question: draft.question,
                      drawing: draft.drawing
                        ? {
                            sheetId:
                              sheets.options.find((o) => o.revisionId === draft.drawing!.revisionId)
                                ?.sheetId ?? '',
                            revisionId: draft.drawing.revisionId,
                            label: draft.drawing.label,
                            pin: { x: draft.drawing.x, y: draft.drawing.y },
                          }
                        : prev.drawing,
                      nova: {
                        suggestionId: draft.suggestionId,
                        subject: draft.subject,
                        question: draft.question,
                      },
                    }));
                    setQuestionFromNova(true);
                    setDraft(null);
                  }}
                >
                  Use this draft
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="tertiary"
                  onClick={() => {
                    nova.decide.mutate({ id: draft.suggestionId, decision: 'rejected' });
                    setDraft(null);
                  }}
                >
                  Discard
                </Button>
              </>
            }
          >
            <p className="u-m-0">
              <strong>{draft.subject}</strong>
            </p>
            <p className="u-m-0">{draft.question}</p>
            {draft.gaps.length ? (
              <p className="u-caption u-m-0">
                Still to add: {draft.gaps.map((g) => GAP_LABELS[g] ?? g).join(', ')}.
              </p>
            ) : null}
            {draft.unsupportedNumbers.length ? (
              <p className="u-caption u-m-0">
                Check these numbers, they aren&apos;t in your note or the drawings:{' '}
                {draft.unsupportedNumbers.join(', ')}.
              </p>
            ) : null}
            {draft.drawing?.scanned ? (
              <p className="u-caption u-m-0">
                The sheet was read from a scan, so check the quoted text against the drawing.
              </p>
            ) : null}
          </NovaSuggestion>
        ) : null}
        <TextField
          label="Subject"
          value={v.subject}
          error={errors.subject}
          required
          onChange={(e) => set('subject', e.target.value)}
        />
        <Textarea
          label="Question"
          rows={6}
          value={v.question}
          error={errors.question}
          aiFilled={questionFromNova}
          required
          onChange={(e) => {
            set('question', e.target.value);
            setQuestionFromNova(false);
          }}
        />
        <div className="row-actions">
          <Button
            type="button"
            variant="nova"
            size="sm"
            disabled={!v.question.trim() || nova.improveQuestion.isPending}
            onClick={() => nova.improveQuestion.mutate(v.question, { onSuccess: setImproved })}
          >
            <NovaIcon size={16} aria-hidden="true" />
            {nova.improveQuestion.isPending ? 'Improving…' : 'Improve question'}
          </Button>
          <Button
            type="button"
            variant="nova"
            size="sm"
            disabled={!v.subject.trim() || nova.similar.isPending}
            onClick={() => nova.similar.mutate(v.subject)}
          >
            <NovaIcon size={16} aria-hidden="true" />
            {nova.similar.isPending ? 'Checking…' : 'Check for similar RFIs'}
          </Button>
        </div>
        <ErrorAlert
          error={nova.improveQuestion.error ?? nova.similar.error}
          title="Nova couldn't help with that"
        />
        {improved ? (
          <NovaSuggestion
            title="Suggested wording"
            actions={
              <>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    set('question', improved.text);
                    setQuestionFromNova(true);
                    setImproved(null);
                  }}
                >
                  Use this wording
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="tertiary"
                  onClick={() => setImproved(null)}
                >
                  Discard
                </Button>
              </>
            }
          >
            <p className="u-m-0">{improved.text}</p>
          </NovaSuggestion>
        ) : null}
        {similar ? (
          <NovaSuggestion
            title={similar.length ? 'Similar RFIs on this project' : 'No similar RFIs found'}
            actions={
              <Button
                type="button"
                size="sm"
                variant="tertiary"
                onClick={() => nova.similar.reset()}
              >
                Dismiss
              </Button>
            }
          >
            {similar.length ? (
              <ul className="plain-list">
                {similar.map((r) => (
                  <li key={r.id} className="row-actions">
                    <Link
                      className="link u-mono"
                      href={webRoutes.rfi(org.orgSlug, project.projectId, r.id)}
                    >
                      {formatRfiNumber(r.number)}
                    </Link>
                    <span>{r.subject}</span>
                    <RfiStatusPill status={r.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="u-m-0">Nothing on this project looks like the same question.</p>
            )}
          </NovaSuggestion>
        ) : null}
      </section>

      <section className="stack" aria-labelledby="rfi-routing">
        <h2 id="rfi-routing" className="panel-heading">
          Who answers and when
        </h2>
        <div className="form-row">
          <Select
            label="Assignee"
            value={v.assigneeId ?? ''}
            placeholder="Choose a person"
            error={errors.assigneeId}
            required
            options={dir.people.map((p) => ({
              value: p.id,
              label: `${p.name} · ${dir.companyName(p.companyId)}`,
            }))}
            onChange={(e) => set('assigneeId', e.target.value || null)}
          />
          <TextField
            label="Due date"
            type="date"
            value={v.dueDate ?? ''}
            min={today}
            error={errors.dueDate}
            hint={
              dueDays === null
                ? undefined
                : `${dueDays} business ${Math.abs(dueDays) === 1 ? 'day' : 'days'} from today`
            }
            required
            onChange={(e) => set('dueDate', e.target.value || null)}
          />
        </div>
        <fieldset className="fieldset">
          <legend>Distribution</legend>
          <div className="check-grid">
            {dir.companies
              .filter((c) => !c.isBuilder)
              .map((c) => (
                <Checkbox
                  key={c.id}
                  label={c.name}
                  checked={v.distributionCompanyIds.includes(c.id)}
                  onChange={(e) =>
                    set(
                      'distributionCompanyIds',
                      e.target.checked
                        ? [...v.distributionCompanyIds, c.id]
                        : v.distributionCompanyIds.filter((id) => id !== c.id),
                    )
                  }
                />
              ))}
          </div>
        </fieldset>
        <Checkbox
          label="Keep private to the builder"
          hint="Only your company sees it until you turn this off."
          checked={v.isPrivate}
          onChange={(e) => set('isPrivate', e.target.checked)}
        />
      </section>

      <section className="stack" aria-labelledby="rfi-refs">
        <h2 id="rfi-refs" className="panel-heading">
          References and impact
        </h2>
        <div className="form-row">
          <Select
            label="Drawing"
            value={v.drawing?.sheetId ?? ''}
            placeholder={sheets.isPending ? 'Loading drawings…' : 'No drawing'}
            options={sheets.options.map((s) => ({
              value: s.sheetId,
              label: `${s.label} · ${s.title}`,
            }))}
            onChange={(e) => {
              const s = sheets.options.find((o) => o.sheetId === e.target.value);
              set(
                'drawing',
                s ? { sheetId: s.sheetId, revisionId: s.revisionId, label: s.label } : null,
              );
            }}
          />
          <SpecSectionField
            placeholder="03 30 00 Cast-in-place concrete"
            value={v.specSection ?? ''}
            onChange={(x) => set('specSection', x || null)}
          />
          <TextField
            label="Location"
            placeholder="Level 2, grid C"
            value={v.location ?? ''}
            onChange={(e) => set('location', e.target.value || null)}
          />
          <Select
            label="Cost impact"
            value={v.costImpact ?? ''}
            options={[
              { value: 'tbc', label: 'To be confirmed' },
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
            ]}
            onChange={(e) => set('costImpact', (e.target.value || null) as CostImpact | null)}
          />
          <TextField
            label="Delay (days)"
            type="number"
            min={0}
            inputMode="numeric"
            value={v.scheduleImpactDays ?? ''}
            hint="Days of delay caused by waiting on this answer."
            onChange={(e) =>
              set(
                'scheduleImpactDays',
                e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
              )
            }
          />
        </div>
      </section>

      <div className="row-actions">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Submit RFI'}
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={saveDraft}>
          Save draft
        </Button>
      </div>
    </form>
  );
}
