import { encodeId } from '@archova/domain';
import type {
  Declaration,
  DeclarationChase,
  DeclarationChaseResult,
  DeclarationClaimStatus,
  DeclarationDetail,
  DeclarationFlag,
  DeclarationIssue,
  DeclarationRequirement,
} from '@archova/contracts';
import {
  declarationLabel,
  type DeclarationFlag as Flag,
  type DeclarationIssue as Issue,
} from '../domain/declaration';
import type { StatementService, StatementView } from '../application/statements';
import type { chases } from '../infra/tables';

export const toDeclarationDto = (r: StatementView): Declaration => ({
  id: encodeId('declaration', r.id),
  projectId: encodeId('project', r.projectId),
  number: r.number,
  numberLabel: declarationLabel(r.number),
  companyId: encodeId('company', r.companyId),
  kind: r.kind,
  declarantName: r.declarantName,
  declarantPosition: r.declarantPosition,
  declaredOn: r.declaredOn,
  validFrom: r.validFrom,
  validTo: r.validTo,
  issuer: r.issuer,
  referenceNumber: r.referenceNumber,
  claimId: r.claimId ? encodeId('paymentClaim', r.claimId) : null,
  lifecycle: r.lifecycle,
  status: r.status,
  daysToEnd: r.daysToEnd,
  notes: r.notes,
  fileIds: r.fileIds.map((f) => encodeId('file', f)),
  readByNova: r.readByNova,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  version: r.version,
});

export const toDeclarationDetail = (
  d: Awaited<ReturnType<StatementService['detail']>>,
): DeclarationDetail => ({
  declaration: toDeclarationDto(d.declaration),
  events: d.events.map((e) => ({
    id: encodeId('declarationEvent', e.id),
    action: e.action,
    fromLifecycle: e.fromLifecycle as DeclarationDetail['events'][number]['fromLifecycle'],
    toLifecycle: e.toLifecycle as DeclarationDetail['events'][number]['toLifecycle'],
    validTo: e.validTo,
    note: e.note,
    actorId: e.actorId ? encodeId('user', e.actorId) : null,
    at: e.at.toISOString(),
  })),
});

export const toRequirementDto = (r: {
  kind: DeclarationRequirement['kind'];
  leadDays: number;
}): DeclarationRequirement => ({ kind: r.kind, leadDays: r.leadDays });

export const toIssueDto = (i: Issue): DeclarationIssue => ({
  kind: i.kind,
  level: i.level,
  declarationKind: i.declarationKind,
  declarationId: i.declarationId ? encodeId('declaration', i.declarationId) : null,
  declarationLabel: i.declarationLabel,
  validTo: i.validTo,
  daysLeft: i.daysLeft,
  message: i.message,
});

export const toFlagDto = (f: Flag): DeclarationFlag => ({
  kind: f.kind,
  severity: f.severity,
  companyId: encodeId('company', f.companyId),
  title: f.title,
  detail: f.detail,
  declarationId: f.declarationId ? encodeId('declaration', f.declarationId) : null,
  declarationKind: f.declarationKind,
  validTo: f.validTo,
  daysLeft: f.daysLeft,
});

export const toClaimStatusDto = (
  c: Awaited<ReturnType<StatementService['claimStatuses']>>['data'][number],
): DeclarationClaimStatus => ({
  claimId: encodeId('paymentClaim', c.claimId),
  number: c.number,
  contractId: encodeId('contract', c.contractId),
  contractTitle: c.contractTitle,
  companyId: encodeId('company', c.payeeCompanyId),
  companyName: c.companyName,
  periodEnd: c.periodEnd,
  state: c.state,
  coveredByStatement: c.coveredByStatement,
  issues: c.issues.map(toIssueDto),
});

export const toChaseResultDto = (
  r: Awaited<ReturnType<StatementService['chase']>>,
): DeclarationChaseResult => ({
  draft: r.draft ? { subject: r.draft.subject, body: r.draft.body, kinds: r.draft.kinds } : null,
  recipient: r.recipient,
  sent: r.sent,
  chaseId: r.chaseId ? encodeId('declarationChase', r.chaseId) : null,
  sentAt: r.sentAt ? r.sentAt.toISOString() : null,
});

export const toChaseDto = (r: typeof chases.$inferSelect): DeclarationChase => ({
  id: encodeId('declarationChase', r.id),
  companyId: encodeId('company', r.companyId),
  claimId: r.claimId ? encodeId('paymentClaim', r.claimId) : null,
  kinds: r.kinds as DeclarationChase['kinds'],
  recipient: r.recipient,
  subject: r.subject,
  body: r.body,
  sentBy: r.sentBy ? encodeId('user', r.sentBy) : null,
  sentAt: r.sentAt.toISOString(),
});
