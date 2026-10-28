import { decodeId, encodeId } from '@archova/domain';
import type { AiSuggestion, DefectStatus } from '@archova/contracts';
import {
  AppError,
  defineRoutes,
  etag,
  parseIfMatch,
  requireTenant,
  type Database,
} from '@archova/kernel';
import type { AdminService, AiSettings } from '../application/admin';
import type { DiarySummaryPayload, DiarySummaryService } from '../application/diary-summary';
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
import type { RfiDraftPayload, RfiDraftService } from '../application/rfi-draft';
import type { DefectTagPayload, DefectTagService } from '../application/defect-tag';
import type { ImportMappingService } from '../application/import-mapping';
import type { DrawingCompareService } from '../application/drawing-compare';
import type { SummarySource } from '../domain/diary-summary';
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
  if (task === 'diary.summary') {
    const p = payload as DiarySummaryPayload;
    return {
      ...p,
      sentences: p.sentences.map((x) => ({ ...x, sources: x.sources.map(diarySource) })),
      possibleDelay: { ...p.possibleDelay, sources: p.possibleDelay.sources.map(diarySource) },
      unmentionedDelays: p.unmentionedDelays.map(diarySource),
    };
  }
  if (task === 'rfi.draft') {
    const p = payload as RfiDraftPayload;
    return {
      ...p,
      references: p.references.map((r) => ({ ...r, ...sourceIds(r) })),
      similarRfiIds: p.similarRfiIds.map((id) => encodeId('rfi', id)),
      suggestedAssigneeIds: p.suggestedAssigneeIds.map((id) => encodeId('user', id)),
      pin: p.pin
        ? { ...p.pin, drawingRevisionId: encodeId('drawingRevision', p.pin.drawingRevisionId) }
        : null,
    };
  }
  if (task === 'defect.tag') {
    const p = payload as DefectTagPayload;
    return {
      ...p,
      suggestedCompanyIds: p.suggestedCompanyIds.map((id) => encodeId('company', id)),
      duplicateDefectIds: p.duplicateDefectIds.map((id) => encodeId('defect', id)),
      pin: p.pin
        ? { ...p.pin, drawingRevisionId: encodeId('drawingRevision', p.pin.drawingRevisionId) }
        : null,
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

const DIARY_LINE_KINDS = {
  labour: 'diaryLabour',
  plant: 'diaryPlant',
  delivery: 'diaryDelivery',
  delay: 'diaryDelay',
  visitor: 'diaryVisitor',
  stand_down: 'diaryStandDown',
} as const;

/** A diary line as its public id (event kinds such as `inspection` are diary events); weather and totals as is. */
const diarySource = (s: SummarySource) => ({
  kind: s.kind,
  id: s.id
    ? encodeId(DIARY_LINE_KINDS[s.kind as keyof typeof DIARY_LINE_KINDS] ?? 'diaryEvent', s.id)
    : null,
});

const TARGET_KINDS = { file_page: 'file', project: 'project', diary_entry: 'diary' } as const;

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
  rfiDrafts: RfiDraftService,
  drawingCompare: DrawingCompareService,
  diarySummary: DiarySummaryService,
  defectTags: DefectTagService,
  importMappings: ImportMappingService,
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
    draftRfiWithNova: async (input) => {
      const projectId = projectUuid(input.params.projectId);
      const m = input.body.markup;
      let markup: { revisionId: string; markupId: string } | undefined;
      if (m) {
        const revisionId = decodeId('drawingRevision', m.drawingRevisionId);
        const markupId = decodeId('markup', m.markupId);
        if (!revisionId) throw new AppError('drawing_revision.not_found');
        if (!markupId) throw new AppError('markup.not_found');
        markup = { revisionId, markupId };
      }
      let photo: { fileId: string } | undefined;
      if (input.body.photo) {
        const fileId = decodeId('file', input.body.photo.fileId);
        if (!fileId) throw new AppError('file.not_found');
        photo = { fileId };
      }
      const d = await rfiDrafts.draft(requireTenant(input), projectId, {
        note: input.body.note ?? '',
        ...(markup ? { markup } : {}),
        ...(photo ? { photo } : {}),
      });
      return {
        status: 200,
        body: {
          runId: encodeId('aiRun', d.runId),
          suggestionId: encodeId('aiSuggestion', d.suggestionId),
          subject: d.subject,
          question: d.question,
          discipline: d.discipline,
          references: d.references.map((c) => ({ ...toSourceDto(c), quote: c.quote })),
          gaps: d.gaps,
          unsupportedNumbers: d.unsupportedNumbers,
          similarRfis: d.similarRfis.map((r) => ({
            id: encodeId('rfi', r.id),
            number: r.number,
            subject: r.subject,
            status: r.status,
          })),
          suggestedAssigneeIds: d.suggestedAssigneeIds.map((id) => encodeId('user', id)),
          drawing: d.drawing && {
            drawingRevisionId: encodeId('drawingRevision', d.drawing.revisionId),
            sheetNumber: d.drawing.sheetNumber,
            title: d.drawing.title,
            rev: d.drawing.rev,
            pin: d.drawing.pin,
            scanned: d.drawing.scanned,
          },
        },
      };
    },
    suggestImportMappingWithNova: async (input) => {
      const m = await importMappings.suggest(
        requireTenant(input),
        projectUuid(input.params.projectId),
        {
          entity: input.body.entity,
          columns: input.body.columns,
        },
      );
      return {
        status: 200,
        body: {
          runId: encodeId('aiRun', m.runId),
          suggestionId: encodeId('aiSuggestion', m.suggestionId),
          entity: m.entity,
          fields: m.fields.map((f) => ({
            key: f.key,
            label: f.label,
            kind: f.kind,
            required: f.required,
            values: (f.values ?? []).map((v) => ({ value: v.value, label: v.label })),
          })),
          columns: m.columns,
          values: m.values,
          missingRequired: m.missingRequired,
        },
      };
    },
    tagDefectWithNova: async (input) => {
      const projectId = projectUuid(input.params.projectId);
      const photoFileId = decodeId('file', input.body.photo.fileId);
      if (!photoFileId) throw new AppError('file.not_found');
      let pin: { drawingRevisionId: string; x: number; y: number } | undefined;
      if (input.body.pin) {
        const drawingRevisionId = decodeId('drawingRevision', input.body.pin.drawingRevisionId);
        if (!drawingRevisionId) throw new AppError('drawing_revision.not_found');
        pin = { drawingRevisionId, x: input.body.pin.x, y: input.body.pin.y };
      }
      const d = await defectTags.tag(requireTenant(input), projectId, {
        note: input.body.note ?? '',
        photoFileId,
        ...(pin ? { pin } : {}),
      });
      return {
        status: 200,
        body: {
          runId: encodeId('aiRun', d.runId),
          suggestionId: encodeId('aiSuggestion', d.suggestionId),
          title: d.title,
          description: d.description,
          trade: d.trade,
          alternativeTrades: d.alternativeTrades,
          category: d.category,
          priority: d.priority,
          gaps: d.gaps,
          unsupportedNumbers: d.unsupportedNumbers,
          suggestedCompanies: d.suggestedCompanies.map((c) => ({
            ...c,
            id: encodeId('company', c.id),
          })),
          duplicates: d.duplicates.map((x) => ({
            id: encodeId('defect', x.id),
            numberLabel: x.numberLabel,
            title: x.title,
            status: x.status as DefectStatus,
            trade: x.trade,
            distance: x.distance,
            sameTrade: x.sameTrade,
          })),
          drawing: d.drawing && {
            drawingRevisionId: encodeId('drawingRevision', d.drawing.revisionId),
            sheetNumber: d.drawing.sheetNumber,
            title: d.drawing.title,
            rev: d.drawing.rev,
            pin: d.drawing.pin,
            nearby: d.drawing.nearby,
            scanned: d.drawing.scanned,
          },
        },
      };
    },
    summariseDiaryDayWithNova: async (input) => {
      const projectId = projectUuid(input.params.projectId);
      const row = await diarySummary.summariseDate(
        requireTenant(input),
        projectId,
        input.params.date,
      );
      return { status: 200, body: toSuggestionDto(row) };
    },
    compareDrawingRevision: async (input) => {
      const projectId = projectUuid(input.params.projectId);
      const revisionId = decodeId('drawingRevision', input.params.drawingRevisionId);
      if (!revisionId) throw new AppError('drawing_revision.not_found');
      const c = await drawingCompare.compare(requireTenant(input), projectId, revisionId);
      return {
        status: 200,
        body: {
          runId: c.runId ? encodeId('aiRun', c.runId) : null,
          revisionId: encodeId('drawingRevision', c.revisionId),
          againstRevisionId: encodeId('drawingRevision', c.againstRevisionId),
          sheetNumber: c.sheetNumber,
          fromRev: c.fromRev,
          toRev: c.toRev,
          headline: c.headline,
          items: c.items,
          changes: c.changes,
          unexplainedChangeIds: c.unexplained,
          truncated: c.truncated,
          scanned: c.scanned,
          affectedRfis: c.affectedRfis.map((r) => ({ ...r, id: encodeId('rfi', r.id) })),
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
