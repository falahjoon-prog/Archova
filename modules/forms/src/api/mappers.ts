import { encodeId } from '@archova/domain';
import type {
  FormField,
  FormSubmission,
  FormSubmissionDetail,
  FormSuggestion,
  FormTemplate,
} from '@archova/contracts';
import type { SubmissionView, TemplateRow } from '../application/forms';
import { numberLabel, type FieldDef, type Suggestion } from '../domain/forms';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export const toField = (f: FieldDef): FormField => ({ ...f });

export const toTemplateDto = (t: TemplateRow): FormTemplate => ({
  id: encodeId('formTemplate', t.id),
  projectId: encodeId('project', t.projectId),
  name: t.name,
  description: t.description,
  category: t.category,
  version: t.version,
  status: t.status,
  fields: t.fields.map(toField),
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
});

export const toSubmissionDto = (v: SubmissionView): FormSubmission => ({
  id: encodeId('formSubmission', v.row.id),
  projectId: encodeId('project', v.row.projectId),
  number: v.row.number,
  numberLabel: numberLabel(v.row.number),
  templateId: encodeId('formTemplate', v.row.templateId),
  templateName: v.template.name,
  templateVersion: v.row.templateVersion,
  title: v.row.title,
  status: v.row.status,
  assigneeId: v.row.assigneeId ? encodeId('user', v.row.assigneeId) : null,
  dueDate: v.row.dueDate,
  flags: v.flags,
  daysLate: v.daysLate,
  missingRequiredCount: v.missing.length,
  relatedType: v.row.relatedType,
  relatedId: v.row.relatedId && v.row.relatedType ? encodeId('incident', v.row.relatedId) : null,
  createdAt: v.row.createdAt.toISOString(),
  updatedAt: v.row.updatedAt.toISOString(),
  submittedAt: iso(v.row.submittedAt),
});

export const toSubmissionDetail = (v: SubmissionView): FormSubmissionDetail => ({
  submission: toSubmissionDto(v),
  fields: v.template.fields.map(toField),
  answers: v.row.answers,
  fileIds: v.row.fileIds.map((f) => encodeId('file', f)),
  missingRequired: v.missing,
  canFill: v.canFill,
  canClose: v.canClose,
});

export const toSuggestion = (s: Suggestion): FormSuggestion => ({ ...s });
