import { decodeId, encodeId } from '@archova/domain';
import type {
  Induction,
  InductionCompletion,
  InductionContent as InductionContentDto,
  InductionRegister,
  InductionVersion,
  InductionVersionSummary,
  WorkerCredential,
} from '@archova/contracts';
import { AppError } from '@archova/kernel';
import { INDUCTION_FIXED_TEXT } from '@archova/mod-ai';
import type { Viewer } from '../application/attendance';
import type {
  CompletionView,
  CredentialRow,
  InductionDetail,
  InductionService,
  VersionRow,
} from '../application/inductions';
import type { InductionBlock, InductionContent } from '../domain/induction';
import { toWorkerDto } from './mappers';

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const user = (id: string | null) => (id ? encodeId('user', id) : null);

function blockDto(b: InductionBlock): InductionContentDto['sections'][number]['blocks'][number] {
  if (b.type === 'video' || b.type === 'document' || b.type === 'image')
    return { type: b.type, fileId: encodeId('file', b.fileId), title: b.title };
  if (b.type === 'swms')
    return { type: 'swms', documentId: encodeId('document', b.documentId), title: b.title };
  return b;
}

export const toContentDto = (c: InductionContent): InductionContentDto => ({
  sections: c.sections.map((s) => ({ ...s, blocks: s.blocks.map(blockDto) })),
  quiz: c.quiz,
  passMark: c.passMark,
});

/** Request content → internal ids. A bad id is a validation error at its path. */
export function fromContentDto(c: InductionContentDto): InductionContent {
  const decode = (kind: 'file' | 'document', v: string, path: string) => {
    const id = decodeId(kind, v);
    if (!id)
      throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
    return id;
  };
  return {
    passMark: c.passMark,
    quiz: c.quiz.map((q) => ({ ...q, id: q.id ?? '' })),
    sections: c.sections.map((s, i) => ({
      ...s,
      blocks: s.blocks.map((b, j): InductionBlock => {
        const path = `content/sections/${i}/blocks/${j}`;
        if (b.type === 'video' || b.type === 'document' || b.type === 'image')
          return {
            type: b.type,
            fileId: decode('file', b.fileId, `${path}/fileId`),
            title: b.title ?? null,
          };
        if (b.type === 'swms')
          return {
            type: 'swms',
            documentId: decode('document', b.documentId, `${path}/documentId`),
            title: null,
          };
        if (b.type === 'slides') return { type: 'slides', slides: b.slides };
        if (b.type === 'animation') return b as InductionBlock;
        if (b.type === 'text') return { type: 'text', body: b.body };
        throw new AppError('validation_failed', 'Unknown block', [
          { path, message: 'Unknown type' },
        ]);
      }),
    })),
  };
}

export const toVersionSummaryDto = (v: VersionRow): InductionVersionSummary => ({
  id: encodeId('inductionVersion', v.id),
  number: v.number,
  contentHash: v.contentHash,
  redo: v.redo,
  graceDays: v.graceDays,
  requiredFrom: v.requiredFrom.toISOString(),
  changeNote: v.changeNote,
  aiGenerated: v.aiSuggestionId !== null,
  publishedAt: v.publishedAt.toISOString(),
  publishedBy: user(v.publishedBy),
});

export const toVersionDto = (v: VersionRow): InductionVersion => ({
  ...toVersionSummaryDto(v),
  inductionId: encodeId('induction', v.inductionId),
  content: toContentDto(v.content),
  declarationText: v.declarationText,
  approvedBy: v.approvedBy.map((u) => encodeId('user', u)),
});

