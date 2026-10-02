'use client';

import { forwardRef, useState, type FormEvent } from 'react';
import { Button, NovaFeedback, NovaSuggestion, Textarea } from '@archova/ui';
import { NovaIcon } from '@archova/ui/icons';
import { AppLink } from '@/shared/layout/AppLink';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { resolveCitation } from '@/shared/lib/citations';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useRfiMutations, useRfiNova } from '../hooks/useRfis';
import type { NovaDraft } from '../lib/types';

/**
 * The assignee's answer (F1.4 step 4). "Draft response with Nova" returns a draft with citations; the person uses,
 * edits or discards it and presses Send themselves (P6). A response started from a draft keeps its suggestion id.
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
  const [fromNova, setFromNova] = useState<{ id: string; untouched: boolean } | null>(null);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) {
      setError('Write a response.');
      return;
    }
    setError(null);
    respond.mutate(
      { id: rfiId, body, aiSuggestionId: fromNova?.id ?? null },
      {
        onSuccess: () => {
          setBody('');
          setFromNova(null);
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
      <div className="row-actions">
        <Button type="submit" disabled={respond.isPending}>
          {respond.isPending ? 'Sending…' : 'Send response'}
        </Button>
        <Button
          type="button"
          variant="nova"
          disabled={nova.draftResponse.isPending}
          onClick={() =>
            nova.draftResponse.mutate(rfiId, {
              onSuccess: (d) => {
                setDraft(d);
                setFeedback(null);
              },
            })
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
          citations={draft.citations.map((c) => resolveCitation(c, org.orgSlug, project.projectId))}
          actions={
            <>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setBody(draft.text);
                  setFromNova({ id: draft.id, untouched: true });
                  setDraft(null);
                }}
              >
                Use draft
              </Button>
              <Button type="button" size="sm" variant="tertiary" onClick={() => setDraft(null)}>
                Discard
              </Button>
              <NovaFeedback value={feedback} onChange={setFeedback} />
            </>
          }
        >
          <p className="u-m-0">{draft.text}</p>
        </NovaSuggestion>
      ) : null}
    </form>
  );
});
