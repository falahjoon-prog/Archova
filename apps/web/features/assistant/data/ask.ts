// Ask Nova against the ai module (`POST {p}/ai/ask`, F2). Nova answers from the current revisions of documents and
// drawings the asker can open, citing document, revision and page for each claim; when nothing answers it, the
// closest passages come back instead of a guess.

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import type { Citation } from '@archova/ui';
import { api, ensureCsrfToken } from '@/shared/lib/api';
import type { NovaAnswer } from './preview-answers';

// The OpenAPI types (what the client returns): the zod schema for NovaCitation drops its `allOf` fields.
type ApiNovaAnswer = components['schemas']['NovaAnswer'];
type NovaSource = components['schemas']['NovaSource'];

/** "A-201 Rev C, p. 1": the reference people use, falling back to the title. */
function sourceLabel(s: NovaSource): string {
  return `${s.reference ?? s.title} Rev ${s.revision}, p. ${s.page}`;
}

function toCitation(s: NovaSource, i: number): Citation {
  return {
    id: `${s.revisionId}:${s.page}:${i}`,
    label: sourceLabel(s),
    href:
      s.sourceType === 'drawing'
        ? `drawing:${s.sourceId}:${s.revisionId}`
        : `documents:${s.sourceId}`,
  };
}

export function toNovaAnswer(res: ApiNovaAnswer): NovaAnswer {
  if (!res.found) {
    return {
      kind: 'not_found',
      text: res.answer || "I couldn't find that in this project's documents and drawings.",
      citations: res.closestMatches.map(toCitation),
      runId: res.runId,
    };
  }
  return {
    kind: 'answer',
    text: res.answer,
    citations: res.citations.map(toCitation),
    runId: res.runId,
  };
}

export async function askNova(
  orgId: string,
  projectId: string,
  question: string,
  signal: AbortSignal,
): Promise<NovaAnswer> {
  await ensureCsrfToken();
  const res = unwrap(
    await api.POST('/v1/orgs/{orgId}/projects/{projectId}/ai/ask', {
      params: { path: { orgId, projectId } },
      body: { question },
      signal,
    }),
  );
  return toNovaAnswer(res);
}

/** Thumbs up or down on an answer the API produced (`PUT {o}/ai/runs/{runId}/feedback`). */
export async function sendAnswerFeedback(
  orgId: string,
  runId: string,
  rating: 'up' | 'down',
): Promise<void> {
  await ensureCsrfToken();
  unwrap(
    await api.PUT('/v1/orgs/{orgId}/ai/runs/{runId}/feedback', {
      params: { path: { orgId, runId } },
      body: { rating },
    }),
  );
}
