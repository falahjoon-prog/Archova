import { decodeId, encodeId } from '@archova/domain';
import type { AiSuggestion } from '@archova/contracts';
import {
  AppError,
  defineRoutes,
  etag,
  parseIfMatch,
  requireTenant,
  type Database,
} from '@archova/kernel';
import type { AdminService, AiSettings } from '../application/admin';
import type { AnswerSource, AskService } from '../application/ask';
import type {
  DrawingRegisterService,
  SheetSuggestionPayload,
} from '../application/drawing-register';
import type {
  DraftCitation,
  InductionDraftPayload,
  InductionDraftService,
} from '../application/induction-draft';
import type { ProjectIndexService } from '../application/project-index';
import type { suggestions } from '../infra/tables';

/** Internal UUIDs in payloads become public ids. */
function payloadDto(task: string, payload: unknown): Record<string, unknown> {
  if (task === 'induction.draft') {
    const p = payload as InductionDraftPayload;
    const cite = (c: DraftCitation) => ({ ...c, ...sourceIds(c) });
    return {
      ...p,
      sections: p.sections.map((s) => ({
        ...s,
        slides: s.slides.map((sl) => ({
          title: sl.title,
          points: sl.points.map((x) => ({ text: x.text, citations: x.citations.map(cite) })),
          script: sl.script.map((x) => ({ text: x.text, citations: x.citations.map(cite) })),
        })),
      })),
      quiz: p.quiz.map((q) => ({ ...q, citations: q.citations.map(cite) })),
    };
  }
  if (task === 'drawing.titleblock') {
    const p = payload as SheetSuggestionPayload;
    return { ...p, fileId: encodeId('file', p.fileId) };
  }
  return payload as Record<string, unknown>;
}

/** Document or drawing ids in a citation, as public ids. */
function sourceIds(c: { sourceType: string; sourceId: string; revisionId: string | null }) {
  const doc = c.sourceType === 'document';
  return {
    sourceId: encodeId(doc ? 'document' : 'drawingSheet', c.sourceId),
    revisionId: c.revisionId ? encodeId(doc ? 'revision' : 'drawingRevision', c.revisionId) : null,
  };
}

const TARGET_KINDS = { file_page: 'file', project: 'project' } as const;

export const toSuggestionDto = (r: typeof suggestions.$inferSelect): AiSuggestion => ({
  id: encodeId('aiSuggestion', r.id),
  projectId: r.projectId ? encodeId('project', r.projectId) : null,
  task: r.task,
  targetType: r.targetType,
  targetId:
    r.targetId && r.targetType in TARGET_KINDS
      ? encodeId(TARGET_KINDS[r.targetType as keyof typeof TARGET_KINDS], r.targetId)
      : null,
  status: r.status,
  confidence: r.confidence,
  payload: payloadDto(r.task, r.payload),
  runId: encodeId('aiRun', r.runId),
  createdAt: r.createdAt.toISOString(),
  decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
});

const toSourceDto = (s: AnswerSource) => ({
  sourceType: s.sourceType,
  sourceId:
    s.sourceType === 'document'
      ? encodeId('document', s.sourceId)
      : encodeId('drawingSheet', s.sourceId),
  revisionId:
    s.sourceType === 'document'
      ? encodeId('revision', s.revisionId)
      : encodeId('drawingRevision', s.revisionId),
  revision: s.revision,
  title: s.title,
  reference: s.reference,
  page: s.page,
});

const projectUuid = (id: string) => {
  const uuid = decodeId('project', id);
  if (!uuid) throw new AppError('project.not_found');
  return uuid;
};

const toSettingsDto = (s: AiSettings) => ({
  aiEnabled: s.aiEnabled,
  featuresEnabled: s.featuresEnabled as never,
  monthlyCreditCap: s.monthlyCreditCap,
  externalAiEnabled: s.externalAiEnabled,
  retentionDays: s.retentionDays,
  version: s.version,
});

