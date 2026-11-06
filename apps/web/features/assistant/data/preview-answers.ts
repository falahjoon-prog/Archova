// Ask Nova in the preview. Production streams answers from the ai module over SSE, retrieved with the asker's own
// permissions (frontend 02 §7.1). Until that endpoint is in the contract, a few rules answer from the same preview
// data the screens show, with citations, so the panel's states (answer, not found, stop, retry) can be used.

import { addDays, type LocalDate } from '@archova/time';
import type { Citation } from '@archova/ui';
import { formatLocalDate } from '@/shared/lib/format';
import { companyName, personName } from '@/shared/mocks/directory';
import type { AssistantScope } from '../components/AssistantScope';

export interface NovaAnswer {
  kind: 'answer' | 'not_found';
  text: string;
  citations: Citation[];
  /** `air_…` when the answer came from the API; feedback is only sent for those. */
  runId: string | null;
}

const notFound = (text: string): NovaAnswer => ({
  kind: 'not_found',
  text,
  citations: [],
  runId: null,
});
const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

const say = (text: string): NovaAnswer => ({ kind: 'answer', text, citations: [], runId: null });

/** Outside a project: small talk and "what can you do" get a friendly reply; only project questions ask to open one. */
function generalAnswer(q: string): NovaAnswer {
  const text = q.replace(/[^\p{L}\p{N}\s']/gu, ' ').trim();
  if (/^(hi|hello|hey|hiya|howdy|g'?day|good (morning|afternoon|evening)|yo)\b/.test(text)) {
    return say(
      "Hi, I'm Nova. Ask me about a project's drawings, RFIs, site diary or defects. Open a project and I'll search its records, or ask me what I can do.",
    );
  }
  if (/\b(thanks|thank you|cheers|ta)\b/.test(text)) return say("You're welcome.");
  if (/\bhow are you\b|\bwho are you\b|\bwhat are you\b|\bwhat can you do\b|\bhelp\b/.test(text)) {
    return say(
      "I'm Nova, Archova's assistant. In a project I can answer questions from its drawings, RFIs, site diary and defects and show where each answer came from. Open a project to get started.",
    );
  }
  return notFound(
    'I need a project open to answer that. Open one and ask again about its drawings, RFIs, diary or defects.',
  );
}

export async function previewAnswer(
  question: string,
  scope: AssistantScope,
  today: LocalDate,
): Promise<NovaAnswer> {
  const q = question.toLowerCase();
  const projectId = scope.projectId;
  if (!projectId) return generalAnswer(q);

  if (/\brfis?\b/.test(q) || scope.record?.type === 'rfi') {
    const { rfisPreviewSource, formatRfiNumber } = await import('@/features/rfis');
    if (scope.record?.type === 'rfi' && !/\b(all|open|overdue|how many)\b/.test(q)) {
      const r = await rfisPreviewSource.get(projectId, scope.record.id);
      const who = r.ballInCourtCompanyId
        ? ` It's waiting on ${companyName(r.ballInCourtCompanyId)} (${personName(r.ballInCourtId)}).`
        : '';
      const due = r.dueDate ? ` Due ${formatLocalDate(r.dueDate)}.` : '';
      const official = r.responses.find((x) => x.isOfficial);
      return {
        kind: 'answer',
        text: `${formatRfiNumber(r.number)} "${r.subject}" is ${r.status}.${who}${due}${official ? ` The official response says: "${official.body}"` : ''}`,
        citations: [
          { id: r.id, label: formatRfiNumber(r.number), href: `rfi:${r.id}` },
          ...(r.drawing
            ? [
                {
                  id: 'dwg',
                  label: r.drawing.label,
                  href: `drawing:${r.drawing.sheetId}:${r.drawing.revisionId}`,
                },
              ]
            : []),
        ],
        runId: null,
      };
    }
    const overdue = /overdue|late/.test(q);
    const rows = overdue
      ? await rfisPreviewSource.list(projectId, { overdueBefore: today })
      : await rfisPreviewSource.list(projectId, { status: 'open' });
    if (!rows.length) {
      return {
        kind: 'answer',
        text: overdue ? 'No RFIs are overdue.' : 'There are no open RFIs.',
        citations: [],
        runId: null,
      };
    }
    const lines = rows.map(
      (r) =>
        `${formatRfiNumber(r.number)} (${r.subject}, waiting on ${companyName(r.ballInCourtCompanyId)})`,
    );
    return {
      kind: 'answer',
      text: `${rows.length} ${overdue ? 'overdue' : 'open'} ${rows.length === 1 ? 'RFI' : 'RFIs'}: ${list(lines)}.`,
      citations: rows.map((r) => ({
        id: r.id,
        label: formatRfiNumber(r.number),
        href: `rfi:${r.id}`,
      })),
      runId: null,
    };
  }

  if (/defect/.test(q) || scope.record?.type === 'defect') {
    const { defectsPreviewSource, formatDefectNumber } = await import('@/features/defects');
    const ready = /ready|inspect/.test(q);
    const rows = await defectsPreviewSource.list(
      projectId,
      ready ? { status: 'ready_for_review' } : { status: 'open' },
    );
    if (!rows.length) {
      return {
        kind: 'answer',
        text: ready ? 'No defects are waiting for inspection.' : 'There are no open defects.',
        citations: [],
        runId: null,
      };
    }
    const byCompany = new Map<string, number>();
    for (const d of rows) {
      const company = d.assigneeCompanyId ?? '';
      byCompany.set(company, (byCompany.get(company) ?? 0) + 1);
    }
    return {
      kind: 'answer',
      text: `${rows.length} ${rows.length === 1 ? 'defect is' : 'defects are'} ${ready ? 'ready for inspection' : 'open'}: ${list([...byCompany].map(([c, n]) => `${n} with ${companyName(c)}`))}.`,
      citations: rows.map((d) => ({
        id: d.id,
        label: formatDefectNumber(d.number),
        href: `defect:${d.id}`,
      })),
      runId: null,
    };
  }

  if (/wet|rain|weather|stood down|delay/.test(q)) {
    const { diaryPreviewSource } = await import('@/features/diary');
    const from = addDays(today, -30);
    const entries = await diaryPreviewSource.list(projectId, from, today);
    const wet = entries.filter(
      (e) => e.content.delays.some((d) => d.type === 'weather') || e.content.standDown.active,
    );
    if (!wet.length) {
      return {
        kind: 'answer',
        text: `No weather delays or stand-downs are recorded in the diary since ${formatLocalDate(from)}.`,
        citations: [],
        runId: null,
      };
    }
    const hours = wet.reduce(
      (s, e) =>
        s +
        e.content.delays
          .filter((d) => d.type === 'weather')
          .reduce((h, d) => h + (d.hours ?? 0), 0),
      0,
    );
    return {
      kind: 'answer',
      text: `${wet.length} wet ${wet.length === 1 ? 'day' : 'days'} since ${formatLocalDate(from)} (${list(wet.map((e) => formatLocalDate(e.date)))}), with ${hours} hours of weather delay recorded. Delays marked "possible EOT" can support an extension of time claim.`,
      citations: wet.map((e) => ({
        id: e.date,
        label: `Diary ${formatLocalDate(e.date)}`,
        href: `diary:${e.date}`,
      })),
      runId: null,
    };
  }

  if (/drawing|sheet|revision|\brev\b/.test(q)) {
    const { drawingsPreviewSource } = await import('@/features/drawings');
    const sheets = await drawingsPreviewSource.listSheets(projectId);
    return {
      kind: 'answer',
      text: `${sheets.length} current sheets: ${list(sheets.map((s) => `${s.sheetNumber} at Rev ${s.currentRev}`))}.`,
      citations: sheets.map((s) => ({
        id: s.id,
        label: `${s.sheetNumber} Rev ${s.currentRev}`,
        href: `drawing:${s.id}:${s.currentRevisionId}`,
      })),
      runId: null,
    };
  }

  return notFound(
    "I couldn't find that in this project's records. Try asking about RFIs, defects, drawings or the site diary.",
  );
}

/** Words arrive a few at a time, as they would over SSE. Resolves early when stopped. */
export async function streamText(
  text: string,
  onChunk: (soFar: string) => void,
  signal: AbortSignal,
  msPerChunk = process.env.NODE_ENV === 'test' ? 0 : 30,
): Promise<'done' | 'stopped'> {
  const words = text.split(/(\s+)/);
  let soFar = '';
  for (let i = 0; i < words.length; i += 4) {
    if (signal.aborted) return 'stopped';
    soFar += words.slice(i, i + 4).join('');
    onChunk(soFar);
    if (msPerChunk) await new Promise((r) => setTimeout(r, msPerChunk));
    else await Promise.resolve();
  }
  return signal.aborted ? 'stopped' : 'done';
}
