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
import type {
  DrawingRegisterService,
  SheetSuggestionPayload,
} from '../application/drawing-register';
import type { suggestions } from '../infra/tables';

/** Internal UUIDs in payloads become public ids. */
function payloadDto(task: string, payload: unknown): Record<string, unknown> {
  if (task === 'drawing.titleblock') {
    const p = payload as SheetSuggestionPayload;
    return { ...p, fileId: encodeId('file', p.fileId) };
  }
  return payload as Record<string, unknown>;
}

const TARGET_KINDS = { file_page: 'file' } as const;

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
