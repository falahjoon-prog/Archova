'use client';

import { forwardRef, useState, type FormEvent } from 'react';
import { Button, NovaFeedback, NovaSuggestion, Textarea } from '@archova/ui';
import { NovaIcon } from '@archova/ui/icons';
import { AppLink } from '@/shared/layout/AppLink';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useRfiMutations, useRfiNova } from '../hooks/useRfis';
import { referenceCitations } from '../lib/references';
import type { NovaDraft } from '../lib/types';

/**
 * The assignee's answer (F1.4 step 4). "Draft response with Nova" returns a draft with citations, what it rests on
 * and what is still open; the person uses, edits or discards it and presses Send themselves (P6). A response started
 * from a draft keeps its suggestion id, and the draft is decided once it is sent: accepted as it was, or edited. A
 * draft that was discarded, or left unused when something else was sent, is rejected.
 */
export const RespondForm = forwardRef<HTMLTextAreaElement, { rfiId: string }>(function RespondForm(
  { rfiId },
  ref,
) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const { respond } = useRfiMutations(project.projectId);
  const nova = useRfiNova(project.projectId);
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState<NovaDraft | null>(null);
  const [direction, setDirection] = useState('');
  const [fromNova, setFromNova] = useState<{
    id: string;
    text: string;
    untouched: boolean;
  } | null>(null);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) {
      setError('Write a response.');
      return;
    }
    setError(null);
    // The decision is recorded once the response is saved; a failed record must not lose the response.
    const decided = fromNova
      ? { id: fromNova.id, decision: body.trim() === fromNova.text.trim() ? 'accepted' : 'edited' }
      : draft
        ? { id: draft.id, decision: 'rejected' }
        : null;
    respond.mutate(
      { id: rfiId, body, aiSuggestionId: fromNova?.id ?? null },
      {
        onSuccess: () => {
          if (decided) nova.decide.mutate({ id: decided.id, decision: decided.decision as never });
          setBody('');
          setFromNova(null);
          setDraft(null);
        },
      },
    );
  };

  return (
    <form className="stack ac-card" onSubmit={send} noValidate aria-labelledby="rfi-respond">
      <h3 id="rfi-respond" className="panel-heading">
        Respond
      </h3>
      <Textarea
        ref={ref}
        label="Response"
        rows={5}
        value={body}
        error={error ?? undefined}
        aiFilled={fromNova?.untouched}
        onChange={(e) => {
          setBody(e.target.value);
          if (fromNova) setFromNova({ ...fromNova, untouched: false });
        }}
      />
      <Textarea
        label="What should the answer say? (optional)"
        hint="Nova follows this and adds no decisions of its own."
        rows={2}
        value={direction}
        onChange={(e) => setDirection(e.target.value)}
      />
      <div className="row-actions">
        <Button type="submit" disabled={respond.isPending}>
          {respond.isPending ? 'Sending…' : 'Send response'}
        </Button>
        <Button
          type="button"
          variant="nova"
          disabled={nova.draftResponse.isPending}
          onClick={() =>
            nova.draftResponse.mutate(
              { rfiId, direction },
              {
                onSuccess: (d) => {
                  setDraft(d);
                  setFeedback(null);
                },
              },
            )
          }
        >
          <NovaIcon size={16} aria-hidden="true" />
          {nova.draftResponse.isPending ? 'Drafting…' : 'Draft response with Nova'}
        </Button>
      </div>
      <ErrorAlert error={respond.error} title="We couldn't send your response" />
      <ErrorAlert error={nova.draftResponse.error} title="Nova couldn't draft a response" />
      {draft ? (
        <NovaSuggestion
          title="Draft response"
          linkAs={AppLink}
          citations={referenceCitations(draft.references, org.orgSlug, project.projectId)}
          actions={
            <>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setBody(draft.text);
                  setFromNova({ id: draft.id, text: draft.text, untouched: true });
                  setDraft(null);
                }}
              >
                Use draft
              </Button>
              <Button
                type="button"
                size="sm"
                variant="tertiary"
                onClick={() => {
                  nova.decide.mutate({ id: draft.id, decision: 'rejected' });
                  setDraft(null);
                }}
              >
                Discard
              </Button>
              <NovaFeedback value={feedback} onChange={setFeedback} />
            </>
          }
        >
          <p className="u-m-0">{draft.text}</p>
          {draft.basis === 'none' ? (
            <p className="u-caption u-m-0">
              Nothing in the project documents or your direction supports this draft. Answer from
              your own records.
            </p>
          ) : draft.basis === 'direction' ? (
            <p className="u-caption u-m-0">
              This follows your direction only; no document passage supports it.
            </p>
          ) : null}
          {draft.needsDecision.length ? (
            <div className="u-caption">
              <p className="u-m-0">Decide before you send:</p>
              <ul className="u-m-0">
                {draft.needsDecision.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {draft.unsupportedNumbers.length ? (
            <p className="u-caption u-m-0">
              Check these numbers, they aren&apos;t in the thread or the documents:{' '}
              {draft.unsupportedNumbers.join(', ')}.
            </p>
          ) : null}
          {draft.unreadFiles.length ? (
            <p className="u-caption u-m-0">
              Nova couldn&apos;t read: {draft.unreadFiles.join(', ')}.
            </p>
          ) : null}
        </NovaSuggestion>
      ) : null}
    </form>
  );
});
