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

/**
 * "A-201 Rev C, p. 1": the reference people use, falling back to the title. An RFI is "RFI-031 Corridor hardware
 * (closed)", a defect "DEF-0042 Cracked tile (open)", a diary day "Site diary Monday 12 October 2026 (signed off)".
 */
function sourceLabel(s: NovaSource): string {
  if (s.sourceType === 'rfi') return `${s.reference ?? 'RFI'} ${s.title} (${s.revision})`;
  if (s.sourceType === 'defect') return `${s.reference ?? 'Defect'} ${s.title} (${s.revision})`;
  if (s.sourceType === 'diary') return `${s.title} (${s.revision})`;
  return `${s.reference ?? s.title} Rev ${s.revision}, p. ${s.page}`;
}

function sourceHref(s: NovaSource): string {
  if (s.sourceType === 'drawing') return `drawing:${s.sourceId}:${s.revisionId}`;
  if (s.sourceType === 'rfi') return `rfi:${s.sourceId}`;
  if (s.sourceType === 'defect') return `defect:${s.sourceId}`;
  if (s.sourceType === 'diary') return `diary:${s.reference ?? ''}`;
  return `documents:${s.sourceId}`;
}

function toCitation(s: NovaSource, i: number): Citation {
  return {
    id: `${s.revisionId}:${s.page}:${i}`,
    label: sourceLabel(s),
    href: sourceHref(s),
  };
}

export function toNovaAnswer(res: ApiNovaAnswer): NovaAnswer {
  if (!res.found) {
    return {
      kind: 'not_found',
      text: res.answer || "I couldn't find that in this project's records.",
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

type ApiAssistAnswer = components['schemas']['NovaAssistAnswer'];

/** What a lookup's citation opens: the record itself when it is one, otherwise the module's screen. */
function assistHref(type: string, id: string): string {
  if (type === 'rfi') return id.startsWith('rfi_') ? `rfi:${id}` : 'module:rfis';
  if (type === 'defect') return id.startsWith('defect_') ? `defect:${id}` : 'module:defects';
  if (type === 'budget') return 'module:budget';
  if (type === 'programme') return 'module:programme';
  if (type === 'drawing') return `drawing:${id}`;
  if (type === 'diary') return `diary:${id}`;
  return `documents:${id}`;
}

export function toAssistAnswer(res: ApiAssistAnswer): NovaAnswer {
  const citations: Citation[] = res.citations.map((c, i) => ({
    id: `${c.sourceId}:${i}`,
    label: c.title,
    href: assistHref(c.sourceType, c.sourceId),
  }));
  return {
    kind: res.found ? 'answer' : 'not_found',
    text: res.answer,
    citations,
    runId: res.runId,
  };
}

export interface AssistTurn {
  role: 'user' | 'nova';
  text: string;
}

/**
 * The Nova panel's question with the screen and record the person has open (`POST {p}/ai/assist`). Nova may look
 * things up with read-only tools under the asker's own permissions; the answer cites what it found.
 */
export async function assistNova(
  orgId: string,
  projectId: string,
  question: string,
  context: { screen?: string; record?: { type: string; id: string; label?: string } },
  history: AssistTurn[],
  signal: AbortSignal,
): Promise<NovaAnswer> {
  await ensureCsrfToken();
  const res = unwrap(
    await api.POST('/v1/orgs/{orgId}/projects/{projectId}/ai/assist', {
      params: { path: { orgId, projectId } },
      body: { question, context, history: history.slice(-6) },
      signal,
    }),
  );
  return toAssistAnswer(res);
}
