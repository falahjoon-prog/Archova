import { encodeId } from '@archova/domain';
import type {
  Prequalification,
  PrequalificationSummary,
  PrequalTemplate,
} from '@archova/contracts';
import type { PrequalView, RegisterEntry, TemplateRow } from '../application/prequalifications';

export const toTemplateDto = (r: TemplateRow): PrequalTemplate => ({
  id: encodeId('prequalTemplate', r.id),
  name: r.name,
  version: r.version,
  published: r.published,
  validityMonths: r.validityMonths,
  questions: r.questions,
  rowVersion: r.rowVersion,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export const toPrequalDto = (v: PrequalView): Prequalification => ({
  id: encodeId('prequalification', v.row.id),
  companyId: encodeId('company', v.row.companyId),
  templateId: encodeId('prequalTemplate', v.row.templateId),
  templateName: v.template.name,
  templateVersion: v.row.templateVersion,
  status: v.row.status,
  qualification: v.qualification as Exclude<typeof v.qualification, 'none'>,
  trades: v.row.trades,
  answers: v.row.answers,
  scorePoints: v.row.scorePoints,
  scoreMax: v.row.scoreMax,
  concerns: v.row.concerns,
  submittedAt: v.row.submittedAt ? v.row.submittedAt.toISOString() : null,
  decidedAt: v.row.decidedAt ? v.row.decidedAt.toISOString() : null,
  decidedBy: v.row.decidedBy ? encodeId('user', v.row.decidedBy) : null,
  decisionNote: v.row.decisionNote,
  validFrom: v.row.validFrom,
  expiresOn: v.row.expiresOn,
  // The questions the form was answered on, not the template's latest.
  questions: v.template.questions,
  version: v.row.version,
  createdAt: v.row.createdAt.toISOString(),
});

export const toSummaryDto = (e: RegisterEntry): PrequalificationSummary => ({
  id: encodeId('prequalification', e.row.id),
  companyId: encodeId('company', e.row.companyId),
  templateName: e.templateName,
  templateVersion: e.row.templateVersion,
  status: e.row.status,
  qualification: e.qualification as Exclude<typeof e.qualification, 'none'>,
  trades: e.row.trades,
  scorePoints: e.row.scorePoints,
  scoreMax: e.row.scoreMax,
  concerns: e.row.concerns,
  decidedAt: e.row.decidedAt ? e.row.decidedAt.toISOString() : null,
  expiresOn: e.row.expiresOn,
  createdAt: e.row.createdAt.toISOString(),
});
