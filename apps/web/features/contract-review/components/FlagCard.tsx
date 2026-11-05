'use client';

import { useState, type FormEvent } from 'react';
import { Button, StatusPill, Textarea } from '@archova/ui';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import type { FlagDecision, FlagDecisionKind, ReviewFlag } from '../data/api';
import { DECISIONS, DECISION_LABEL, SEVERITY } from '../lib/labels';
import { SourceQuote } from './SourceQuote';

/** Severity is icon, letter and word, never colour alone (design/09 §5). */
export function SeverityPill({ severity }: { severity: ReviewFlag['severity'] }) {
  const s = SEVERITY[severity];
  return (
    <StatusPill tone={s.tone}>
      {s.letter} · {s.label}
    </StatusPill>
  );
}

/**
 * One departure from the builder's playbook, with the clause it cites, the builder's own approved wording if there
 * is any, and the person's decision. Nova's words are shown as the API returns them. There is no control to write
 * wording, and nothing here sends, signs or changes the contract.
 */
export function FlagCard({
  flag,
  index,
  history,
  canDecide,
  saving,
  error,
  onDecide,
}: {
  flag: ReviewFlag;
  index: number;
  /** Every decision recorded on this flag, oldest first. */
  history: readonly FlagDecision[];
  canDecide: boolean;
  saving: boolean;
  error?: string | undefined;
  onDecide: (decision: FlagDecisionKind, note: string | null) => void;
}) {
  const { timezone } = useCurrentProject();
  const dir = useProjectDirectory();
  const current = history.at(-1);
  const [choice, setChoice] = useState<FlagDecisionKind | ''>(current?.decision ?? '');
  const [note, setNote] = useState(current?.note ?? '');
  const [showHistory, setShowHistory] = useState(false);
  const needsReason = choice === 'not_relevant' && !note.trim();
  const unchanged =
    !!current && choice === current.decision && note.trim() === (current.note ?? '');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (choice && !needsReason) onDecide(choice, note.trim() || null);
  };
  const w = flag.approvedWording;

  return (
    <article className="cr-flag" aria-labelledby={`flag-${index}`}>
      <header className="cr-flag__head">
        <SeverityPill severity={flag.severity} />
        <StatusPill tone="neutral">Playbook departure</StatusPill>
        <h3 id={`flag-${index}`} className="cr-flag__title">
          {flag.topic}
        </h3>
        {current ? (
          <StatusPill tone={current.decision === 'refer_to_lawyer' ? 'warning' : 'success'}>
            {DECISION_LABEL[current.decision]}
          </StatusPill>
        ) : (
          <StatusPill tone="warning">Undecided</StatusPill>
        )}
      </header>

      <SourceQuote source={flag.source} />
      <p className="u-m-0">{flag.finding}</p>
      <p className="u-caption u-m-0">
        Your playbook position: {flag.position}
        {flag.threshold ? ` (${flag.threshold})` : ''}
      </p>

      {w ? (
        <div className="cr-wording">
          <p className="u-caption u-m-0">{w.label}</p>
          <p className="u-m-0">
            <strong>{w.title}</strong>
          </p>
          <p className="u-m-0 cr-wording__text">{w.wording}</p>
          <p className="u-caption u-m-0">
            Approved by {w.approvedBy} on {w.approvedOn}. {w.approvalNote}
          </p>
          {flag.wordingStatus === 'review_due' ? (
            <p className="u-caption u-m-0">
              Review due: have this wording checked again before use.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="u-caption u-m-0">No approved wording for this. Refer to your lawyer.</p>
      )}

      <form className="stack cr-decision" onSubmit={submit}>
        <fieldset className="cr-decision__group" disabled={!canDecide || saving}>
          <legend className="panel-subheading">Your decision</legend>
          <div className="cr-decision__options">
            {DECISIONS.map((d) => (
              <label key={d.value} className="cr-decision__option">
                <input
                  type="radio"
                  name={`decision-${index}`}
                  value={d.value}
                  checked={choice === d.value}
                  onChange={() => setChoice(d.value)}
                />
                <span>{d.label}</span>
              </label>
            ))}
          </div>
          <Textarea
            label={choice === 'not_relevant' ? 'Why is this not relevant?' : 'Note (optional)'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            rows={2}
          />
        </fieldset>
        {error ? (
          <p role="alert" className="u-m-0 cr-error">
            {error}
          </p>
        ) : null}
        <div className="row-actions">
          <Button
            type="submit"
            size="sm"
            loading={saving}
            disabled={!canDecide || !choice || needsReason || unchanged}
          >
            {current ? 'Change decision' : 'Record decision'}
          </Button>
          {history.length > 1 ? (
            <button
              type="button"
              className="link-button"
              aria-expanded={showHistory}
              onClick={() => setShowHistory(!showHistory)}
            >
              {showHistory ? 'Hide history' : `History (${history.length})`}
            </button>
          ) : null}
        </div>
      </form>

      {current ? (
        <p className="u-caption u-m-0">
          {DECISION_LABEL[current.decision]} by {dir.personName(current.decidedBy)},{' '}
          {formatInstant(current.decidedAt, timezone)}
          {current.note ? `: ${current.note}` : ''}
        </p>
      ) : null}
      {showHistory ? (
        <ol className="plain-list" aria-label="Decision history">
          {history.map((d, i) => (
            <li key={`${d.decidedAt}-${i}`} className="u-caption">
              {DECISION_LABEL[d.decision]} · {dir.personName(d.decidedBy)} ·{' '}
              {formatInstant(d.decidedAt, timezone)}
              {d.note ? ` · ${d.note}` : ''}
            </li>
          ))}
        </ol>
      ) : null}
    </article>
  );
}