export function toInductionDto(d: InductionDetail): Induction {
  const { row } = d;
  return {
    id: encodeId('induction', row.id),
    projectId: encodeId('project', row.projectId),
    siteId: row.siteId ? encodeId('workforceSite', row.siteId) : null,
    title: row.title,
    status: row.status,
    validityMonths: row.validityMonths,
    draft: toContentDto(row.draft),
    draftAiSuggestionId: row.draftAiSuggestionId
      ? encodeId('aiSuggestion', row.draftAiSuggestionId)
      : null,
    approvals: Object.entries(row.draftApprovals)
      .map(([i, a]) => ({
        section: Number(i),
        approvedBy: encodeId('user', a.by),
        approvedAt: a.at,
        current: !d.problems.some((p) => p.path === `sections/${i}/approval`),
      }))
      .sort((a, b) => a.section - b.section),
    problems: d.problems,
    currentVersion: d.current ? toVersionSummaryDto(d.current) : null,
    requiredVersion: d.required ? toVersionSummaryDto(d.required) : null,
    versions: d.versions.map(toVersionSummaryDto),
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const toCredentialDto = (c: CredentialRow): WorkerCredential => ({
  id: encodeId('workerCredential', c.id),
  workerId: encodeId('worker', c.workerId),
  kind: c.kind,
  number: c.number,
  issuingState: c.issuingState as WorkerCredential['issuingState'],
  licenceClass: c.licenceClass,
  issuedOn: c.issuedOn,
  expiresOn: c.expiresOn,
  fileIds: c.fileIds.map((f) => encodeId('file', f)),
  status: c.status,
  sightedBy: user(c.sightedBy),
  sightedAt: iso(c.sightedAt),
  version: c.version,
  createdAt: c.createdAt.toISOString(),
});

/** The worker's view: content without quiz answers, questions in this worker's order. */
export function toCompletionDto(v: CompletionView): InductionCompletion {
  const { completion: c, version } = v;
  const byId = new Map(version.content.quiz.map((q) => [q.id, q]));
  const content = toContentDto(version.content);
  const failed = v.attempts.filter((a) => !a.passed).length;
  return {
    id: encodeId('inductionCompletion', c.id),
    inductionId: encodeId('induction', c.inductionId),
    versionId: encodeId('inductionVersion', c.versionId),
    versionNumber: version.number,
    worker: toWorkerDto(v.worker, v.viewer),
    status: c.status,
    method: c.method,
    startedAt: c.startedAt.toISOString(),
    completedAt: iso(c.completedAt),
    expiresOn: c.expiresOn,
    sectionsViewed: Object.keys(c.progress)
      .map(Number)
      .sort((a, b) => a - b),
    quiz: {
      attempts: v.attempts.length,
      failedAttempts: failed,
      passed: c.quizPassedAt !== null,
      lastScore: v.attempts.at(-1)?.score ?? null,
    },
    credentials: v.credentials.map(toCredentialDto),
    content: {
      sections: content.sections,
      quiz: v.quizOrder.map((id) => {
        const q = byId.get(id)!;
        return { id: q.id, section: q.section, question: q.question, options: q.options };
      }),
      passMark: version.content.passMark,
      declarationText: version.declarationText,
      swmsNotice: INDUCTION_FIXED_TEXT.swmsAwareness,
    },
  };
}

export function toRegisterDto(
  r: Awaited<ReturnType<InductionService['register']>>,
  viewer: Viewer,
): InductionRegister {
  return {
    inductionId: r.induction ? encodeId('induction', r.induction.id) : null,
    requiredVersion: r.required?.number ?? null,
    data: r.entries.map((e) => ({
      worker: toWorkerDto(e.worker, viewer),
      status: e.status,
      completion: e.completion
        ? {
            id: encodeId('inductionCompletion', e.completion.id),
            versionNumber: e.completion.versionNumber,
            completedAt: iso(e.completion.completedAt),
            expiresOn: e.completion.expiresOn,
            score: e.completion.quizScore,
            method: e.completion.method,
          }
        : null,
      credentials: e.credentials.map((c) => ({
        kind: c.kind,
        status: c.status,
        expiresOn: c.expiresOn,
      })),
    })),
  };
}