export function aiRoutes(
  database: Database,
  admin: AdminService,
  drawingRegister: DrawingRegisterService,
  askService: AskService,
  projectIndex: ProjectIndexService,
  inductionDrafts: InductionDraftService,
) {
  const ro = { readOnly: true } as const;
  return defineRoutes({
    getAiSettings: async (input) => {
      const s = await database.withTenantTx(
        requireTenant(input),
        (scope) => admin.getSettings(scope),
        ro,
      );
      return { status: 200, body: toSettingsDto(s), headers: { etag: etag(s.version) } };
    },
    updateAiSettings: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const s = await database.withTenantTx(requireTenant(input), (scope) =>
        admin.updateSettings(scope, expected, input.body),
      );
      return { status: 200, body: toSettingsDto(s), headers: { etag: etag(s.version) } };
    },
    getAiUsage: async (input) => {
      const usage = await database.withTenantTx(
        requireTenant(input),
        (scope) => admin.getUsage(scope),
        ro,
      );
      return { status: 200, body: usage };
    },
    submitAiFeedback: async (input) => {
      const runId = decodeId('aiRun', input.params.runId);
      if (!runId) throw new AppError('ai.run.not_found');
      await database.withTenantTx(requireTenant(input), (scope) =>
        admin.submitFeedback(scope, runId, {
          rating: input.body.rating === 'up' ? 1 : -1,
          reason: input.body.reason ?? null,
          comment: input.body.comment ?? null,
        }),
      );
      return { status: 204 };
    },
    extractDrawingRegister: async (input) => {
      const projectId = projectUuid(input.params.projectId);
      const fileId = decodeId('file', input.body.fileId);
      if (!fileId) throw new AppError('file.not_found');
      const r = await drawingRegister.extract(requireTenant(input), projectId, fileId);
      return {
        status: 200,
        body: {
          suggestions: r.suggestions.map(toSuggestionDto),
          pageCount: r.pageCount,
          skippedPages: r.skippedPages,
          refusedPages: r.refusedPages,
        },
      };
    },
    askNova: async (input) => {
      const projectId = projectUuid(input.params.projectId);
      const a = await askService.ask(requireTenant(input), projectId, {
        question: input.body.question,
      });
      return {
        status: 200,
        body: {
          runId: a.runId ? encodeId('aiRun', a.runId) : null,
          found: a.found,
          answer: a.answer,
          citations: a.citations.map((c) => ({ ...toSourceDto(c), quote: c.quote })),
          closestMatches: a.closestMatches.map(toSourceDto),
        },
      };
    },
    draftInduction: async (input) => {
      const projectId = projectUuid(input.params.projectId);
      const row = await inductionDrafts.draft(requireTenant(input), projectId, {
        siteName: input.body.siteName,
      });
      return { status: 201, body: toSuggestionDto(row) };
    },
    indexProjectForNova: async (input) => {
      const projectId = projectUuid(input.params.projectId);
      const report = await projectIndex.indexProject(requireTenant(input), projectId);
      return { status: 200, body: report };
    },
    listAiSuggestions: async (input) => {
      const projectId = projectUuid(input.params.projectId);
      const page = await database.withTenantTx(
        requireTenant(input),
        (scope) =>
          drawingRegister.list(scope, projectId, {
            limit: input.query.limit,
            ...(input.query.task ? { task: input.query.task } : {}),
            ...(input.query.status ? { status: input.query.status } : {}),
            ...(input.query.cursor ? { cursor: input.query.cursor } : {}),
          }),
        ro,
      );
      return {
        status: 200,
        body: { data: page.data.map(toSuggestionDto), nextCursor: page.nextCursor },
      };
    },
    decideAiSuggestion: async (input) => {
      const projectId = projectUuid(input.params.projectId);
      const id = decodeId('aiSuggestion', input.params.suggestionId);
      if (!id) throw new AppError('ai.suggestion.not_found');
      const row = await database.withTenantTx(requireTenant(input), (scope) =>
        drawingRegister.decide(scope, projectId, id, {
          decision: input.body.decision,
          ...(input.body.fields ? { fields: input.body.fields } : {}),
        }),
      );
      return { status: 200, body: toSuggestionDto(row) };
    },
  });
}
