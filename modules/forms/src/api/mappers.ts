import { encodeId } from '@archova/domain';
import type { FormAttention, FormDetail, FormSummary, FormTemplate } from '@archova/contracts';
import type { Flag, FormRow, SignatureRow, TemplateView } from '../application/forms';

const label = (n: number) => `FRM-${String(n).padStart(4, '0')}`;
const nameOf = (names: Map<string, string>, id: string) => names.get(id) ?? 'Former team member';

export const toTemplate = (t: TemplateView): FormTemplate => ({
  id: t.id,
  source: t.source,
  name: t.name,
  description: t.description,
  category: t.category,
  fields: t.fields,
  linkModule: t.linkModule,
  cadenceDays: t.cadenceDays,
  status: t.status,
  version: t.version,
  updatedAt: t.updatedAt ? t.updatedAt.toISOString() : null,
});

export const toSummary = (
  r: FormRow,
  names: Map<string, string>,
  signatureCount: number,
): FormSummary => ({
  id: encodeId('form', r.id),
  projectId: encodeId('project', r.projectId),
  numberLabel: label(r.number),
  templateId: r.templateRef,
  templateName: r.templateName,
  category: r.category,
  title: r.title,
  status: r.status,
  createdById: encodeId('user', r.createdBy),
  createdByName: nameOf(names, r.createdBy),
  createdAt: r.createdAt.toISOString(),
  submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
  signatureCount,
});

export const toAttention = (f: Flag): FormAttention => ({
  kind: f.kind,
  message: f.message,
  templateId: f.templateId,
  templateName: f.templateName,
  formId: f.formId,
  signerNames: f.signerNames,
});

export function toFormDetail(d: {
  row: FormRow;
  signatures: SignatureRow[];
  names: Map<string, string>;
  flags: Flag[];
}): FormDetail {
  return {
    form: toSummary(d.row, d.names, d.signatures.length),
    templateName: d.row.templateName,
    linkModule: d.row.linkModule,
    fields: d.row.fields,
    answers: d.row.answers,
    signatures: d.signatures.map((s) => ({
      id: encodeId('formSignature', s.id),
      fieldKey: s.fieldKey,
      signerName: s.signerName,
      signedAt: s.signedAt.toISOString(),
    })),
    flags: d.flags.map((f) => ({
      kind: f.kind,
      message: f.message,
      signerNames: f.signerNames,
    })),
    canEdit: d.row.status === 'draft',
    version: d.row.version,
  };
}
